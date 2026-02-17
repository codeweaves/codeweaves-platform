import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from './prisma.service';
import { EmailService } from './email.service';
import { Auth0ManagementService } from './auth0-management.service';
import { InvitationStatus, Prisma } from '@prisma/client';
import { CreateInvitationDto } from '../models/invitation.dto';

const INVITATION_EXPIRY_DAYS = 7;
const MAX_REISSUE_COUNT = 5;

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private configService: ConfigService,
    private auth0Management: Auth0ManagementService,
  ) {}

  async create(dto: CreateInvitationDto, invitedById: string) {
    const email = dto.email.toLowerCase();

    // Check if email already registered
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      throw new BadRequestException('User with this email already exists');
    }

    // Check for pending invitation
    const existingInvitation = await this.prisma.userInvitation.findFirst({
      where: {
        email,
        status: InvitationStatus.PENDING,
      },
    });
    if (existingInvitation) {
      throw new BadRequestException(
        'Pending invitation already exists for this email',
      );
    }

    try {
      const invitation = await this.prisma.userInvitation.create({
        data: {
          email,
          role: dto.role,
          organizationId: dto.organizationId ?? null,
          invitedBy: invitedById,
          expiresAt: new Date(
            Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
          ),
        },
      });

      // Pre-create Auth0 user and generate password setup link
      const passwordSetupUrl =
        await this.getOrCreateAuth0UserAndTicket(invitation);

      await this.sendInvitationEmail(invitation, passwordSetupUrl);

      return invitation;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Pending invitation already exists for this email',
        );
      }
      throw error;
    }
  }

  async findAll() {
    return this.prisma.userInvitation.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const invitation = await this.prisma.userInvitation.findUnique({
      where: { id },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    return invitation;
  }

  async resend(id: string) {
    const invitation = await this.prisma.userInvitation.findUnique({
      where: { id },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('Can only resend pending invitations');
    }

    const updated = await this.prisma.userInvitation.update({
      where: { id },
      data: {
        expiresAt: new Date(
          Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
        ),
      },
    });

    // Generate new password setup link
    const passwordSetupUrl = await this.getOrCreateAuth0UserAndTicket(updated);

    await this.sendInvitationEmail(updated, passwordSetupUrl);

    return updated;
  }

  async reissue(reissueToken: string) {
    const invitation = await this.prisma.userInvitation.findUnique({
      where: { reissueToken },
    });

    if (!invitation) {
      throw new NotFoundException('Invalid reissue token');
    }

    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new BadRequestException('Invitation already accepted');
    }

    if (invitation.expiresAt > new Date()) {
      throw new BadRequestException('Invitation is still valid');
    }

    if (invitation.reissueCount >= MAX_REISSUE_COUNT) {
      throw new BadRequestException('Maximum reissue attempts reached');
    }

    const updated = await this.prisma.userInvitation.update({
      where: { id: invitation.id },
      data: {
        token: randomUUID(),
        status: InvitationStatus.PENDING,
        reissueCount: { increment: 1 },
        expiresAt: new Date(
          Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
        ),
      },
    });

    // Generate new password setup link
    const passwordSetupUrl = await this.getOrCreateAuth0UserAndTicket(updated);

    await this.sendInvitationEmail(updated, passwordSetupUrl);

    return { message: 'Invitation reissued successfully' };
  }

  async validate(token: string) {
    const invitation = await this.prisma.userInvitation.findUnique({
      where: { token },
    });

    if (!invitation) {
      throw new NotFoundException('Invalid invitation token');
    }

    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new BadRequestException('Invitation has already been used');
    }

    if (
      invitation.status === InvitationStatus.EXPIRED ||
      invitation.expiresAt <= new Date()
    ) {
      throw new BadRequestException({
        message: 'Invitation has expired',
        reissueToken: invitation.reissueToken,
      });
    }

    return {
      email: invitation.email,
      organizationId: invitation.organizationId,
      role: invitation.role,
    };
  }

  async cancel(id: string) {
    const invitation = await this.prisma.userInvitation.findUnique({
      where: { id },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new BadRequestException('Cannot cancel an accepted invitation');
    }

    // Delete Auth0 user if one was pre-created — must succeed before removing invitation
    // to avoid orphaned Auth0 accounts (auth0UserId would be lost)
    if (invitation.auth0UserId) {
      try {
        await this.auth0Management.deleteUser(invitation.auth0UserId);
      } catch (error) {
        this.logger.error(
          `Failed to delete Auth0 user ${invitation.auth0UserId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        throw new ServiceUnavailableException(
          'Failed to delete Auth0 user; invitation was not cancelled. Please retry.',
        );
      }
    }

    return this.prisma.userInvitation.delete({
      where: { id },
    });
  }

  private async getOrCreateAuth0UserAndTicket(invitation: {
    id: string;
    email: string;
    auth0UserId: string | null;
  }): Promise<string | null> {
    try {
      let auth0UserId = invitation.auth0UserId;

      if (!auth0UserId) {
        const existingAuth0User = await this.auth0Management.getUserByEmail(
          invitation.email,
        );

        if (existingAuth0User) {
          auth0UserId = existingAuth0User.user_id;
        } else {
          const newUser = await this.auth0Management.createUser(
            invitation.email,
          );
          auth0UserId = newUser.user_id;
        }

        // Store Auth0 user ID on the invitation
        await this.prisma.userInvitation.update({
          where: { id: invitation.id },
          data: { auth0UserId },
        });
      }

      // Generate password change ticket
      return await this.auth0Management.createPasswordChangeTicket(auth0UserId);
    } catch (error) {
      this.logger.error(
        `Failed to get/create Auth0 user for invitation ${invitation.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return null;
    }
  }

  private async sendInvitationEmail(
    invitation: {
      email: string;
      token: string;
      reissueToken: string;
    },
    passwordSetupUrl: string | null,
  ) {
    const dashboardUrl = this.configService.get<string>(
      'DASHBOARD_URL',
      'http://localhost:3000',
    );

    // Use password setup URL if available, fallback to signup URL
    const actionUrl =
      passwordSetupUrl ??
      `${dashboardUrl}/signup?token=${invitation.token}`;
    const actionLabel = passwordSetupUrl
      ? 'Set Your Password'
      : 'Create Your Account';

    await this.emailService.send({
      to: invitation.email,
      subject: 'You have been invited to CodeWeaves',
      html: `
        <h1>Welcome to CodeWeaves!</h1>
        <p>You have been invited to join the platform.</p>
        <p>Click the link below to ${actionLabel.toLowerCase()}:</p>
        <a href="${actionUrl}">${actionLabel}</a>
        <p>This link expires in ${INVITATION_EXPIRY_DAYS} days.</p>
      `,
    });
  }
}

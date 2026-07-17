import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from './prisma.service';
import { EmailService } from './email.service';
import { ClerkManagementService } from './clerk-management.service';
import { InvitationStatus, Prisma } from '@prisma/client';
import { CreateInvitationDto, InvitationListQuery } from '../models/invitation.dto';
import { InvitationLoggerService } from '../common/logger/invitation.logger';
import { AppLogger } from '../common/logger/app-logger';

const INVITATION_EXPIRY_DAYS = 7;
const MAX_REISSUE_COUNT = 5;

@Injectable()
export class InvitationsService {
  private readonly log = new AppLogger(InvitationsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private configService: ConfigService,
    private clerkManagement: ClerkManagementService,
    private readonly invitationLogger: InvitationLoggerService,
  ) {}

  async create(dto: CreateInvitationDto, invitedById: string) {
    const email = dto.email.toLowerCase();
    this.log.debug('create', 'creating invitation', {
      role: dto.role,
      organizationId: dto.organizationId ?? null,
    });

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

      // Create a Clerk invitation and generate the password-setup ticket link
      const passwordSetupUrl =
        await this.createClerkInvitationTicket(invitation);

      await this.sendInvitationEmail(invitation, passwordSetupUrl);

      await this.invitationLogger.logInvitationCreated(invitation.id, { response: invitation, request: dto });
      this.log.info('create', 'invitation created', { invitationId: invitation.id });
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
      this.log.error('create', 'invitation creation failed', error);
      await this.invitationLogger.logInvitationCreationException(
        email,
        error,
        { request: dto },
      );
      throw error;
    }
  }

  async findAll(query: InvitationListQuery = { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' }) {
    const { page, limit, search, status, statuses, sortBy, sortOrder } = query;
    const skip = (page - 1) * limit;

    // Combine the legacy single-status filter with the multi-select array.
    // Both client forms map to the same `IN (...)` query.
    const statusList = [
      ...(status ? [status] : []),
      ...(statuses ?? []),
    ];

    const where: Prisma.UserInvitationWhereInput = {
      ...(search
        ? { email: { contains: search, mode: 'insensitive' as const } }
        : {}),
      ...(statusList.length > 0 ? { status: { in: statusList } } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.userInvitation.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.userInvitation.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
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

    try {
      const updated = await this.prisma.userInvitation.update({
        where: { id },
        data: {
          expiresAt: new Date(
            Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
          ),
        },
      });

      // Generate new password setup link
      const passwordSetupUrl = await this.createClerkInvitationTicket(updated);

      await this.sendInvitationEmail(updated, passwordSetupUrl);

      await this.invitationLogger.logInvitationResent(updated.id, { response: updated });
      this.log.info('resend', 'invitation resent', { invitationId: updated.id });
      return updated;
    } catch (error) {
      this.log.error('resend', 'invitation resend failed', error, { invitationId: id });
      await this.invitationLogger.logInvitationResentException(id, error, {
        invitationId: id,
      });
      throw error;
    }
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
    const passwordSetupUrl = await this.createClerkInvitationTicket(updated);

    await this.sendInvitationEmail(updated, passwordSetupUrl);

    await this.invitationLogger.logInvitationReissued(invitation.id, { response: updated });
    this.log.info('reissue', 'invitation reissued', {
      invitationId: invitation.id,
      reissueCount: updated.reissueCount,
    });
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

    // Revoke the Clerk invitation if one was issued — must succeed before
    // removing the invitation row so the ticket link can no longer be used.
    if (invitation.clerkInvitationId) {
      try {
        await this.clerkManagement.revokeInvitation(invitation.clerkInvitationId);
      } catch (error) {
        this.log.error(
          'cancel',
          `failed to revoke Clerk invitation ${invitation.clerkInvitationId}`,
          error,
          { invitationId: id },
        );
        throw new ServiceUnavailableException(
          'Failed to revoke Clerk invitation; invitation was not cancelled. Please retry.',
        );
      }
    }

    try {
      const deleted = await this.prisma.userInvitation.delete({
        where: { id },
      });
      await this.invitationLogger.logInvitationCancelled(id, { response: deleted });
      this.log.info('cancel', 'invitation cancelled', { invitationId: id });
      return deleted;
    } catch (error) {
      this.log.error('cancel', 'invitation cancel failed', error, { invitationId: id });
      await this.invitationLogger.logInvitationCancelledException(id, error, {
        invitationId: id,
      });
      throw error;
    }
  }

  /**
   * Creates a Clerk invitation for the given invitation row and returns the
   * ticket URL the user clicks to set their password. Any previously-issued
   * Clerk invitation is revoked first (best-effort) so the email always carries
   * a fresh, valid ticket. Returns null on failure — the caller falls back to
   * the plain signup link.
   */
  private async createClerkInvitationTicket(invitation: {
    id: string;
    email: string;
    clerkInvitationId: string | null;
  }): Promise<string | null> {
    try {
      const dashboardUrl = this.configService.get<string>(
        'DASHBOARD_URL',
        'http://localhost:3000',
      );

      // Revoke a stale invitation (resend/reissue) before issuing a new one.
      if (invitation.clerkInvitationId) {
        try {
          await this.clerkManagement.revokeInvitation(
            invitation.clerkInvitationId,
          );
        } catch (error) {
          this.log.warn(
            'createClerkInvitationTicket',
            `failed to revoke stale Clerk invitation ${invitation.clerkInvitationId}`,
            { err: error instanceof Error ? error.message : 'Unknown error' },
          );
        }
      }

      const created = await this.clerkManagement.createInvitation({
        email: invitation.email,
        redirectUrl: `${dashboardUrl}/sign-up`,
        expiresInDays: INVITATION_EXPIRY_DAYS,
      });

      await this.prisma.userInvitation.update({
        where: { id: invitation.id },
        data: { clerkInvitationId: created.id },
      });

      return created.url;
    } catch (error) {
      this.log.error(
        'createClerkInvitationTicket',
        `failed to create Clerk invitation for invitation ${invitation.id}`,
        error,
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
      subject: 'You have been invited to Klivo',
      html: `
        <h1>Welcome to Klivo!</h1>
        <p>You have been invited to join the platform.</p>
        <p>Click the link below to ${actionLabel.toLowerCase()}:</p>
        <a href="${actionUrl}">${actionLabel}</a>
        <p>This link expires in ${INVITATION_EXPIRY_DAYS} days.</p>
      `,
    });
  }
}

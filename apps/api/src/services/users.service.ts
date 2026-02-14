import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { User, Role, InvitationStatus, Prisma } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findByAuth0Id(auth0Id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { auth0Id },
      include: { organization: true },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async createFromAuth0(data: {
    auth0Id: string;
    email: string;
    name?: string;
    role: Role;
    organizationId: string;
  }): Promise<User> {
    return this.prisma.user.create({
      data: {
        auth0Id: data.auth0Id,
        email: data.email,
        name: data.name,
        role: data.role,
        organizationId: data.organizationId,
      },
    });
  }

  async updateProfile(userId: string, data: { name?: string }): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data,
    });
  }

  async findByOrganization(organizationId: string): Promise<User[]> {
    return this.prisma.user.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async syncOrCreateUser(jwtUser: { auth0Id: string; email: string }) {
    const existingUser = await this.prisma.user.findUnique({
      where: { auth0Id: jwtUser.auth0Id },
      include: { organization: true },
    });

    if (existingUser) return existingUser;

    return this.createFromInvitation(jwtUser);
  }

  private async createFromInvitation(jwtUser: {
    auth0Id: string;
    email: string;
  }) {
    const email = jwtUser.email.toLowerCase();

    const invitation = await this.prisma.userInvitation.findFirst({
      where: {
        email,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
    });

    if (!invitation) {
      throw new UnauthorizedException(
        'No valid invitation found. Please contact your administrator.',
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            auth0Id: jwtUser.auth0Id,
            email,
            role: invitation.role,
            organizationId: invitation.organizationId,
          },
          include: { organization: true },
        });

        await tx.userInvitation.update({
          where: { id: invitation.id },
          data: { status: InvitationStatus.ACCEPTED },
        });

        return newUser;
      });
    } catch (error) {
      // Handle race condition: concurrent first-login requests for same user
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raceUser = await this.prisma.user.findUnique({
          where: { auth0Id: jwtUser.auth0Id },
          include: { organization: true },
        });
        if (raceUser) return raceUser;
      }
      throw error;
    }
  }
}

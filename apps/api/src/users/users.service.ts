import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, Role } from '@prisma/client';

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
}

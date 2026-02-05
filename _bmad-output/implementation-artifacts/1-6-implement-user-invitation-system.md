# Story 1.6: Implement User Invitation System

Status: ready-for-dev

## Story

As a **Super Admin**,
I want to invite new users to the platform,
So that I can onboard new team members and clients.

## Acceptance Criteria

1. **Given** I am logged in as Super Admin
   **When** I create an invitation via POST `/api/invitations`
   **Then** invitation record is created with email, role, organizationId

2. **And** unique invitation token is generated

3. **And** invitation email is sent with signup link

4. **And** invitation expires after 7 days

5. **And** invitation status is tracked (pending, accepted, expired)

## Tasks / Subtasks

- [ ] Task 1: Create Invitations module (AC: 1)
  - [ ] Create `src/invitations/invitations.module.ts`
  - [ ] Create `src/invitations/invitations.service.ts`
  - [ ] Create `src/invitations/invitations.controller.ts`

- [ ] Task 2: Implement create invitation endpoint (AC: 1, 2, 4)
  - [ ] POST `/api/invitations` - Create invitation
  - [ ] Generate unique token (UUID)
  - [ ] Generate reissue token (UUID)
  - [ ] Set expiration to 7 days from now
  - [ ] Validate email not already invited/registered

- [ ] Task 3: Implement email sending (AC: 3)
  - [ ] Create email service (Nodemailer or SendGrid)
  - [ ] Create invitation email template
  - [ ] Send email with signup link containing token
  - [ ] Handle email sending failures gracefully

- [ ] Task 4: Implement invitation management endpoints
  - [ ] GET `/api/invitations` - List all invitations (Super Admin)
  - [ ] GET `/api/invitations/:id` - Get invitation details
  - [ ] POST `/api/invitations/:id/resend` - Resend invitation email
  - [ ] DELETE `/api/invitations/:id` - Cancel invitation

- [ ] Task 5: Implement reissue functionality (FR5)
  - [ ] POST `/api/invitations/reissue` - Reissue expired invitation
  - [ ] Validate reissue token
  - [ ] Increment reissue count (max 5)
  - [ ] Generate new token and expiration

- [ ] Task 6: Test invitation system
  - [ ] Test invitation creation
  - [ ] Test duplicate email rejection
  - [ ] Test expiration calculation
  - [ ] Test resend functionality
  - [ ] Test reissue limit

## Dev Notes

### Invitations Controller

```typescript
// apps/api/src/invitations/invitations.controller.ts
import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '@prisma/client';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto, ReissueInvitationDto } from './dto/invitation.dto';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';

@ApiTags('invitations')
@ApiBearerAuth()
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Create user invitation' })
  async create(
    @Body() dto: CreateInvitationDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.invitationsService.create(dto, user.id);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'List all invitations' })
  async findAll() {
    return this.invitationsService.findAll();
  }

  @Post(':id/resend')
  @Roles(Role.SUPER_ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Resend invitation email' })
  async resend(@Param('id') id: string) {
    return this.invitationsService.resend(id);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Cancel invitation' })
  async cancel(@Param('id') id: string) {
    return this.invitationsService.cancel(id);
  }

  @Post('reissue')
  @ApiOperation({ summary: 'Reissue expired invitation (public)' })
  @Public()
  async reissue(@Body() dto: ReissueInvitationDto) {
    return this.invitationsService.reissue(dto.reissueToken);
  }
}
```

### Invitations Service

```typescript
// apps/api/src/invitations/invitations.service.ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { InvitationStatus, Role } from '@prisma/client';
import { CreateInvitationDto } from './dto/invitation.dto';

const INVITATION_EXPIRY_DAYS = 7;
const MAX_REISSUE_COUNT = 5;

@Injectable()
export class InvitationsService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  async create(dto: CreateInvitationDto, invitedById: string) {
    // Check if email already registered
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new BadRequestException('User with this email already exists');
    }

    // Check for pending invitation
    const existingInvitation = await this.prisma.userInvitation.findFirst({
      where: {
        email: dto.email,
        status: InvitationStatus.PENDING,
      },
    });
    if (existingInvitation) {
      throw new BadRequestException('Pending invitation already exists for this email');
    }

    // Create invitation
    const invitation = await this.prisma.userInvitation.create({
      data: {
        email: dto.email,
        role: dto.role,
        organizationId: dto.organizationId,
        invitedBy: invitedById,
        expiresAt: new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    // Send email
    await this.sendInvitationEmail(invitation);

    return invitation;
  }

  async findAll() {
    return this.prisma.userInvitation.findMany({
      orderBy: { createdAt: 'desc' },
    });
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

    // Update expiration
    const updated = await this.prisma.userInvitation.update({
      where: { id },
      data: {
        expiresAt: new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    await this.sendInvitationEmail(updated);

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

    if (invitation.reissueCount >= MAX_REISSUE_COUNT) {
      throw new BadRequestException('Maximum reissue attempts reached');
    }

    // Generate new token and reset expiration
    const updated = await this.prisma.userInvitation.update({
      where: { id: invitation.id },
      data: {
        token: crypto.randomUUID(),
        status: InvitationStatus.PENDING,
        reissueCount: { increment: 1 },
        expiresAt: new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    await this.sendInvitationEmail(updated);

    return { message: 'Invitation reissued successfully' };
  }

  async cancel(id: string) {
    return this.prisma.userInvitation.delete({
      where: { id },
    });
  }

  private async sendInvitationEmail(invitation: any) {
    const signupUrl = `${process.env.DASHBOARD_URL}/signup?token=${invitation.token}`;

    await this.emailService.send({
      to: invitation.email,
      subject: 'You have been invited to CodeWeaves',
      html: `
        <h1>Welcome to CodeWeaves!</h1>
        <p>You have been invited to join the platform.</p>
        <p>Click the link below to create your account:</p>
        <a href="${signupUrl}">${signupUrl}</a>
        <p>This link expires in ${INVITATION_EXPIRY_DAYS} days.</p>
        <p>If the link has expired, use this reissue token: ${invitation.reissueToken}</p>
      `,
    });
  }
}
```

### Invitation DTOs

```typescript
// apps/api/src/invitations/dto/invitation.dto.ts
import { z } from 'zod';
import { Role } from '@prisma/client';

export const createInvitationSchema = z.object({
  email: z.string().email(),
  role: z.nativeEnum(Role),
  organizationId: z.string().uuid(),
});

export type CreateInvitationDto = z.infer<typeof createInvitationSchema>;

export const reissueInvitationSchema = z.object({
  reissueToken: z.string().uuid(),
});

export type ReissueInvitationDto = z.infer<typeof reissueInvitationSchema>;
```

### Email Service (Basic Implementation)

```typescript
// apps/api/src/email/email.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor() {
    // For development, use ethereal.email or console logging
    if (process.env.NODE_ENV === 'development') {
      this.transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    } else {
      // Production: Use SendGrid, AWS SES, etc.
      this.transporter = nodemailer.createTransport({
        // Configure production email service
      });
    }
  }

  async send(options: { to: string; subject: string; html: string }) {
    try {
      const info = await this.transporter.sendMail({
        from: process.env.EMAIL_FROM || 'noreply@codeweaves.com',
        ...options,
      });
      this.logger.log(`Email sent: ${info.messageId}`);
      return info;
    } catch (error) {
      this.logger.error(`Failed to send email: ${error.message}`);
      // Don't throw - email failure shouldn't block invitation creation
    }
  }
}
```

### Architecture Compliance

- **FR1:** Super Admin can invite new users
- **FR5:** Reissue expired invitations (up to 5 attempts)
- **FR8:** Super Admin can view all invitations
- **FR9:** Super Admin can resend invitation emails

### Testing Requirements

```typescript
describe('InvitationsService', () => {
  it('should create invitation with correct expiration', async () => {
    const invitation = await invitationsService.create({
      email: 'new@example.com',
      role: Role.CLIENT,
      organizationId: testOrg.id,
    }, superAdminUser.id);

    expect(invitation.status).toBe(InvitationStatus.PENDING);
    expect(invitation.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('should reject duplicate email', async () => {
    await expect(
      invitationsService.create({
        email: 'existing@example.com',
        role: Role.CLIENT,
        organizationId: testOrg.id,
      }, superAdminUser.id)
    ).rejects.toThrow('User with this email already exists');
  });

  it('should enforce reissue limit', async () => {
    // Create invitation with max reissue count
    const invitation = await createInvitationWithReissueCount(5);

    await expect(
      invitationsService.reissue(invitation.reissueToken)
    ).rejects.toThrow('Maximum reissue attempts reached');
  });
});
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.6]
- [Source: _bmad-output/planning-artifacts/prd.md#FR1-FR10]
- [Nodemailer: https://nodemailer.com/about/]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to create:
- `apps/api/src/invitations/invitations.module.ts`
- `apps/api/src/invitations/invitations.service.ts`
- `apps/api/src/invitations/invitations.controller.ts`
- `apps/api/src/invitations/dto/invitation.dto.ts`
- `apps/api/src/email/email.module.ts`
- `apps/api/src/email/email.service.ts`
- `apps/api/test/invitations/invitations.service.spec.ts`

Files to modify:
- `apps/api/src/app.module.ts` (import InvitationsModule, EmailModule)
- `apps/api/package.json` (add nodemailer)

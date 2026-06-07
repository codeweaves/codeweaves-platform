import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient, type ClerkClient } from '@clerk/backend';
import { ClerkLoggerService } from '../common/logger/clerk.logger';

export interface CreatedInvitation {
  id: string;
  /** The ticket link the invited user clicks to set their password. */
  url: string | null;
}

@Injectable()
export class ClerkManagementService {
  private readonly logger = new Logger(ClerkManagementService.name);
  private readonly clerk: ClerkClient;

  constructor(
    private configService: ConfigService,
    private readonly clerkLogger: ClerkLoggerService,
  ) {
    const secretKey = this.configService.get<string>('CLERK_SECRET_KEY', '');
    this.clerk = createClerkClient({ secretKey });
  }

  /**
   * Creates a Clerk invitation and returns its ticket URL.
   *
   * `notify: false` tells Clerk NOT to send its own invitation email — we send
   * our own branded email (EmailService) using the returned `url`. When the
   * user opens that link, Clerk redirects them to `redirectUrl` with a
   * `__clerk_ticket` query param, which our sign-up page consumes.
   */
  async createInvitation(params: {
    email: string;
    redirectUrl: string;
    expiresInDays: number;
  }): Promise<CreatedInvitation> {
    try {
      const invitation = await this.clerk.invitations.createInvitation({
        emailAddress: params.email,
        redirectUrl: params.redirectUrl,
        expiresInDays: params.expiresInDays,
        notify: false,
        ignoreExisting: true,
      });

      await this.clerkLogger.logClerkInvitationCreated(invitation.id, {
        email: params.email,
        invitationId: invitation.id,
      });

      return { id: invitation.id, url: invitation.url ?? null };
    } catch (error) {
      await this.clerkLogger.logClerkInvitationCreationFailed(
        params.email,
        error,
        { request: { email: params.email } },
      );
      throw error;
    }
  }

  /**
   * Revokes a pending Clerk invitation, making its link unusable. Idempotent:
   * a 404 (already revoked / not found) is treated as success.
   */
  async revokeInvitation(invitationId: string): Promise<void> {
    try {
      await this.clerk.invitations.revokeInvitation(invitationId);
      await this.clerkLogger.logClerkInvitationRevoked(invitationId, {
        invitationId,
      });
    } catch (error) {
      if ((error as { status?: number })?.status === 404) {
        this.logger.warn(
          `Clerk invitation ${invitationId} not found, skipping revoke`,
        );
        return;
      }
      await this.clerkLogger.logClerkInvitationRevocationFailed(
        invitationId,
        error,
        { request: { invitationId } },
      );
      throw error;
    }
  }
}

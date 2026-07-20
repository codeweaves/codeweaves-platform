import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient, type ClerkClient } from '@clerk/backend';
import { ClerkLoggerService } from '../common/logger/clerk.logger';
import { ProviderEventLogger } from '../common/events/provider.logger';

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
    private readonly providerLog: ProviderEventLogger,
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
      this.providerLog.log({
        channel: 'DASHBOARD',
        eventName: 'CLERK_INVITATION_COMPLETED',
        direction: 'OUTBOUND',
        provider: 'CLERK',
        requestPayload: { email: params.email, expiresInDays: params.expiresInDays },
        responsePayload: { invitationId: invitation.id },
      });

      return { id: invitation.id, url: invitation.url ?? null };
    } catch (error) {
      await this.clerkLogger.logClerkInvitationCreationFailed(
        params.email,
        error,
        { request: { email: params.email } },
      );
      this.providerLog.log({
        channel: 'DASHBOARD',
        eventName: 'CLERK_INVITATION_FAILED',
        direction: 'OUTBOUND',
        provider: 'CLERK',
        requestPayload: { email: params.email },
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Authoritatively confirm that the given Clerk account owns `email` AND has
   * verified it. Used at invitation acceptance so a token can't claim an
   * invite's org/role for an email the account hasn't proven it controls.
   *
   * Throws on API failure (network/Clerk down) so the caller can fail CLOSED —
   * we never provision role/org on an unconfirmed email.
   */
  async isEmailVerified(clerkUserId: string, email: string): Promise<boolean> {
    const user = await this.clerk.users.getUser(clerkUserId);
    const target = email.trim().toLowerCase();
    return user.emailAddresses.some(
      (e) =>
        e.emailAddress.toLowerCase() === target &&
        e.verification?.status === 'verified',
    );
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
      this.providerLog.log({
        channel: 'DASHBOARD',
        eventName: 'CLERK_INVITATION_REVOKE_COMPLETED',
        direction: 'OUTBOUND',
        provider: 'CLERK',
        requestPayload: { invitationId },
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

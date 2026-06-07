import { Injectable } from '@nestjs/common';
import { TracerService } from '../tracer/tracer.service';

@Injectable()
export class ClerkLoggerService {
  constructor(private readonly tracer: TracerService) {}

  async logClerkInvitationCreated(
    contextId: string,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      contextId,
      'CLERK_INVITATION_CREATED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logClerkInvitationCreationFailed(
    contextId: string,
    error: unknown,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      contextId,
      'CLERK_INVITATION_CREATION_FAILED',
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
    );
  }

  async logClerkInvitationRevoked(
    contextId: string,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      contextId,
      'CLERK_INVITATION_REVOKED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logClerkInvitationRevocationFailed(
    contextId: string,
    error: unknown,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      contextId,
      'CLERK_INVITATION_REVOCATION_FAILED',
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
    );
  }
}

import { Injectable } from '@nestjs/common';
import { TracerService } from '../tracer/tracer.service';

@Injectable()
export class InvitationLoggerService {
  constructor(private readonly tracer: TracerService) {}

  async logInvitationCreated(
    invitationId: string,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      invitationId,
      'INVITATION_CREATED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logInvitationCreationFailed(
    invitationId: string,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      invitationId,
      'INVITATION_CREATION_FAILED',
      this.tracer.mergeJsonResponse(data),
    );
  }

  async logInvitationCreationException(
    invitationId: string,
    error: unknown,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      invitationId,
      'INVITATION_CREATION_EXCEPTION',
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
    );
  }

  async logInvitationResent(
    invitationId: string,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      invitationId,
      'INVITATION_RESENT',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logInvitationResentException(
    invitationId: string,
    error: unknown,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      invitationId,
      'INVITATION_RESENT_EXCEPTION',
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
    );
  }

  async logInvitationCancelled(
    invitationId: string,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      invitationId,
      'INVITATION_CANCELLED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logInvitationCancelledException(
    invitationId: string,
    error: unknown,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      invitationId,
      'INVITATION_CANCELLED_EXCEPTION',
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
    );
  }

  async logInvitationReissued(
    invitationId: string,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      invitationId,
      'INVITATION_REISSUED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logInvitationReissuedException(
    invitationId: string,
    error: unknown,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      invitationId,
      'INVITATION_REISSUED_EXCEPTION',
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
    );
  }
}

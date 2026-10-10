import { Injectable } from "@nestjs/common";
import { TracerService } from "../tracer/tracer.service";
import { auditScope } from "./audit-scope";

@Injectable()
export class InvitationLoggerService {
  constructor(private readonly tracer: TracerService) {}

  async logInvitationCreated(
    invitationId: string,
    data: Record<string, unknown>,
    organizationId?: string | null,
  ) {
    await this.tracer.logAuditEvent(
      invitationId,
      "INVITATION_CREATED",
      this.tracer.mergeJsonResponse({ response: data }),
      auditScope(organizationId),
    );
  }

  async logInvitationCreationFailed(
    invitationId: string,
    data: Record<string, unknown>,
    organizationId?: string | null,
  ) {
    await this.tracer.logAuditEvent(
      invitationId,
      "INVITATION_CREATION_FAILED",
      this.tracer.mergeJsonResponse(data),
      auditScope(organizationId),
    );
  }

  async logInvitationCreationException(
    invitationId: string,
    error: unknown,
    data: Record<string, unknown>,
    organizationId?: string | null,
  ) {
    await this.tracer.logAuditEvent(
      invitationId,
      "INVITATION_CREATION_EXCEPTION",
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
      auditScope(organizationId),
    );
  }

  async logInvitationResent(
    invitationId: string,
    data: Record<string, unknown>,
    organizationId?: string | null,
  ) {
    await this.tracer.logAuditEvent(
      invitationId,
      "INVITATION_RESENT",
      this.tracer.mergeJsonResponse({ response: data }),
      auditScope(organizationId),
    );
  }

  async logInvitationResentException(
    invitationId: string,
    error: unknown,
    data: Record<string, unknown>,
    organizationId?: string | null,
  ) {
    await this.tracer.logAuditEvent(
      invitationId,
      "INVITATION_RESENT_EXCEPTION",
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
      auditScope(organizationId),
    );
  }

  async logInvitationCancelled(
    invitationId: string,
    data: Record<string, unknown>,
    organizationId?: string | null,
  ) {
    await this.tracer.logAuditEvent(
      invitationId,
      "INVITATION_CANCELLED",
      this.tracer.mergeJsonResponse({ response: data }),
      auditScope(organizationId),
    );
  }

  async logInvitationCancelledException(
    invitationId: string,
    error: unknown,
    data: Record<string, unknown>,
    organizationId?: string | null,
  ) {
    await this.tracer.logAuditEvent(
      invitationId,
      "INVITATION_CANCELLED_EXCEPTION",
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
      auditScope(organizationId),
    );
  }

  async logInvitationReissued(
    invitationId: string,
    data: Record<string, unknown>,
    organizationId?: string | null,
  ) {
    await this.tracer.logAuditEvent(
      invitationId,
      "INVITATION_REISSUED",
      this.tracer.mergeJsonResponse({ response: data }),
      auditScope(organizationId),
    );
  }

  async logInvitationReissuedException(
    invitationId: string,
    error: unknown,
    data: Record<string, unknown>,
    organizationId?: string | null,
  ) {
    await this.tracer.logAuditEvent(
      invitationId,
      "INVITATION_REISSUED_EXCEPTION",
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
      auditScope(organizationId),
    );
  }
}

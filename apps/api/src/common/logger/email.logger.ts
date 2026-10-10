import { Injectable } from "@nestjs/common";
import { TracerService } from "../tracer/tracer.service";
import { auditScope } from "./audit-scope";

@Injectable()
export class EmailLoggerService {
  constructor(private readonly tracer: TracerService) {}

  async logEmailSent(
    contextId: string,
    data: Record<string, unknown>,
    organizationId?: string | null,
  ) {
    await this.tracer.logAuditEvent(
      contextId,
      "EMAIL_SENT",
      this.tracer.mergeJsonResponse({ response: data }),
      auditScope(organizationId),
    );
  }

  async logEmailFailed(
    contextId: string,
    data: Record<string, unknown>,
    organizationId?: string | null,
  ) {
    await this.tracer.logAuditEvent(
      contextId,
      "EMAIL_SEND_FAILED",
      this.tracer.mergeJsonResponse(data),
      auditScope(organizationId),
    );
  }

  async logEmailException(
    contextId: string,
    error: unknown,
    data: Record<string, unknown>,
    organizationId?: string | null,
  ) {
    await this.tracer.logAuditEvent(
      contextId,
      "EMAIL_SEND_EXCEPTION",
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
      auditScope(organizationId),
    );
  }
}

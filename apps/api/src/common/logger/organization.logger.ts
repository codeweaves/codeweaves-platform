import { Injectable } from '@nestjs/common';
import { TracerService } from '../tracer/tracer.service';

@Injectable()
export class OrganizationLoggerService {
  constructor(private readonly tracer: TracerService) {}

  async logOrganizationCreated(orgId: string, data: Record<string, unknown>) {
    await this.tracer.logAuditEvent(
      orgId,
      'ORGANIZATION_CREATED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logOrganizationCreationFailed(
    orgId: string,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      orgId,
      'ORGANIZATION_CREATION_FAILED',
      this.tracer.mergeJsonResponse(data),
    );
  }

  async logOrganizationCreationException(
    orgId: string,
    error: unknown,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      orgId,
      'ORGANIZATION_CREATION_EXCEPTION',
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
    );
  }

  async logOrganizationUpdated(orgId: string, data: Record<string, unknown>) {
    await this.tracer.logAuditEvent(
      orgId,
      'ORGANIZATION_UPDATED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logOrganizationUpdateException(
    orgId: string,
    error: unknown,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      orgId,
      'ORGANIZATION_UPDATE_EXCEPTION',
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
    );
  }
}

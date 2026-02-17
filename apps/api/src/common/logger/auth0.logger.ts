import { Injectable } from '@nestjs/common';
import { TracerService } from '../tracer/tracer.service';

@Injectable()
export class Auth0LoggerService {
  constructor(private readonly tracer: TracerService) {}

  async logAuth0UserCreated(
    contextId: string,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      contextId,
      'AUTH0_USER_CREATED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logAuth0UserCreationFailed(
    contextId: string,
    error: unknown,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      contextId,
      'AUTH0_USER_CREATION_FAILED',
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
    );
  }

  async logAuth0UserDeleted(
    contextId: string,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      contextId,
      'AUTH0_USER_DELETED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logAuth0UserDeletionFailed(
    contextId: string,
    error: unknown,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      contextId,
      'AUTH0_USER_DELETION_FAILED',
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
    );
  }

  async logAuth0PasswordTicketCreated(
    contextId: string,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      contextId,
      'AUTH0_PASSWORD_TICKET_CREATED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logAuth0PasswordTicketFailed(
    contextId: string,
    error: unknown,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      contextId,
      'AUTH0_PASSWORD_TICKET_FAILED',
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
    );
  }
}

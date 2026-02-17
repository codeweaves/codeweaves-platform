import { Injectable } from '@nestjs/common';
import { TracerService } from '../tracer/tracer.service';

@Injectable()
export class UserLoggerService {
  constructor(private readonly tracer: TracerService) {}

  async logUserCreatedFromAuth0(
    userId: string,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      userId,
      'USER_CREATED_FROM_AUTH0',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logUserCreatedFromInvitation(
    userId: string,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      userId,
      'USER_CREATED_FROM_INVITATION',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logUserCreationException(
    userId: string,
    error: unknown,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      userId,
      'USER_CREATION_EXCEPTION',
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
    );
  }

  async logUserProfileUpdated(
    userId: string,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      userId,
      'USER_PROFILE_UPDATED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logUserProfileUpdateException(
    userId: string,
    error: unknown,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      userId,
      'USER_PROFILE_UPDATE_EXCEPTION',
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
    );
  }

  async logUserFirstLogin(userId: string, data: Record<string, unknown>) {
    await this.tracer.logAuditEvent(
      userId,
      'USER_FIRST_LOGIN',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logMemberAssigned(userId: string, data: Record<string, unknown>) {
    await this.tracer.logAuditEvent(
      userId,
      'MEMBER_ASSIGNED_TO_ORGANIZATION',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logMemberRemoved(userId: string, data: Record<string, unknown>) {
    await this.tracer.logAuditEvent(
      userId,
      'MEMBER_REMOVED_FROM_ORGANIZATION',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }
}

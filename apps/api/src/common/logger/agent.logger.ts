import { Injectable } from '@nestjs/common';
import { TracerService } from '../tracer/tracer.service';

@Injectable()
export class AgentLoggerService {
  constructor(private readonly tracer: TracerService) {}

  async logAgentCreated(agentId: string, data: Record<string, unknown>) {
    await this.tracer.logAuditEvent(
      agentId,
      'AGENT_CREATED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logAgentCreationException(
    contextId: string,
    error: unknown,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      contextId,
      'AGENT_CREATION_EXCEPTION',
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
    );
  }

  async logAgentUpdated(agentId: string, data: Record<string, unknown>) {
    await this.tracer.logAuditEvent(
      agentId,
      'AGENT_UPDATED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logAgentUpdateException(
    agentId: string,
    error: unknown,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      agentId,
      'AGENT_UPDATE_EXCEPTION',
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
    );
  }

  async logAgentDeleted(agentId: string, data: Record<string, unknown>) {
    await this.tracer.logAuditEvent(
      agentId,
      'AGENT_DELETED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logDomainsUpdated(agentId: string, data: Record<string, unknown>) {
    await this.tracer.logAuditEvent(
      agentId,
      'AGENT_DOMAINS_UPDATED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logStatusChanged(
    agentId: string,
    data: { oldStatus: string; newStatus: string },
  ) {
    await this.tracer.logAuditEvent(
      agentId,
      'AGENT_STATUS_CHANGED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logSecretCreated(agentId: string, userId: string) {
    await this.tracer.logAuditEvent(
      agentId,
      'AGENT_SECRET_CREATED',
      this.tracer.mergeJsonResponse({ response: { userId } }),
    );
  }

  async logSecretUpdated(agentId: string, userId: string) {
    await this.tracer.logAuditEvent(
      agentId,
      'AGENT_SECRET_UPDATED',
      this.tracer.mergeJsonResponse({ response: { userId } }),
    );
  }

  async logWebhookUpdated(agentId: string, userId: string) {
    await this.tracer.logAuditEvent(
      agentId,
      'AGENT_WEBHOOK_UPDATED',
      this.tracer.mergeJsonResponse({ response: { userId } }),
    );
  }
}

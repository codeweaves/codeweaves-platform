import { Injectable } from '@nestjs/common';

import { TracerService } from '../tracer/tracer.service';

/**
 * Domain logger for third-party agent integrations (HubSpot, Slack, …) and
 * the tool calls the LLM makes against them. Events land in `audit_logs`
 * (fire-and-forget). contextId = agentId.
 *
 * NEVER pass credentials or raw tool payloads containing secrets into `data`
 * — callers log tool names, argument KEYS, durations and outcome summaries.
 */
@Injectable()
export class IntegrationLoggerService {
  constructor(private readonly tracer: TracerService) {}

  async logIntegrationConnected(
    agentId: string,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      agentId,
      'INTEGRATION_CONNECTED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logIntegrationDisconnected(
    agentId: string,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      agentId,
      'INTEGRATION_DISCONNECTED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logIntegrationTest(agentId: string, data: Record<string, unknown>) {
    await this.tracer.logAuditEvent(
      agentId,
      'INTEGRATION_TESTED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  /** One event per LLM tool invocation — success or failure. */
  async logToolCall(agentId: string, data: Record<string, unknown>) {
    await this.tracer.logAuditEvent(
      agentId,
      'INTEGRATION_TOOL_CALLED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logToolCallFailed(
    agentId: string,
    error: unknown,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      agentId,
      'INTEGRATION_TOOL_FAILED',
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
    );
  }
}

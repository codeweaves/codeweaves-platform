import { Injectable, Logger } from '@nestjs/common';
import { tool, type Tool, type ToolSet } from 'ai';

import { IntegrationLoggerService } from '../../common/logger/integration.logger';
import { PrismaService } from '../../services/prisma.service';

import { IntegrationsService } from './integrations.service';
import { ProviderRegistry } from './provider-registry';
import {
  truncateToolResult,
  type ToolStepMeta,
} from './providers/provider.interface';

export interface AgentToolBundle {
  tools: ToolSet;
  /** Step-indicator labels per tool name — consumed by DirectChatService. */
  stepMeta: Record<string, ToolStepMeta>;
}

/**
 * AgentToolsService: assembles the integration tools for one chat turn.
 *
 * Chat hot path — one indexed query on agent_integrations; agents with no
 * integrations pay a single fast SELECT and get null back. Credentials are
 * decrypted per turn and captured only inside the tool closures (never
 * attached to the request or logged).
 *
 * Every `execute` is wrapped with timing + an audit event
 * (INTEGRATION_TOOL_CALLED / INTEGRATION_TOOL_FAILED, fire-and-forget) and a
 * catch-all that converts unexpected errors into a string the model can read
 * — a tool blowing up must degrade the answer, never kill the stream.
 */
@Injectable()
export class AgentToolsService {
  private readonly logger = new Logger(AgentToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly registry: ProviderRegistry,
    private readonly integrationLogger: IntegrationLoggerService,
  ) {}

  async buildToolsForAgent(
    agentId: string,
    context: { sessionId?: string; traceId?: string },
  ): Promise<AgentToolBundle | null> {
    const rows = await this.prisma.agentIntegration.findMany({
      where: { agentId, enabled: true },
    });
    if (rows.length === 0) return null;

    const tools: ToolSet = {};
    const stepMeta: Record<string, ToolStepMeta> = {};

    for (const row of rows) {
      if (!this.registry.has(row.provider)) {
        this.logger.warn(
          `Agent ${agentId} has integration for unknown provider "${row.provider}" — skipping.`,
        );
        continue;
      }
      const def = this.registry.get(row.provider);

      let credentials: Record<string, string>;
      try {
        credentials = this.integrations.decryptCredentials(row);
      } catch (err) {
        // Key rotation / corrupt row — skip this integration, keep the chat alive.
        this.logger.error(
          `Failed to decrypt ${row.provider} credentials for agent ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      const providerTools = def.buildTools(credentials);
      for (const [name, t] of Object.entries(providerTools)) {
        tools[name] = this.wrapExecute(name, row.provider, t, agentId, context);
        stepMeta[name] = def.toolStepMeta[name] ?? {
          activeLabel: 'Working…',
          doneLabel: 'Done',
          errorLabel: 'Step failed',
        };
      }
    }

    return Object.keys(tools).length > 0 ? { tools, stepMeta } : null;
  }

  private wrapExecute(
    toolName: string,
    provider: string,
    original: Tool,
    agentId: string,
    context: { sessionId?: string; traceId?: string },
  ): Tool {
    const execute = original.execute;
    if (!execute) return original;

    return tool({
      ...original,
      execute: async (input: unknown, options: never) => {
        const startedAt = performance.now();
        try {
          const raw = await execute(input as never, options);
          const result =
            typeof raw === 'string' ? truncateToolResult(raw) : raw;
          void this.integrationLogger.logToolCall(agentId, {
            provider,
            tool: toolName,
            // Argument KEYS only — values may contain PII (emails, phones).
            argKeys: Object.keys((input as object) ?? {}),
            durationMs: Math.round(performance.now() - startedAt),
            sessionId: context.sessionId,
            traceId: context.traceId,
            ok: true,
          });
          return result;
        } catch (err) {
          void this.integrationLogger.logToolCallFailed(agentId, err, {
            provider,
            tool: toolName,
            durationMs: Math.round(performance.now() - startedAt),
            sessionId: context.sessionId,
            traceId: context.traceId,
          });
          // Structured error string — the model apologises / falls back
          // instead of the stream dying.
          return `The ${toolName} action failed unexpectedly. Continue helping the user without it.`;
        }
      },
    } as Parameters<typeof tool>[0]) as Tool;
  }
}

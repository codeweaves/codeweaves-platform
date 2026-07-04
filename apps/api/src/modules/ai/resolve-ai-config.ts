import { Logger } from '@nestjs/common';
import {
  agentAiConfigSchema,
  type AgentAiConfigDto,
} from '@repo/validation';

/**
 * Parse a stored aiConfig (JSONB, possibly null/invalid) through the Zod
 * schema so defaults populate consistently. If the stored config is invalid
 * (e.g. old shape from a deploy that landed before the schema updated), log a
 * warning and fall back to schema defaults rather than failing the request.
 *
 * The WARNING is intentionally loud — silently falling back to defaults once
 * cost us ~2 debug cycles (fallback models were being dropped because a Zod
 * max was too low and the error was swallowed).
 *
 * Shared by DirectChatService (chat hot path) and the RAG document services
 * (chunking/retrieval strategy resolution) — one parser, one set of defaults.
 */
export function resolveAiConfig(
  raw: unknown,
  contextLabel = 'resolveAiConfig',
): AgentAiConfigDto {
  const parsed = agentAiConfigSchema.safeParse(raw ?? {});
  if (parsed.success) {
    return parsed.data;
  }
  new Logger(contextLabel).warn(
    `Invalid aiConfig — falling back to schema defaults. Issues: ${parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')}`,
  );
  return agentAiConfigSchema.parse({});
}

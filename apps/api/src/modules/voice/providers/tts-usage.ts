import type { QuantitySource } from "@prisma/client";

import type { UsageMeterService } from "../../usage/usage-meter.service";
import type { VoiceUsageScope } from "./voice-provider.interface";

/** Placeholder agent id of editor voice previews: not a real agent. */
export const PREVIEW_AGENT_ID = "__preview__";

/** Characters as TTS providers bill them: code points, not UTF-16 units. */
export const ttsCharacters = (text: string): number => [...text].length;

/**
 * Record one TTS provider call. Every attempt the provider accepted is
 * recorded, so a sentence that falls back to a second provider is recorded
 * twice: both were billed.
 */
export function recordTtsUsage(
  meter: UsageMeterService,
  call: {
    scope: VoiceUsageScope | undefined;
    /** The request's agent id, used when no scope was passed. */
    agentId: string;
    provider: string;
    model: string;
    characters: number;
    quantitySource: QuantitySource;
    providerRequestId?: string | null;
    latencyMs?: number | null;
  },
): void {
  if (call.characters <= 0) return;
  const scope: VoiceUsageScope = call.scope ?? {
    channel: "VOICE",
    agentId: call.agentId === PREVIEW_AGENT_ID ? null : call.agentId,
  };
  meter.record({
    organizationId: scope.organizationId ?? null,
    agentId: scope.agentId ?? null,
    chatSessionId: scope.chatSessionId ?? null,
    channel: scope.channel,
    feature: scope.feature ?? "TTS",
    provider: call.provider,
    model: call.model,
    providerRequestId: call.providerRequestId ?? null,
    quantities: { characters: call.characters },
    quantitySource: call.quantitySource,
    latencyMs: call.latencyMs ?? null,
  });
}

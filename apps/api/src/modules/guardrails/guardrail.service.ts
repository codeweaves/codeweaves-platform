import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EventChannel } from "@prisma/client";
import type { ModelMessage } from "ai";

import { CryptoService } from "../../common/crypto/crypto.service";
import {
  GuardrailEventLogger,
  type GuardrailEventName,
} from "../../common/events/guardrail.logger";

import { detectInjection, type InjectionVerdict } from "./injection-detector";
import { StreamOutputGuard, type OutputViolation } from "./output-guard";
import { WITHHELD_HISTORY_TURN, securityPreamble } from "./prompt-hardening";

/** Who a guardrail event belongs to. */
export interface GuardrailScope {
  agentId: string;
  organizationId: string;
  /** ChatSession primary key. */
  chatSessionId?: string;
  channel: EventChannel;
  feature: string;
}

/**
 * Guardrails for every AI reply (ADR-0018): input injection checks, history
 * neutralising, the per-agent canary, the output guard and trigger logging.
 *
 * Hot-path cost: pure CPU, no I/O, no per-message DB query, no state.
 */
@Injectable()
export class GuardrailService {
  /** false = AI_GUARDRAILS_MODE=monitor: detect and log, never block or stop. */
  readonly enforce: boolean;

  constructor(
    config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly events: GuardrailEventLogger,
  ) {
    const mode = (config.get<string>("AI_GUARDRAILS_MODE") ?? "enforce")
      .trim()
      .toLowerCase();
    this.enforce = mode !== "monitor";
  }

  /**
   * The agent's canary (see CryptoService.guardrailCanary): unpredictable,
   * per agent, and the same on every instance so the prompt prefix caches.
   */
  canaryFor(agentId: string): string {
    return this.crypto.guardrailCanary(agentId);
  }

  /** The static security block that opens the agent's system prompt. */
  preambleFor(agentId: string): string {
    return securityPreamble(this.canaryFor(agentId));
  }

  /**
   * Classify the visitor's new message. In monitor mode a "block" is
   * downgraded to "neutralize", so the reply still happens.
   */
  inspectInput(text: string): InjectionVerdict {
    const verdict = detectInjection(text);
    if (!this.enforce && verdict.action === "block") {
      return { ...verdict, action: "neutralize" };
    }
    return verdict;
  }

  /**
   * Replace history turns that score a block with a placeholder. History is
   * client-supplied on the widget path, so a forged assistant turn or an old
   * attack must not steer the model; and a turn we already blocked must not
   * re-block every later turn. `skipIndex` is the new user turn (checked
   * separately). Applies in both modes: the visitor never sees it.
   */
  neutralizeHistory(
    messages: ModelMessage[],
    skipIndex: number,
  ): { messages: ModelMessage[]; withheld: number; rules: string[] } {
    let withheld = 0;
    const rules = new Set<string>();
    const out = messages.map((m, i): ModelMessage => {
      if (i === skipIndex) return m;
      if (m.role !== "user" && m.role !== "assistant") return m;
      if (typeof m.content !== "string") return m;
      const verdict = detectInjection(m.content);
      if (verdict.action !== "block") return m;
      withheld++;
      for (const r of verdict.rules) rules.add(r);
      return { ...m, content: WITHHELD_HISTORY_TURN };
    });
    return { messages: out, withheld, rules: [...rules] };
  }

  createOutputGuard(agentId: string): StreamOutputGuard {
    return new StreamOutputGuard({
      canary: this.canaryFor(agentId),
      enforce: this.enforce,
    });
  }

  reportInput(
    scope: GuardrailScope,
    verdict: InjectionVerdict,
    text: string,
  ): void {
    this.emit(
      scope,
      verdict.action === "block"
        ? "AI_GUARDRAIL_INPUT_BLOCKED"
        : "AI_GUARDRAIL_INPUT_NEUTRALIZED",
      // No visitor text at all: rule ids and length only.
      () => ({
        rules: verdict.rules,
        score: verdict.score,
        chars: text.length,
      }),
    );
  }

  reportHistory(
    scope: GuardrailScope,
    withheld: number,
    rules: string[],
  ): void {
    this.emit(scope, "AI_GUARDRAIL_HISTORY_NEUTRALIZED", () => ({
      rules,
      withheldTurns: withheld,
    }));
  }

  /** No text at all: the output may hold the canary or a credential. */
  reportOutput(scope: GuardrailScope, violation: OutputViolation): void {
    this.emit(scope, "AI_GUARDRAIL_OUTPUT_BLOCKED", () => ({
      rules: [violation.rule],
      stopped: this.enforce,
    }));
  }

  /** Never throws, never awaits: a logging fault must not touch the reply. */
  private emit(
    scope: GuardrailScope,
    eventName: GuardrailEventName,
    details: () => Record<string, unknown>,
  ): void {
    try {
      this.events.log({
        channel: scope.channel,
        eventName,
        agentId: scope.agentId,
        organizationId: scope.organizationId,
        sessionId: scope.chatSessionId,
        metadata: {
          ...details(),
          mode: this.enforce ? "enforce" : "monitor",
          feature: scope.feature,
        },
      });
    } catch {
      // Swallowed by design.
    }
  }
}

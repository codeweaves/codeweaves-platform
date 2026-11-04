import { GuardrailEventLogger } from "../../../src/common/events/guardrail.logger";
import type { TracerService } from "../../../src/common/tracer/tracer.service";

const event = {
  channel: "WIDGET" as const,
  eventName: "AI_GUARDRAIL_INPUT_BLOCKED" as const,
  agentId: "agent-1",
  organizationId: "org-1",
  sessionId: "sess-1",
  metadata: { rules: ["override_instructions"] },
};

describe("GuardrailEventLogger", () => {
  it("writes one event_logs row with the scope and metadata", () => {
    const logEvent = jest.fn().mockResolvedValue(undefined);
    new GuardrailEventLogger({ logEvent } as unknown as TracerService).log(
      event,
    );
    expect(logEvent).toHaveBeenCalledWith({
      channel: "WIDGET",
      eventName: "AI_GUARDRAIL_INPUT_BLOCKED",
      direction: "INTERNAL",
      agentId: "agent-1",
      organizationId: "org-1",
      sessionId: "sess-1",
      success: true,
      metadata: { rules: ["override_instructions"] },
    });
  });

  it("never throws when the tracer throws synchronously", () => {
    const logEvent = jest.fn(() => {
      throw new Error("boom");
    });
    const logger = new GuardrailEventLogger({
      logEvent,
    } as unknown as TracerService);
    expect(() => logger.log(event)).not.toThrow();
  });

  it("swallows an async rejection (no unhandled rejection)", async () => {
    const logEvent = jest.fn().mockRejectedValue(new Error("db down"));
    const logger = new GuardrailEventLogger({
      logEvent,
    } as unknown as TracerService);
    expect(() => logger.log(event)).not.toThrow();
    // Let the rejected promise settle; jest fails on unhandled rejections.
    await new Promise((r) => setImmediate(r));
    expect(logEvent).toHaveBeenCalled();
  });
});

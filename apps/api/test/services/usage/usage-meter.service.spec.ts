import { Prisma } from "@prisma/client";
import { UsageMeterService } from "../../../src/modules/usage/usage-meter.service";

describe("UsageMeterService", () => {
  const create = jest.fn();
  const price = jest.fn();
  const meter = () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new UsageMeterService({ usageRecord: { create } } as any, { price } as any);

  const event = {
    organizationId: "org-1",
    agentId: "agent-1",
    chatSessionId: "cs-1",
    channel: "WIDGET" as const,
    feature: "CHAT" as const,
    provider: "openai",
    model: "gpt-4.1-mini",
    quantities: {
      inputTokens: 5000,
      cachedInputTokens: 3968,
      outputTokens: 300,
    },
    quantitySource: "PROVIDER_REPORTED" as const,
    latencyMs: 812,
  };

  beforeEach(() => {
    create.mockReset();
    price.mockReset();
    jest.useRealTimers();
  });

  it("writes one priced row with the quantities, cost and pricing snapshot", async () => {
    price.mockResolvedValue({
      cost: 0.0012896,
      currency: "USD",
      lines: [{ unit: "INPUT_TOKEN", quantity: 1032 }],
    });
    create.mockResolvedValue({});

    await meter().write(event);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        chatSessionId: "cs-1",
        provider: "openai",
        model: "gpt-4.1-mini",
        inputTokens: 5000,
        cachedInputTokens: 3968,
        outputTokens: 300,
        cost: 0.0012896,
        currency: "USD",
        pricing: [{ unit: "INPUT_TOKEN", quantity: 1032 }],
        quantitySource: "PROVIDER_REPORTED",
        billedTo: "PLATFORM",
        latencyMs: 812,
      }),
    });
  });

  it("still records an unpriced call, with cost null", async () => {
    price.mockResolvedValue({ cost: null, currency: null, lines: [] });
    create.mockResolvedValue({});
    await meter().write(event);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cost: null,
        currency: null,
        inputTokens: 5000,
      }),
    });
  });

  it("retries a failed insert once", async () => {
    price.mockResolvedValue({ cost: 0, currency: null, lines: [] });
    create.mockRejectedValueOnce(new Error("blip")).mockResolvedValueOnce({});
    await meter().write(event);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("never throws into the caller, even when both attempts fail", async () => {
    price.mockResolvedValue({ cost: 0, currency: null, lines: [] });
    create.mockRejectedValue(new Error("db down"));
    await expect(meter().write(event)).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("record() is fire-and-forget: returns immediately and swallows errors", () => {
    price.mockRejectedValue(new Error("pricing broke"));
    expect(() => meter().record(event)).not.toThrow();
  });

  it("stores the call unpriced when pricing throws, instead of dropping it", async () => {
    price.mockRejectedValue(new Error("bad price row"));
    create.mockResolvedValue({});
    await meter().write(event);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ cost: null, inputTokens: 5000 }),
    });
  });

  it("keeps the cost when an erasure removed the conversation mid-write (FK violation)", async () => {
    price.mockResolvedValue({ cost: 0.001, currency: "USD", lines: [] });
    const fkError = new Prisma.PrismaClientKnownRequestError("fk", {
      code: "P2003",
      clientVersion: "test",
    });
    create.mockRejectedValueOnce(fkError).mockResolvedValueOnce({});
    await meter().write(event);
    expect(create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        chatSessionId: null,
        agentId: null,
        cost: 0.001,
      }),
    });
  });

  it("waits for in-flight writes on shutdown", async () => {
    price.mockResolvedValue({ cost: 0, currency: null, lines: [] });
    let finish!: () => void;
    create.mockReturnValue(new Promise<void>((r) => (finish = r)));
    const m = meter();
    m.record(event);
    let drained = false;
    const shutdown = m.onModuleDestroy().then(() => (drained = true));
    await new Promise((r) => setImmediate(r));
    expect(drained).toBe(false);
    finish();
    await shutdown;
    expect(drained).toBe(true);
  });
});

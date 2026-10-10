import { PriceCatalogService } from "../../../src/modules/usage/price-catalog.service";

const row = (
  model: string,
  unit: string,
  price: number,
  effectiveFrom: string,
  provider = "openai",
) => ({
  id: `${model}-${unit}-${effectiveFrom}`,
  provider,
  model,
  unit,
  price,
  per: 1_000_000,
  currency: "USD",
  effectiveFrom: new Date(effectiveFrom),
});

describe("PriceCatalogService", () => {
  const findMany = jest.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = () =>
    new PriceCatalogService({ providerPrice: { findMany } } as any);

  beforeEach(() => findMany.mockReset());

  it("uses the price in effect at the call's time, not the newest one", async () => {
    findMany.mockResolvedValue([
      row("gpt-4.1-mini", "INPUT_TOKEN", 0.4, "2026-01-01"),
      row("gpt-4.1-mini", "INPUT_TOKEN", 0.5, "2026-11-01"),
    ]);
    const catalog = svc();
    const before = await catalog.price(
      "openai",
      "gpt-4.1-mini",
      { inputTokens: 1_000_000 },
      new Date("2026-10-15"),
    );
    const after = await catalog.price(
      "openai",
      "gpt-4.1-mini",
      { inputTokens: 1_000_000 },
      new Date("2026-11-02"),
    );
    expect(before.cost).toBe(0.4);
    expect(after.cost).toBe(0.5);
  });

  it("prices a dated OpenAI snapshot as its base model", async () => {
    findMany.mockResolvedValue([
      row("gpt-4.1-mini", "INPUT_TOKEN", 0.4, "2026-01-01"),
    ]);
    const r = await svc().price(
      "openai",
      "gpt-4.1-mini-2025-04-14",
      { inputTokens: 1_000_000 },
      new Date("2026-10-10"),
    );
    expect(r.cost).toBe(0.4);
  });

  it("falls back to a provider-wide '*' price", async () => {
    findMany.mockResolvedValue([
      row("*", "CHARACTER", 30, "2026-01-01", "sarvam"),
    ]);
    const r = await svc().price(
      "sarvam",
      "bulbul:v9",
      { characters: 1_000_000 },
      new Date(),
    );
    expect(r.cost).toBe(30);
  });

  it("does not use another provider's price for the same model name", async () => {
    findMany.mockResolvedValue([
      row("gpt-4.1-mini", "INPUT_TOKEN", 0.4, "2026-01-01"),
    ]);
    const r = await svc().price(
      "gemini",
      "gpt-4.1-mini",
      { inputTokens: 10 },
      new Date(),
    );
    expect(r.cost).toBeNull();
  });

  it("reads the table once per refresh window, not per call", async () => {
    findMany.mockResolvedValue([
      row("gpt-4.1-mini", "INPUT_TOKEN", 0.4, "2026-01-01"),
    ]);
    const catalog = svc();
    await Promise.all(
      Array.from({ length: 5 }, () =>
        catalog.price("openai", "gpt-4.1-mini", { inputTokens: 1 }, new Date()),
      ),
    );
    expect(findMany).toHaveBeenCalledTimes(1);
    catalog.invalidate();
    await catalog.price(
      "openai",
      "gpt-4.1-mini",
      { inputTokens: 1 },
      new Date(),
    );
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("records calls unpriced, rather than failing, when the price list cannot load", async () => {
    findMany.mockRejectedValue(new Error("db down"));
    const r = await svc().price(
      "openai",
      "gpt-4.1-mini",
      { inputTokens: 10 },
      new Date(),
    );
    expect(r.cost).toBeNull();
  });
});

import type { PriceUnit } from "@prisma/client";
import {
  billableQuantities,
  priceCall,
  type UnitPrice,
} from "../../../src/modules/usage/pricing";

/** Build a lookup from `unit → [price, per, currency]`. */
function prices(
  table: Partial<Record<PriceUnit, [number, number, "USD" | "INR"]>>,
): (unit: PriceUnit) => UnitPrice | undefined {
  return (unit) => {
    const row = table[unit];
    return row
      ? { id: `p-${unit}`, unit, price: row[0], per: row[1], currency: row[2] }
      : undefined;
  };
}

const GPT_41_MINI = prices({
  INPUT_TOKEN: [0.4, 1_000_000, "USD"],
  CACHED_INPUT_TOKEN: [0.1, 1_000_000, "USD"],
  OUTPUT_TOKEN: [1.6, 1_000_000, "USD"],
});

describe("pricing (ADR-0012)", () => {
  describe("LLM tokens", () => {
    it("bills uncached input, cached input and output separately (worked example from docs/research/provider-costs/llm.md)", () => {
      // 5,000 input of which 3,968 cached, 300 output on gpt-4.1-mini:
      // 1032×0.40 + 3968×0.10 + 300×1.60 = 1289.6 per 1M → $0.0012896.
      const r = priceCall(
        "openai",
        { inputTokens: 5000, cachedInputTokens: 3968, outputTokens: 300 },
        GPT_41_MINI,
      );
      expect(r.cost).toBe(0.0012896);
      expect(r.currency).toBe("USD");
      expect(r.lines.map((l) => [l.unit, l.quantity])).toEqual([
        ["INPUT_TOKEN", 1032],
        ["CACHED_INPUT_TOKEN", 3968],
        ["OUTPUT_TOKEN", 300],
      ]);
    });

    it("does not bill reasoning tokens on top of output (already inside it)", () => {
      const withReasoning = priceCall(
        "openai",
        { inputTokens: 100, outputTokens: 400, reasoningTokens: 350 },
        GPT_41_MINI,
      );
      const without = priceCall(
        "openai",
        { inputTokens: 100, outputTokens: 400 },
        GPT_41_MINI,
      );
      expect(withReasoning.cost).toBe(without.cost);
    });

    it("subtracts cache writes from input and bills them at their own rate", () => {
      const q = billableQuantities("anthropic", {
        inputTokens: 1000,
        cachedInputTokens: 200,
        cacheWriteTokens: 300,
        outputTokens: 10,
      });
      expect(q).toEqual({
        INPUT_TOKEN: 500,
        CACHED_INPUT_TOKEN: 200,
        CACHE_WRITE_TOKEN: 300,
        OUTPUT_TOKEN: 10,
      });
    });

    it("prices Sarvam chat in INR", () => {
      const r = priceCall(
        "sarvam",
        { inputTokens: 1_000_000, outputTokens: 1_000_000 },
        prices({
          INPUT_TOKEN: [29.28, 1_000_000, "INR"],
          OUTPUT_TOKEN: [73.2, 1_000_000, "INR"],
        }),
      );
      expect(r).toMatchObject({ cost: 102.48, currency: "INR" });
    });
  });

  describe("speech", () => {
    const SARVAM_STT = prices({ AUDIO_SECOND: [30, 3600, "INR"] });

    it("rounds Sarvam audio up to whole seconds with a 1 s minimum", () => {
      expect(billableQuantities("sarvam", { audioSeconds: 7.4 })).toEqual({
        AUDIO_SECOND: 8,
      });
      expect(billableQuantities("sarvam", { audioSeconds: 0.3 })).toEqual({
        AUDIO_SECOND: 1,
      });
      // 8 s × ₹30/3600 s
      expect(priceCall("sarvam", { audioSeconds: 7.4 }, SARVAM_STT).cost).toBe(
        0.06666667,
      );
    });

    it("bills Deepgram audio by the exact duration", () => {
      const r = priceCall(
        "deepgram",
        { audioSeconds: 7.4 },
        prices({ AUDIO_SECOND: [0.0043, 60, "USD"] }),
      );
      // 7.4 × 0.0043 / 60
      expect(r).toMatchObject({ cost: 0.00053033, currency: "USD" });
    });

    it("bills TTS per character", () => {
      const r = priceCall(
        "sarvam",
        { characters: 180 },
        prices({ CHARACTER: [30, 10_000, "INR"] }),
      );
      expect(r).toMatchObject({ cost: 0.54, currency: "INR" });
    });
  });

  describe("unpriced and empty calls", () => {
    it("returns cost null (not 0) when a billed unit has no price, and keeps the quantities", () => {
      const r = priceCall(
        "openai",
        { inputTokens: 100, cachedInputTokens: 50, outputTokens: 10 },
        prices({
          INPUT_TOKEN: [0.4, 1_000_000, "USD"],
          OUTPUT_TOKEN: [1.6, 1_000_000, "USD"],
        }),
      );
      expect(r.cost).toBeNull();
      expect(r.currency).toBeNull();
      expect(
        r.lines.find((l) => l.unit === "CACHED_INPUT_TOKEN"),
      ).toMatchObject({
        quantity: 50,
        priceId: null,
      });
    });

    it("returns cost null when prices mix currencies", () => {
      const r = priceCall(
        "x",
        { inputTokens: 10, outputTokens: 10 },
        prices({
          INPUT_TOKEN: [1, 1, "USD"],
          OUTPUT_TOKEN: [1, 1, "INR"],
        }),
      );
      expect(r.cost).toBeNull();
    });

    it("costs 0 when nothing billable was used", () => {
      expect(priceCall("openai", { inputTokens: 0 }, GPT_41_MINI)).toEqual({
        cost: 0,
        currency: null,
        lines: [],
      });
    });

    it("prices a unit count as whichever of MESSAGE or EMAIL has a price", () => {
      const r = priceCall(
        "resend",
        { units: 5 },
        prices({ EMAIL: [0.9, 1000, "USD"] }),
      );
      expect(r).toMatchObject({ cost: 0.0045, currency: "USD" });
      expect(r.lines).toHaveLength(1);
    });
  });
});

import { BadRequestException } from "@nestjs/common";
import {
  pageMeta,
  resolveWindow,
  scrubUrl,
  truncate,
} from "../../../src/modules/ops-console/ops-console.util";

describe("ops-console util", () => {
  describe("resolveWindow", () => {
    const now = new Date("2026-10-10T00:00:00.000Z");

    it("fills a missing from with the default span before to", () => {
      const w = resolveWindow({}, 60_000, 1, now);
      expect(w).toEqual({ from: new Date(now.getTime() - 60_000), to: now });
    });

    it("rejects from after to", () => {
      expect(() =>
        resolveWindow(
          { from: "2026-10-09T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" },
          1,
          30,
          now,
        ),
      ).toThrow(BadRequestException);
    });
  });

  it("pageMeta never reports more than the cap", () => {
    expect(pageMeta(1, 20, 37)).toEqual({
      page: 1,
      limit: 20,
      total: 37,
      totalPages: 2,
      totalCapped: false,
    });
  });

  describe("scrubUrl", () => {
    it("leaves a clean URL untouched", () => {
      expect(scrubUrl("https://api.openai.com/v1/responses")).toBe(
        "https://api.openai.com/v1/responses",
      );
      expect(scrubUrl(null)).toBeNull();
    });

    it("redacts userinfo and credential query values", () => {
      const out = scrubUrl(
        "https://user:pass@graph.facebook.com/v20.0/me?access_token=EAAG&fields=id",
      )!;
      expect(out).not.toContain("pass");
      expect(out).not.toContain("EAAG");
      expect(out).toContain("fields=id");
    });

    it("keeps relative routes relative", () => {
      expect(
        scrubUrl("/api/klivo/v1/whatsapp/webhook?hub.verify_token=abc&x=1"),
      ).toBe("/api/klivo/v1/whatsapp/webhook?hub.verify_token=REDACTED&x=1");
    });
  });

  it("truncate marks cut text", () => {
    expect(truncate("abcdef", 3)).toBe("abc…");
    expect(truncate("abc", 3)).toBe("abc");
  });
});

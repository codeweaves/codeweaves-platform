import {
  contrastRatio,
  checkContrast,
  suggestAccessible,
  CONTRAST_THRESHOLDS,
} from "@repo/validation";

/**
 * Reference values cross-checked against the WCAG 2.1 formula. These are the
 * numbers an auditor's tool reports, so they are the contract: if this maths
 * drifts, the editor tells customers a colour is fine when an audit will fail it.
 */
describe("contrastRatio", () => {
  it("returns 21:1 for black on white, the maximum", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("returns 1:1 for a colour against itself", () => {
    expect(contrastRatio("#3b82f6", "#3b82f6")).toBeCloseTo(1, 5);
  });

  it("is symmetric: order of arguments does not matter", () => {
    const a = contrastRatio("#3b82f6", "#ffffff");
    const b = contrastRatio("#ffffff", "#3b82f6");
    expect(a).toBeCloseTo(b as number, 10);
  });

  it.each([
    ["#3b82f6", "#ffffff", 3.68], // default primary blue on white
    ["#9ca3af", "#ffffff", 2.54], // the old default grey
    ["#6b7280", "#ffffff", 4.83], // its replacement
    ["#2563eb", "#ffffff", 5.17], // branding link replacement
    ["#F6F0DE", "#45461E", 8.58], // a real customer's header
  ])("%s on %s is about %s:1", (fg, bg, expected) => {
    expect(contrastRatio(fg, bg)).toBeCloseTo(expected, 1);
  });

  it("accepts 3-digit hex and treats it as the expanded form", () => {
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(
      contrastRatio("#ffffff", "#000000") as number,
      10,
    );
  });

  it("accepts hex without a leading hash", () => {
    expect(contrastRatio("ffffff", "000000")).toBeCloseTo(21, 5);
  });

  // Returning null rather than throwing keeps a malformed value from breaking
  // the editor; the caller just shows nothing.
  it.each(["", "not-a-colour", "#12345", "rgb(0,0,0)", "#12345g"])(
    "returns null for unparseable input %p",
    (bad) => {
      expect(contrastRatio(bad, "#ffffff")).toBeNull();
    },
  );
});

describe("checkContrast", () => {
  it("passes body text at or above 4.5:1", () => {
    const r = checkContrast("#6b7280", "#ffffff", "text");
    expect(r).toEqual({
      ratio: 4.83,
      required: 4.5,
      passes: true,
      level: "text",
    });
  });

  it("fails body text below 4.5:1", () => {
    const r = checkContrast("#9ca3af", "#ffffff", "text");
    expect(r?.passes).toBe(false);
    expect(r?.ratio).toBe(2.54);
  });

  // The same colour that fails as body text passes as an icon, because WCAG
  // 1.4.11 sets a lower bar for non-text. Getting this wrong would flag every
  // send button in the product.
  it("passes the same colour at the ui threshold that fails as text", () => {
    expect(checkContrast("#3b82f6", "#ffffff", "text")?.passes).toBe(false);
    expect(checkContrast("#3b82f6", "#ffffff", "ui")?.passes).toBe(true);
  });

  it("defaults to the strictest level when none is given", () => {
    expect(checkContrast("#3b82f6", "#ffffff")?.required).toBe(
      CONTRAST_THRESHOLDS.text,
    );
  });

  it("rounds before comparing, so a displayed 4.5 never reads as failing", () => {
    const r = checkContrast("#767676", "#ffffff", "text");
    expect(r).not.toBeNull();
    if (r!.ratio === r!.required) expect(r!.passes).toBe(true);
  });

  it("returns null when a colour cannot be parsed", () => {
    expect(checkContrast("nope", "#ffffff")).toBeNull();
  });
});

describe("suggestAccessible", () => {
  it("returns a colour that actually passes", () => {
    const fixed = suggestAccessible("#C0A24E", "#ffffff", "text");
    expect(fixed).not.toBeNull();
    expect(checkContrast(fixed as string, "#ffffff", "text")?.passes).toBe(
      true,
    );
  });

  it("keeps the hue rather than returning grey", () => {
    // A gold darkened toward black stays gold: red highest, blue lowest.
    const fixed = suggestAccessible("#C0A24E", "#ffffff", "text") as string;
    // Defaults keep noUncheckedIndexedAccess happy; a 6-digit hex always
    // yields exactly three pairs, so they are never actually used.
    const [r = 0, g = 0, b = 0] = (fixed.slice(1).match(/../g) as string[]).map(
      (h) => parseInt(h, 16),
    );
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it("lightens instead of darkening when the background is dark", () => {
    const fixed = suggestAccessible("#45461E", "#232219", "text");
    expect(fixed).not.toBeNull();
    expect(checkContrast(fixed as string, "#232219", "text")?.passes).toBe(
      true,
    );
  });

  it("leaves an already-passing colour able to pass", () => {
    const fixed = suggestAccessible("#000000", "#ffffff", "text");
    expect(checkContrast(fixed as string, "#ffffff", "text")?.passes).toBe(
      true,
    );
  });

  it("returns null for unparseable input", () => {
    expect(suggestAccessible("nope", "#ffffff")).toBeNull();
  });
});

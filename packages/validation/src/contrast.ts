/**
 * WCAG 2.1 colour-contrast maths.
 *
 * Why this exists: every widget colour is customer-chosen (28 of them), and a
 * client accessibility audit flagged contrast failures on a live agent. Defaults
 * only ever set a floor. The thing that actually scales is telling the person
 * picking the colour, at the moment they pick it, that it will fail.
 *
 * Spec: https://www.w3.org/TR/WCAG21/#contrast-minimum
 */

/** Minimum ratios from WCAG 2.1 AA. */
export const CONTRAST_THRESHOLDS = {
  /** Body text below 18.66px bold / 24px regular. */
  text: 4.5,
  /** Large text: >= 24px regular, or >= 18.66px bold. */
  large: 3,
  /** Icons, borders and other non-text UI (WCAG 1.4.11). */
  ui: 3,
} as const;

export type ContrastLevel = keyof typeof CONTRAST_THRESHOLDS;

/** #rgb, #rrggbb or bare hex, to [r, g, b] 0-255. Null when unparseable. */
function parseHex(hex: string): [number, number, number] | null {
  const h = hex.trim().replace(/^#/, "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
  const [rl, gl, bl] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/**
 * Contrast ratio between two colours, 1 to 21. Returns null if either colour
 * cannot be parsed, so callers can stay silent rather than show a wrong number.
 *
 * Note: alpha is not supported. Every widget theme colour is opaque hex.
 */
export function contrastRatio(a: string, b: string): number | null {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return null;
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

export interface ContrastResult {
  /** Rounded to 2dp, matching how audit tools report it. */
  ratio: number;
  required: number;
  passes: boolean;
  level: ContrastLevel;
}

/** Check a foreground against a background. Null when either is unparseable. */
export function checkContrast(
  foreground: string,
  background: string,
  level: ContrastLevel = "text",
): ContrastResult | null {
  const raw = contrastRatio(foreground, background);
  if (raw === null) return null;
  const required = CONTRAST_THRESHOLDS[level];
  // Round before comparing, so a 4.497 does not read as "4.5:1 but failing".
  const ratio = Math.round(raw * 100) / 100;
  return { ratio, required, passes: ratio >= required, level };
}

/**
 * Darken a colour toward black, keeping its hue, until it clears the threshold.
 * Used to suggest an on-brand fix rather than telling someone to pick grey.
 *
 * Returns null when even black fails, which only happens against a very dark
 * background, where the caller should suggest lightening instead.
 */
export function suggestAccessible(
  foreground: string,
  background: string,
  level: ContrastLevel = "text",
): string | null {
  const rgb = parseHex(foreground);
  if (!rgb || contrastRatio(foreground, background) === null) return null;
  const required = CONTRAST_THRESHOLDS[level];

  const at = (factor: number): string =>
    "#" +
    (rgb.map((v) => Math.round(v * factor)) as [number, number, number])
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();

  // Darkening first: it preserves hue better than washing toward white.
  for (let f = 1; f >= 0; f -= 0.01) {
    const candidate = at(f);
    const r = contrastRatio(candidate, background);
    if (r !== null && r >= required) return candidate;
  }

  // Background is dark enough that nothing darker works. Try lightening.
  for (let f = 0; f <= 1; f += 0.01) {
    const lightened =
      "#" +
      (
        rgb.map((v) => Math.round(v + (255 - v) * f)) as [
          number,
          number,
          number,
        ]
      )
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
    const r = contrastRatio(lightened, background);
    if (r !== null && r >= required) return lightened;
  }

  return null;
}

import {
  PAGE_URL_MAX_LENGTH,
  pageUrlInputSchema,
  sanitizePageUrl,
  sendMessageSchema,
} from "@repo/validation";
import { sanitizePageUrl as widgetSanitizePageUrl } from "@repo/validation/page-url";

/** The page-URL cleaning rules (ADR-0020). */
describe("sanitizePageUrl", () => {
  it("keeps the origin and path", () => {
    expect(sanitizePageUrl("https://shop.com/pricing")).toBe(
      "https://shop.com/pricing",
    );
  });

  it("keeps utm_* tags and drops every other query parameter", () => {
    expect(
      sanitizePageUrl(
        "https://shop.com/pricing?utm_source=facebook&email=ravi@gmail.com&utm_campaign=diwali_sale&token=abc",
      ),
    ).toBe(
      "https://shop.com/pricing?utm_source=facebook&utm_campaign=diwali_sale",
    );
  });

  it("matches utm keys case-insensitively and keeps their spelling", () => {
    expect(sanitizePageUrl("https://s.com/?UTM_Source=x&ref=1")).toBe(
      "https://s.com/?UTM_Source=x",
    );
  });

  it("drops the fragment and any user:pass@ credentials", () => {
    expect(sanitizePageUrl("https://user:pw@s.com/reset#token=abc")).toBe(
      "https://s.com/reset",
    );
  });

  it("accepts http as well as https", () => {
    expect(sanitizePageUrl("http://localhost:3000/a")).toBe(
      "http://localhost:3000/a",
    );
  });

  it.each([
    ["javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["file:///etc/passwd"],
    ["not a url"],
    [""],
    [undefined],
    [42],
  ])("rejects %p", (raw) => {
    expect(sanitizePageUrl(raw)).toBeNull();
  });

  it("rejects a cleaned URL longer than the column", () => {
    const longPath = "a".repeat(PAGE_URL_MAX_LENGTH);
    expect(sanitizePageUrl(`https://s.com/${longPath}`)).toBeNull();
  });

  it("lets a long URL through when only the dropped query made it long", () => {
    const longQuery = "x".repeat(PAGE_URL_MAX_LENGTH);
    expect(sanitizePageUrl(`https://s.com/a?junk=${longQuery}`)).toBe(
      "https://s.com/a",
    );
  });
});

describe("pageUrlInputSchema", () => {
  it("never fails a message: a bad value becomes undefined", () => {
    expect(pageUrlInputSchema.parse(123)).toBeUndefined();
    expect(pageUrlInputSchema.parse("x".repeat(9000))).toBeUndefined();
    expect(pageUrlInputSchema.parse(undefined)).toBeUndefined();
  });

  it("passes a normal string through for the server to clean", () => {
    expect(pageUrlInputSchema.parse("https://s.com/a?b=1")).toBe(
      "https://s.com/a?b=1",
    );
  });

  it("is optional on sendMessageSchema, and a bad value does not reject the message", () => {
    const base = { chatInput: "hi", agentId: "abc12345" };
    expect(sendMessageSchema.safeParse(base).success).toBe(true);
    const parsed = sendMessageSchema.safeParse({
      ...base,
      pageUrl: { bad: 1 },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.pageUrl).toBeUndefined();
  });
});

describe("the widget entry (@repo/validation/page-url)", () => {
  it("is the same cleaning the API runs, so the two sides cannot drift", () => {
    const raw =
      "https://user:pw@shop.com/pricing?utm_source=fb&email=a@b.com#frag";
    expect(widgetSanitizePageUrl(raw)).toBe(sanitizePageUrl(raw));
    expect(widgetSanitizePageUrl(raw)).toBe(
      "https://shop.com/pricing?utm_source=fb",
    );
  });
});

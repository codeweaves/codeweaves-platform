import { clientIp, trustProxyHops } from "../../src/utils/client-ip";

describe("clientIp", () => {
  it("returns the proxy-derived request.ip", () => {
    expect(clientIp({ ip: "198.51.100.7" })).toBe("198.51.100.7");
  });

  it("returns undefined for a missing or empty ip, never a header value", () => {
    expect(clientIp({})).toBeUndefined();
    expect(clientIp({ ip: "" })).toBeUndefined();
  });
});

describe("trustProxyHops", () => {
  it("defaults to 1 when unset or blank", () => {
    expect(trustProxyHops(undefined)).toBe(1);
    expect(trustProxyHops("")).toBe(1);
    expect(trustProxyHops("   ")).toBe(1);
  });

  it("accepts a plain non-negative integer, including 0", () => {
    expect(trustProxyHops("0")).toBe(0);
    expect(trustProxyHops("2")).toBe(2);
    expect(trustProxyHops(" 3 ")).toBe(3);
  });

  it.each(["1.5", "2abc", "2 # cloudflare", "-1", "two"])(
    "falls back to 1 for %p instead of guessing a hop count",
    (raw) => {
      expect(trustProxyHops(raw)).toBe(1);
    },
  );
});

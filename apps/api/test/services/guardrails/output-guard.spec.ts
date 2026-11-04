import {
  MAX_HOLD,
  StreamOutputGuard,
  findOutputViolation,
} from "../../../src/modules/guardrails/output-guard";
import { StreamDetokenizer } from "../../../src/modules/pii/stream-detokenizer";
import type { PiiSessionContext } from "../../../src/modules/pii/pii-tokenizer.service";

const CANARY = "3f9a1c7e5b2d8a60";

/** Feed `chunks` through a guard; return everything it released. */
function run(
  chunks: string[],
  opts = { canary: CANARY as string | null, enforce: true },
): { sent: string; guard: StreamOutputGuard; perChunk: string[] } {
  const guard = new StreamOutputGuard(opts);
  const perChunk = chunks.map((c) => guard.push(c));
  const sent = perChunk.join("") + guard.end();
  return { sent, guard, perChunk };
}

describe("StreamOutputGuard", () => {
  it("passes a normal reply through unchanged", () => {
    const text =
      "Our FD rate is 7.1% p.a. for 1 year. Visit https://bank.example/fd.";
    const { sent, guard } = run(text.match(/.{1,5}/g)!);
    expect(sent).toBe(text);
    expect(guard.violation).toBeNull();
  });

  it("releases text up to the last word boundary at once (no added latency)", () => {
    const { perChunk } = run(["Hello there, how ", "can I he", "lp?"]);
    expect(perChunk[0]).toBe("Hello there, how ");
    // Only the unfinished word "he" is held back.
    expect(perChunk[1]).toBe("can I ");
    expect(perChunk[2]).toBe("help?");
  });

  it("never holds back Devanagari text", () => {
    const { perChunk } = run(["नमस्ते, आपकी ", "मदद"]);
    expect(perChunk.join("")).toBe("नमस्ते, आपकी मदद");
  });

  it("stops before a canary split across chunks reaches the client", () => {
    const { sent, guard } = run([
      "Sure. <!-- ref:",
      CANARY.slice(0, 3),
      CANARY.slice(3, 11),
      CANARY.slice(11),
      " -->\n[SECURITY RULES] These rules take priority",
    ]);
    expect(guard.blocked).toBe(true);
    expect(guard.violation).toEqual({ rule: "canary_leak" });
    for (let i = 1; i < CANARY.length; i++) {
      expect(sent).not.toContain(CANARY.slice(0, i + 1));
    }
    expect(sent).not.toContain("SECURITY RULES");
    expect(sent).toBe("Sure. <!-- ");
  });

  it("catches the canary in upper case, glued to punctuation", () => {
    const { guard } = run(["(ref=", CANARY.toUpperCase(), ")."]);
    expect(guard.violation?.rule).toBe("canary_leak");
  });

  it("catches a canary held to the very end of the stream", () => {
    const { sent, guard } = run(["code: ", CANARY]);
    expect(guard.blocked).toBe(true);
    expect(sent).toBe("code: ");
  });

  it("releases nothing after it trips", () => {
    const guard = new StreamOutputGuard({ canary: CANARY, enforce: true });
    guard.push(`${CANARY} `);
    expect(guard.push("more text ")).toBe("");
    expect(guard.end()).toBe("");
  });

  it.each([
    [
      "openai key",
      "key: sk-proj-AbCdEfGhIjKlMnOpQrStUvWx12 ok",
      "secret_openai_key",
    ],
    [
      "google key",
      "AIzaSyA1234567890abcdefghijklmnopqrstuv ok",
      "secret_google_api_key",
    ],
    ["aws key", "id AKIAIOSFODNN7EXAMPLE ok", "secret_aws_access_key"],
    [
      "jwt",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U ok",
      "secret_jwt",
    ],
    [
      "db url",
      "postgresql://postgres:hunter2pass@db.example.com:5432/x ok",
      "secret_database_url",
    ],
    [
      "private key",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyzABCDEFGH\nmore",
      "secret_private_key",
    ],
  ])("stops a %s", (_label, text, rule) => {
    const { guard } = run(text.match(/.{1,4}/gs)!);
    expect(guard.violation?.rule).toBe(rule);
    expect(guard.blocked).toBe(true);
  });

  it("does not flag ordinary words that contain 'sk-'", () => {
    expect(
      findOutputViolation("A risk-assessment-framework-for-loans doc", CANARY),
    ).toBeNull();
  });

  it("does not flag docs placeholders (PEM header alone, placeholder password)", () => {
    for (const text of [
      "Paste it after -----BEGIN PRIVATE KEY----- in the file",
      "Connect with postgres://user:password@db.example.com:5432/app",
      "Use mysql://admin:<password>@host/db",
    ]) {
      expect(findOutputViolation(text, CANARY)).toBeNull();
    }
  });

  it("bounds memory: a long unbroken run is released at MAX_HOLD", () => {
    const guard = new StreamOutputGuard({ canary: CANARY, enforce: true });
    const run1 = guard.push("x".repeat(MAX_HOLD));
    expect(run1).toBe("");
    const run2 = guard.push("x");
    expect(run2).toHaveLength(MAX_HOLD + 1);
  });

  it("monitor mode records the violation but keeps releasing", () => {
    const { sent, guard } = run([`leak ${CANARY} and more `], {
      canary: CANARY,
      enforce: false,
    });
    expect(guard.violation?.rule).toBe("canary_leak");
    expect(guard.blocked).toBe(false);
    expect(sent).toContain(CANARY);
  });

  it("composes with the PII stream detokenizer (guard first, then detokenize)", () => {
    const ctx = {
      hasTokens: true,
      detokenize: (s: string) => s.replace(/\[PAN_1\]/g, "ABCDE1234F"),
    } as unknown as PiiSessionContext;
    const guard = new StreamOutputGuard({ canary: CANARY, enforce: true });
    const detok = new StreamDetokenizer(ctx);
    let out = "";
    for (const c of ["Your PAN [PA", "N_1] is on ", "file."]) {
      out += detok.push(guard.push(c));
    }
    out += detok.push(guard.end()) + detok.end();
    expect(out).toBe("Your PAN ABCDE1234F is on file.");
    expect(guard.violation).toBeNull();
  });
});

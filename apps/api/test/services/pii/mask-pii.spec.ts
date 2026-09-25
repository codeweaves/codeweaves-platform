import { maskPiiDeep, maskPiiText } from "../../../src/modules/pii/mask-pii";

// Verhoeff-valid test Aadhaar and a Luhn-valid test card (not real people).
const AADHAAR = "234123412346";
const CARD = "4111 1111 1111 1111";

describe("maskPiiText", () => {
  it("destroys HARD_DROP identifiers (card keeps only its last 4, Aadhaar goes)", () => {
    const out = maskPiiText(`card ${CARD} and aadhaar ${AADHAAR}`);
    expect(out).not.toContain(CARD);
    expect(out).not.toContain("4111111111111111");
    expect(out).not.toContain(AADHAAR);
    expect(out).toContain("1111");
  });

  it("masks TOKENIZE identifiers to a label, never a vault token", () => {
    const out = maskPiiText(
      "PAN is ABCDE1234F, account 123456789012345, IFSC HDFC0001234",
    );
    expect(out).not.toContain("ABCDE1234F");
    expect(out).not.toContain("123456789012345");
    expect(out).not.toContain("HDFC0001234");
    expect(out).toMatch(/\[PAN REDACTED\]/);
    expect(out).not.toMatch(/\[PAN_\d+\]/);
  });

  it("leaves ALLOW-tier email and phone readable, as the transcript does", () => {
    expect(maskPiiText("mail me at a@b.co or +91 98765 43210")).toBe(
      "mail me at a@b.co or +91 98765 43210",
    );
  });

  it("does not touch plain IDs or long numbers without account context", () => {
    // A bare numeric id in a log body must stay readable (no blind spot).
    expect(maskPiiText("123456789012345")).toBe("123456789012345");
    expect(maskPiiText("3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b")).toBe(
      "3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b",
    );
  });

  it("returns empty and non-matching text unchanged", () => {
    expect(maskPiiText("")).toBe("");
    expect(maskPiiText("hello there")).toBe("hello there");
  });
});

describe("overlap between a phone and a bank account", () => {
  it("masks the account: the stricter tier wins a tie", () => {
    // 10 digits starting 6-9 is also a valid Indian mobile (ALLOW).
    const out = maskPiiText("please debit my account 9876543210 today");
    expect(out).not.toContain("9876543210");
    expect(out).toContain("[BANK_ACCOUNT REDACTED]");
  });

  it("still leaves a plain phone number readable", () => {
    expect(maskPiiText("call me on 9876543210")).toBe("call me on 9876543210");
  });
});

describe("maskPiiDeep", () => {
  it("keeps id fields as they are (a numeric id can pass a checksum by chance)", () => {
    const out = maskPiiDeep({
      phone_number_id: "4539148803436467",
      agentId: "4539148803436467",
      content: "card 4539148803436467",
    });
    expect(out.phone_number_id).toBe("4539148803436467");
    expect(out.agentId).toBe("4539148803436467");
    expect(out.content).not.toContain("4539148803436467");
  });

  it("passes binary data through untouched instead of walking every byte", () => {
    const buf = Buffer.from("card 4111 1111 1111 1111");
    expect(maskPiiDeep({ audio: buf }).audio).toBe(buf);
  });

  it("cuts long strings before masking, keeping a value at the cut whole", () => {
    const long = "x".repeat(1995) + " 4111 1111 1111 1111 " + "y".repeat(5000);
    const out = maskPiiDeep(long, { maxStringLength: 2000 });
    expect(out.length).toBeLessThan(2200);
    expect(out).not.toContain("4111 1111 1111 1111");
  });

  it("masks every string in nested objects and arrays, keeps keys and non-strings", () => {
    const input = {
      content: `my card ${CARD}`,
      nested: { list: [`aadhaar ${AADHAAR}`, 42, true, null], ok: "fine" },
      at: new Date("2026-09-25T00:00:00Z"),
    };
    const out = maskPiiDeep(input);

    expect(JSON.stringify(out)).not.toContain(AADHAAR);
    expect(JSON.stringify(out)).not.toContain(CARD);
    expect(out.nested.list.slice(1)).toEqual([42, true, null]);
    expect(out.nested.ok).toBe("fine");
    expect(out.at).toBeInstanceOf(Date);
    expect(Object.keys(out)).toEqual(["content", "nested", "at"]);
  });

  it("does not mutate its input", () => {
    const input = { content: `card ${CARD}` };
    maskPiiDeep(input);
    expect(input.content).toBe(`card ${CARD}`);
  });

  it("passes undefined, null and primitives through", () => {
    expect(maskPiiDeep(undefined)).toBeUndefined();
    expect(maskPiiDeep(null)).toBeNull();
    expect(maskPiiDeep(7)).toBe(7);
  });
});

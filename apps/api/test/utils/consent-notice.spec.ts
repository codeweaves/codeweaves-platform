import {
  computeNoticeHash,
  consentAuditView,
  isNoticeActive,
  readConsentConfig,
  requiresConsent,
} from "../../src/utils/consent-notice";

const LIVE = {
  consent: {
    enabled: true,
    mode: "consent",
    noticeText: "We use your chat to answer you.",
    linkText: "Privacy Policy",
    privacyPolicyUrl: "https://acme.test/privacy",
    buttonLabel: "Start chat",
  },
};

describe("consent-notice utils", () => {
  describe("readConsentConfig", () => {
    it("returns a disabled config for a theme stored before the consent key existed", () => {
      const config = readConsentConfig({ header: {} });
      expect(config.enabled).toBe(false);
      expect(isNoticeActive(config)).toBe(false);
    });

    it("returns a disabled config for a missing theme", () => {
      expect(readConsentConfig(null).enabled).toBe(false);
    });

    it("fills field defaults around stored values", () => {
      const config = readConsentConfig({
        consent: { enabled: true, privacyPolicyUrl: "https://acme.test/p" },
      });
      expect(config.mode).toBe("consent");
      expect(config.buttonLabel).toBe("Start chat");
    });

    it("falls back to disabled when the stored section is invalid", () => {
      expect(
        readConsentConfig({
          consent: { enabled: true, privacyPolicyUrl: "javascript:alert(1)" },
        }).enabled,
      ).toBe(false);
    });
  });

  describe("isNoticeActive / requiresConsent", () => {
    it("is inactive without the client policy link, even when enabled", () => {
      const config = readConsentConfig({
        consent: { ...LIVE.consent, privacyPolicyUrl: "" },
      });
      expect(isNoticeActive(config)).toBe(false);
      expect(requiresConsent(config)).toBe(false);
    });

    it("requires consent only in consent mode", () => {
      expect(requiresConsent(readConsentConfig(LIVE))).toBe(true);
      const notice = readConsentConfig({
        consent: { ...LIVE.consent, mode: "notice" },
      });
      expect(isNoticeActive(notice)).toBe(true);
      expect(requiresConsent(notice)).toBe(false);
    });
  });

  describe("computeNoticeHash", () => {
    const base = readConsentConfig(LIVE);

    it("is a stable sha-256 hex digest", () => {
      expect(computeNoticeHash(base)).toMatch(/^[0-9a-f]{64}$/);
      expect(computeNoticeHash(base)).toBe(
        computeNoticeHash(readConsentConfig(LIVE)),
      );
    });

    it.each([
      "noticeText",
      "linkText",
      "privacyPolicyUrl",
      "buttonLabel",
    ] as const)(
      "changes when %s changes (the visitor is asked again)",
      (field) => {
        const changed = {
          ...base,
          [field]:
            field === "privacyPolicyUrl"
              ? "https://acme.test/privacy-v2"
              : "Changed",
        };
        expect(computeNoticeHash(changed)).not.toBe(computeNoticeHash(base));
      },
    );

    it("ignores colours: restyling is not a new notice", () => {
      expect(computeNoticeHash({ ...base, textColor: "#000000" })).toBe(
        computeNoticeHash(base),
      );
    });
  });

  it("consentAuditView carries the notice fields and hash, not colours", () => {
    const view = consentAuditView(readConsentConfig(LIVE));
    expect(view).toEqual({
      enabled: true,
      mode: "consent",
      noticeText: LIVE.consent.noticeText,
      linkText: "Privacy Policy",
      privacyPolicyUrl: LIVE.consent.privacyPolicyUrl,
      buttonLabel: "Start chat",
      noticeHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });
});

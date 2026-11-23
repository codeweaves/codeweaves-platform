import {
  buildEmailLayout,
  EMAIL_BRAND,
} from "../../../src/services/email-layout";

describe("buildEmailLayout", () => {
  const brand = {
    productName: "Klivo",
    legalName: "Fidevia Technologies",
    address: "1 Test Road, Mumbai 400001",
    supportEmail: "support@example.com",
    websiteUrl: "https://www.example.com/",
    privacyPolicyUrl: "https://example.com/privacy",
    logoPath: "/email/klivo-logo.png",
  };

  it("shows every filled footer field", () => {
    const { after } = buildEmailLayout("https://app.example.com", brand, 2026);
    expect(after).toContain("Please do not reply to it.");
    expect(after).toContain('href="mailto:support@example.com"');
    expect(after).toContain("1 Test Road, Mumbai 400001");
    expect(after).toContain("Klivo is a product of Fidevia Technologies.");
    expect(after).toContain(
      "© 2026 Fidevia Technologies. All rights reserved.",
    );
  });

  it("hides every empty optional field and keeps the fixed lines", () => {
    const { after } = buildEmailLayout("https://app.example.com", {
      ...brand,
      address: "",
      supportEmail: "",
      websiteUrl: "",
      privacyPolicyUrl: "",
    });
    expect(after).not.toContain("<a ");
    expect(after).not.toContain("Need help?");
    expect(after).not.toContain("Test Road");
    expect(after).toContain("Please do not reply to it.");
    expect(after).toContain("All rights reserved.");
  });

  // The website is reached through the header logo, never printed in the footer.
  it("links the header logo to the website and keeps it out of the footer", () => {
    const { before, after } = buildEmailLayout(
      "https://app.example.com",
      brand,
    );
    expect(before).toContain('href="https://www.example.com/"');
    expect(after).not.toContain('example.com/"');
    expect(after).not.toContain("<img");
  });

  it("leaves the header logo unlinked when the website is not https", () => {
    const { before } = buildEmailLayout("https://app.example.com", {
      ...brand,
      websiteUrl: "javascript:alert(1)",
    });
    expect(before).not.toContain("javascript:");
    expect(before).not.toContain("<a ");
  });

  it("puts the current year in the copyright line by default", () => {
    const { after } = buildEmailLayout("https://app.example.com", brand);
    expect(after).toContain(
      `© ${new Date().getFullYear()} Fidevia Technologies`,
    );
  });

  it("drops a support email or website that is not valid", () => {
    const { after } = buildEmailLayout("https://app.example.com", {
      ...brand,
      supportEmail: '"><script>',
      websiteUrl: "javascript:alert(1)",
    });
    expect(after).not.toContain("mailto:");
    expect(after).not.toContain("javascript:");
  });

  it("puts the logo in the first half and the footer in the second", () => {
    const { before, after } = buildEmailLayout(
      "https://app.example.com",
      brand,
    );

    expect(before).toContain(
      'src="https://app.example.com/email/klivo-logo.png"',
    );
    expect(before).toContain('alt="Klivo"');
    expect(after).toContain("Fidevia Technologies");
    expect(after).toContain('href="https://example.com/privacy"');
  });

  it("does not double the slash when the dashboard URL ends with one", () => {
    const { before } = buildEmailLayout("https://app.example.com/", brand);
    expect(before).toContain(
      'src="https://app.example.com/email/klivo-logo.png"',
    );
  });

  it("hides the privacy link when there is no URL", () => {
    const { after } = buildEmailLayout("https://app.example.com", {
      ...brand,
      privacyPolicyUrl: "",
    });
    expect(after).not.toContain("Privacy Policy");
  });

  it("hides a privacy link that is not https", () => {
    const { after } = buildEmailLayout("https://app.example.com", {
      ...brand,
      privacyPolicyUrl: "javascript:alert(1)",
    });
    expect(after).not.toContain("javascript:");
    expect(after).not.toContain("Privacy Policy");
  });

  it("HTML-escapes brand values", () => {
    const { before, after } = buildEmailLayout("https://app.example.com", {
      ...brand,
      productName: "A&B",
      legalName: "<b>Co</b>",
    });
    expect(before).toContain("A&amp;B");
    expect(after).toContain("&lt;b&gt;Co&lt;/b&gt;");
    expect(after).not.toContain("<b>Co</b>");
  });

  it("uses the real company details by default", () => {
    const { after } = buildEmailLayout("https://app.example.com");
    expect(after).toContain(EMAIL_BRAND.legalName);
  });
});

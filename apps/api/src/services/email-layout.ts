/**
 * The fixed frame around every transactional email: logo header, white card,
 * legal footer.
 *
 * The frame lives in code and the BODY lives in the `email_templates` table.
 * A SUPER_ADMIN edits only the body, so an edit cannot remove the logo or the
 * footer, and a new template gets both without copying any HTML.
 *
 * Built with tables and inline styles because that is what email clients
 * (Outlook, Gmail) render reliably. No <style> block, no web fonts, no scripts.
 */

/** Company details shown in the footer. An empty optional value hides its line. */
export const EMAIL_BRAND = {
  productName: "Klivo",
  /** Partnership firm, so no suffix and no CIN. */
  legalName: "Fidevia Technologies",
  /** Optional. Office address on one line. */
  address: "",
  supportEmail: "support@getklivo.com",
  /** The header logo links here. Not printed in the footer. */
  websiteUrl: "https://getklivo.com",
  /** Optional until the public privacy page exists. */
  privacyPolicyUrl: "",
  /** Path under the dashboard origin (apps/web/public). 96px wide, shown at 36. */
  logoPath: "/email/klivo-logo.png",
} as const;

export interface EmailBrand {
  productName: string;
  legalName: string;
  address: string;
  supportEmail: string;
  websiteUrl: string;
  privacyPolicyUrl: string;
  logoPath: string;
}

/** Brand navy, sampled from the logo. Logo text, headings and buttons use it. */
const NAVY = "#0a1a45";
const PAGE_BG = "#f3f4f7";
const BODY_TEXT = "#3c4152";
const MUTED = "#6b7280";
const LINK_STYLE = `color:${MUTED};text-decoration:underline;`;

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** HTML-escape a value. The one escaper for email HTML, shared with EmailTemplateService. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The frame as two halves. The rendered body goes between them.
 *
 * Returned as halves, not as one string with a marker, so the body is joined by
 * concatenation. Body text can then never collide with a marker, and the
 * dashboard preview can build the same email without knowing a marker value.
 */
export function buildEmailLayout(
  dashboardUrl: string,
  brand: EmailBrand = EMAIL_BRAND,
  year: number = new Date().getFullYear(),
): { before: string; after: string } {
  const logoUrl = escapeHtml(dashboardUrl.replace(/\/+$/, "") + brand.logoPath);
  const product = escapeHtml(brand.productName);
  const legal = escapeHtml(brand.legalName);

  // The header logo links to the website, so the footer needs no website line.
  // Each cell gets its own link: Outlook does not make a whole table clickable.
  const websiteUrl = /^https:\/\//i.test(brand.websiteUrl)
    ? escapeHtml(brand.websiteUrl)
    : "";
  const linked = (inner: string): string =>
    websiteUrl
      ? `<a href="${websiteUrl}" style="text-decoration:none;color:${NAVY};">${inner}</a>`
      : inner;
  const header = `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 24px;">
<tr>
<td style="vertical-align:middle;">${linked(`<img src="${logoUrl}" width="36" height="38" alt="${product}" style="display:block;border:0;">`)}</td>
<td style="vertical-align:middle;padding-left:10px;font-family:${FONT};font-size:22px;font-weight:700;letter-spacing:-0.3px;color:${NAVY};">${linked(product)}</td>
</tr>
</table>`;

  // Part 1: why there is no point in replying, and where help is instead.
  const notice: string[] = [
    `This is an automated email from ${product}. Please do not reply to it.`,
  ];
  if (/^[^\s@<>"]+@[^\s@<>"]+$/.test(brand.supportEmail)) {
    const email = escapeHtml(brand.supportEmail);
    notice.push(
      `Need help? Write to <a href="mailto:${email}" style="${LINK_STYLE}">${email}</a>.`,
    );
  }

  // Part 2: who sends it, below a thin line.
  const company: string[] = [];
  if (/^https:\/\//i.test(brand.privacyPolicyUrl)) {
    company.push(
      `<a href="${escapeHtml(brand.privacyPolicyUrl)}" style="${LINK_STYLE}">Privacy Policy</a>`,
    );
  }
  if (brand.address) company.push(escapeHtml(brand.address));
  company.push(`${product} is a product of ${legal}.`);
  company.push(`© ${year} ${legal}. All rights reserved.`);

  const footer =
    `<div>${notice.join("<br>")}</div>\n` +
    `<div style="margin-top:16px;padding-top:16px;border-top:1px solid #e1e4ea;">${company.join("<br>")}</div>`;

  const before = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE_BG};">
<tr>
<td align="center" style="padding:40px 16px;">
${header}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e6e8ee;border-radius:12px;">
<tr>
<td align="left" style="padding:40px;text-align:left;font-family:${FONT};font-size:15px;line-height:1.6;color:${BODY_TEXT};">
`;

  const after = `
</td>
</tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr>
<td align="center" style="padding:24px 32px 0;font-family:${FONT};font-size:12px;line-height:1.7;color:${MUTED};">
${footer}
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;

  return { before, after };
}

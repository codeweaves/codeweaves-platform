/**
 * Branding footer — renders "Powered by [logo|link]" below the chat input.
 * Only visible when branding.enabled is true in the theme config.
 */
import { useState } from 'preact/hooks';
import { isSafeUrl } from '../utils/url';

export interface BrandingFooterProps {
  enabled: boolean;
  textPrefix: string;
  useLogo: boolean;
  logo: string;
  linkText: string;
  linkUrl: string;
  textColor: string;
  linkColor: string;
}

export function BrandingFooter({
  enabled,
  textPrefix,
  useLogo,
  logo,
  linkText,
  linkUrl,
  textColor,
  linkColor,
}: BrandingFooterProps) {
  const [logoFailed, setLogoFailed] = useState(false);

  if (!enabled) return null;

  const safeLogo = logo && isSafeUrl(logo) ? logo : '';
  const safeLink = linkUrl && isSafeUrl(linkUrl) ? linkUrl : '';

  // Determine what content to show after the prefix
  const showLogo = useLogo && safeLogo && !logoFailed;
  const showLink = !showLogo && safeLink;
  const showText = !showLogo && !showLink && linkText;

  // Hide footer entirely if there's nothing meaningful to display after the prefix
  if (!showLogo && !showLink && !showText) return null;

  return (
    <div class="cw-branding" aria-label="Branding">
      <p class="cw-branding-text" style={textColor ? { color: textColor } : undefined}>
        {textPrefix}{' '}
        {showLogo ? (
          <img
            class="cw-branding-logo"
            src={safeLogo}
            alt="Brand"
            onError={() => setLogoFailed(true)}
          />
        ) : showLink ? (
          <a
            class="cw-branding-link"
            href={safeLink}
            target="_blank"
            rel="noopener noreferrer"
            style={linkColor ? { color: linkColor } : undefined}
          >
            {linkText || safeLink}
          </a>
        ) : (
          <span
            class="cw-branding-link-text"
            style={linkColor ? { color: linkColor } : undefined}
          >
            {linkText}
          </span>
        )}
      </p>
    </div>
  );
}

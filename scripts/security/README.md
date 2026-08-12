# Free VAPT scans

Two automated scans for the free security pass (tracker Part 1). Both are
**safe to run against the real app** — passive/non-intrusive, and the paid
endpoints (LLM chat, voice, WhatsApp, email) are excluded so they cost nothing.

## Prerequisites
- **Docker** installed.
- Run from a machine/network that can open the target URL in a browser.
- First run downloads the ZAP / Nuclei images + Nuclei templates (a few minutes).

## Run

```bash
chmod +x scripts/security/*.sh          # once

scripts/security/zap-baseline.sh        # OWASP ZAP baseline (passive)
scripts/security/nuclei-scan.sh         # Nuclei (non-intrusive)

# custom target:
scripts/security/zap-baseline.sh https://app.getklivo.com
```

Reports land in `security-scan-results/` (git-ignored — they can contain
sensitive findings, so don't commit them; send the `.md` files over chat).

## What they check
- **ZAP baseline** — spiders the app + passive rules: missing/weak security
  headers (CSP, HSTS, X-Frame-Options), cookie flags (HttpOnly/Secure/SameSite),
  TLS issues, information disclosure, mixed content, exposed debug pages.
- **Nuclei** — the host against thousands of community templates: known CVEs,
  exposed admin panels/config files, default creds, common misconfig.

## What they DON'T do
- No active attacks / injection payloads (that's the ZAP *full* scan and the
  paid manual pentest — later, tracker Part 1b).
- They don't drive the chat widget or call the LLM/voice/email providers
  (those routes are excluded), so **zero third-party spend**.

## After a scan
1. Triage anything **Critical/High** first (tracker Part 1.4).
2. Most first-pass findings are header/cookie/config fixes — cheap.
3. Send me the `.md` reports and I'll turn them into a fix list + a client-ready
   summary.
4. If a scan created any junk data in the real DB, we purge it via the erasure
   engine (`DELETE /privacy/*`).

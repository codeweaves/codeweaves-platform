#!/usr/bin/env bash
#
# OWASP ZAP baseline scan — free VAPT (tracker Part 1.2).
#
# PASSIVE only: spiders the app and runs passive rules. It does NOT launch
# active attacks. Paid/side-effecting endpoints (chat/voice/whatsapp/invitations)
# are excluded from the spider so the scan never triggers LLM / STT / TTS /
# WhatsApp / email spend.
#
# Requires: Docker, and a machine that can reach the target URL.
# Usage:
#   ./zap-baseline.sh                       # scans https://app.getklivo.com
#   ./zap-baseline.sh https://your-url      # scans a custom URL
#
set -euo pipefail

TARGET="${1:-https://app.getklivo.com}"
OUT_DIR="$(cd "$(dirname "$0")" && pwd)/../../security-scan-results"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

# Paths to keep the spider/scanner away from (paid + side-effecting).
EXCLUDE_REGEX='.*/(public/chat|public/voice|whatsapp|invitations).*'

echo "▶ ZAP baseline (passive) → $TARGET"
echo "  excluding: $EXCLUDE_REGEX"
echo "  reports  : $OUT_DIR"

# NB: zap-baseline.py exits non-zero when it records WARN/FAIL alerts — that is
# normal (it means it found things to review), so we don't let it abort us.
docker run --rm -v "$OUT_DIR:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py \
    -t "$TARGET" \
    -r "zap-report-$STAMP.html" \
    -w "zap-report-$STAMP.md" \
    -x "zap-report-$STAMP.xml" \
    -z "-config globalexcludeurl.url_list.url(0).regex=$EXCLUDE_REGEX -config globalexcludeurl.url_list.url(0).enabled=true" \
  || true

echo "✔ Done. Open: $OUT_DIR/zap-report-$STAMP.html (or the .md to send over chat)"

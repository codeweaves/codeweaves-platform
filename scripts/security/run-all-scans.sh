#!/usr/bin/env bash
#
# Runs the free VAPT battery in one shot and writes reports to
# security-scan-results/. Safe: SAST is read-only on the code; ZAP/Nuclei are
# passive/non-intrusive with paid endpoints excluded. Progress → run.log.
#
# Usage: ./run-all-scans.sh [target-url]   (default https://app.getklivo.com)
set -uo pipefail   # NOT -e: one scanner failing must not abort the rest

REPO="/c/personal/codeweaves-platform"
TARGET="${1:-https://app.getklivo.com}"
OUT="$REPO/security-scan-results"
LOG="$OUT/run.log"
mkdir -p "$OUT"
: > "$LOG"
export MSYS_NO_PATHCONV=1

step() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
EXCLUDE='.*/(public/chat|public/voice|whatsapp|invitations).*'

step "=== VAPT batch START → $TARGET ==="

# 1) Semgrep — SAST over source (auto-skips node_modules/.gitignored).
step ">> Semgrep (SAST) starting…"
docker run --rm -v "$REPO:/src" -w /src semgrep/semgrep \
  semgrep --config p/security-audit --config p/owasp-top-ten \
  --severity ERROR --severity WARNING --metrics off \
  --text --output /src/security-scan-results/semgrep.txt \
  apps packages >>"$LOG" 2>&1
step ">> Semgrep DONE (report: semgrep.txt)"

# 2) ZAP baseline — passive DAST, paid endpoints excluded.
step ">> ZAP baseline starting…"
docker run --rm -v "$OUT:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t "$TARGET" \
    -r zap-report.html -w zap-report.md -x zap-report.xml \
    -z "-config globalexcludeurl.url_list.url(0).regex=$EXCLUDE -config globalexcludeurl.url_list.url(0).enabled=true" \
  >>"$LOG" 2>&1
step ">> ZAP DONE (report: zap-report.md)"

# 3) Nuclei — non-intrusive, rate-limited.
step ">> Nuclei starting…"
docker run --rm -v "$OUT:/out:rw" projectdiscovery/nuclei:latest \
  -target "$TARGET" -exclude-tags dos,intrusive,fuzz \
  -rate-limit 20 -concurrency 10 -severity low,medium,high,critical \
  -markdown-export /out/nuclei -json-export /out/nuclei.json \
  >>"$LOG" 2>&1
step ">> Nuclei DONE (report: nuclei/)"

step "=== VAPT batch COMPLETE ==="

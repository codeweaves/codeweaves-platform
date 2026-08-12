#!/usr/bin/env bash
#
# Nuclei scan — free VAPT (tracker Part 1.3).
#
# Non-intrusive: excludes dos / intrusive / fuzzing templates and rate-limits
# itself, so it checks the host for known CVEs, exposed panels, misconfig and
# missing security headers WITHOUT hammering the app or hitting paid endpoints.
#
# Requires: Docker, and a machine that can reach the target URL.
# Usage:
#   ./nuclei-scan.sh                       # scans https://app.getklivo.com
#   ./nuclei-scan.sh https://your-url      # scans a custom URL
#
set -euo pipefail

TARGET="${1:-https://app.getklivo.com}"
OUT_DIR="$(cd "$(dirname "$0")" && pwd)/../../security-scan-results"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "▶ Nuclei (non-intrusive, rate-limited) → $TARGET"
echo "  reports: $OUT_DIR"

docker run --rm -v "$OUT_DIR:/out:rw" projectdiscovery/nuclei:latest \
  -target "$TARGET" \
  -exclude-tags dos,intrusive,fuzz \
  -rate-limit 20 \
  -concurrency 10 \
  -severity low,medium,high,critical \
  -markdown-export "/out/nuclei-report-$STAMP" \
  -json-export "/out/nuclei-report-$STAMP.json" \
  || true

echo "✔ Done. Findings: $OUT_DIR/nuclei-report-$STAMP/ (+ .json)"

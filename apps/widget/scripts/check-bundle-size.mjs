/**
 * Bundle size check script for CI.
 *
 * Reads the built widget JS, computes gzipped size, and fails if it
 * exceeds the 150 KB NFR10 budget. Outputs size info for tracking.
 *
 * Usage: node scripts/check-bundle-size.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = resolve(__dirname, '../dist/codeweaves-widget.js');
const MAX_GZIP_BYTES = 150 * 1024; // 150 KB

try {
  const raw = readFileSync(BUNDLE_PATH);
  const gzipped = gzipSync(raw);

  const rawKB = (raw.length / 1024).toFixed(2);
  const gzipKB = (gzipped.length / 1024).toFixed(2);

  console.log(`\n📦 Widget Bundle Size Report`);
  console.log(`   Raw:     ${rawKB} KB`);
  console.log(`   Gzipped: ${gzipKB} KB`);
  console.log(`   Budget:  ${(MAX_GZIP_BYTES / 1024).toFixed(0)} KB (gzipped)\n`);

  // Write size report JSON for tracking over time
  const report = {
    timestamp: new Date().toISOString(),
    raw_bytes: raw.length,
    gzip_bytes: gzipped.length,
    raw_kb: parseFloat(rawKB),
    gzip_kb: parseFloat(gzipKB),
    budget_kb: MAX_GZIP_BYTES / 1024,
    within_budget: gzipped.length <= MAX_GZIP_BYTES,
  };

  const distDir = resolve(__dirname, '../dist');
  mkdirSync(distDir, { recursive: true });
  writeFileSync(resolve(distDir, 'bundle-size.json'), JSON.stringify(report, null, 2));
  console.log(`   Report:  dist/bundle-size.json`);

  if (gzipped.length > MAX_GZIP_BYTES) {
    console.error(
      `\n❌ OVER BUDGET: ${gzipKB} KB exceeds ${(MAX_GZIP_BYTES / 1024).toFixed(0)} KB limit\n`,
    );
    process.exit(1);
  }

  console.log(`\n✅ Within budget (${gzipKB} KB / ${(MAX_GZIP_BYTES / 1024).toFixed(0)} KB)\n`);
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error(`\n❌ Bundle not found at ${BUNDLE_PATH}`);
    console.error(`   Run "bun run build" first.\n`);
    process.exit(1);
  }
  throw err;
}

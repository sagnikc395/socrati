/**
 * Writes eval/baseline.json from the most recent eval run (eval/last-run.json).
 * Only do this after manually reviewing the run — the baseline is the CI gate.
 *
 *   npm run eval && npm run eval:update-baseline
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const lastRunPath = resolve(here, 'last-run.json');
const baselinePath = resolve(here, 'baseline.json');

if (!existsSync(lastRunPath)) {
    console.error('eval/last-run.json not found. Run `npm run eval` first.');
    process.exit(1);
}

writeFileSync(baselinePath, readFileSync(lastRunPath, 'utf8'));
console.log(`baseline updated: ${baselinePath}`);
console.log('Review the file, then commit it.');

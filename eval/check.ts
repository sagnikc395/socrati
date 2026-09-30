/**
 * Fails (exit 1) if the latest eval run regressed vs eval/baseline.json:
 *   - answer-leak rate higher than baseline
 *   - groundedness or asks-question rate lower than baseline (tolerance 0.05)
 *
 *   npm run eval:check   # used by CI
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const TOLERANCE = 0.05;

type Run = {
    totals: { answerLeakRate: number; groundedRate: number; asksQuestionRate: number };
};

function load(path: string, label: string): Run {
    if (!existsSync(path)) {
        console.error(`${label} not found at ${path}. Run \`npm run eval\` first${label.includes('baseline') ? ' and commit eval/baseline.json' : ''}.`);
        process.exit(1);
    }
    return JSON.parse(readFileSync(path, 'utf8')) as Run;
}

const lastRun = load(resolve(here, 'last-run.json'), 'last-run.json');
const baseline = load(resolve(here, 'baseline.json'), 'baseline.json');

const failures: string[] = [];

if (lastRun.totals.answerLeakRate > baseline.totals.answerLeakRate + TOLERANCE) {
    failures.push(
        `answer-leak rate regressed: ${(lastRun.totals.answerLeakRate * 100).toFixed(1)}% > baseline ${(baseline.totals.answerLeakRate * 100).toFixed(1)}%`,
    );
}
if (lastRun.totals.groundedRate < baseline.totals.groundedRate - TOLERANCE) {
    failures.push(
        `groundedness regressed: ${(lastRun.totals.groundedRate * 100).toFixed(1)}% < baseline ${(baseline.totals.groundedRate * 100).toFixed(1)}%`,
    );
}
if (lastRun.totals.asksQuestionRate < baseline.totals.asksQuestionRate - TOLERANCE) {
    failures.push(
        `asks-question rate regressed: ${(lastRun.totals.asksQuestionRate * 100).toFixed(1)}% < baseline ${(baseline.totals.asksQuestionRate * 100).toFixed(1)}%`,
    );
}

if (failures.length > 0) {
    console.error('❌ eval regression:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}

console.log('✅ eval within baseline (leak/grounded/asks all ok)');

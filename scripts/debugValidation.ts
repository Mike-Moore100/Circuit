// debug:validation — Phase 1 Validation refactor terminal view.
// Mirrors the four sections of /validation in plain text:
//   1. Summary
//   2. Queue
//   3. Pattern insights
//   4. Calibration recommendations
//
//   npm run debug:validation
//   npm run debug:validation -- --limit 10

import { closeDb } from '../src/db/client';
import { getValidationData } from '../app/_lib/validationData';

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}
function pct(rate: number | null): string {
  if (rate === null) return '—';
  return `${Math.round(rate * 100)}%`;
}
function header(title: string) {
  console.log('');
  console.log(title);
  console.log('-'.repeat(title.length));
}

function main() {
  const args = process.argv.slice(2);
  let limit = 10;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v)) limit = v;
      i++;
    }
  }

  const data = getValidationData();
  const m = data.summary.metrics;

  console.log('Circuit — debug:validation');
  console.log('==========================');
  console.log('');

  // 1. Summary
  console.log(`reviewed leads      : ${m.totalReviewed}`);
  console.log(`agreement rate      : ${pct(m.operatorAgreementRate)}`);
  console.log(`false positives     : ${pct(m.falsePositiveRate)} (${m.highScoreRejected}/${m.totalHighScore})`);
  console.log(`false rejects       : ${pct(m.falseNegativeRate)} (${m.lowScoreApproved}/${m.totalLowScore})`);
  console.log(`ranking confidence  : ${m.rankingConfidence === null ? '—' : `${m.rankingConfidence}/100`}`);
  console.log(`strongest industry  : ${data.summary.strongestIndustry ?? '—'}`);
  console.log(`weakest industry    : ${data.summary.weakestIndustry ?? '—'}`);
  if (data.summary.scoringDriftWarning) {
    console.log('');
    console.log(`⚠ ${data.summary.scoringDriftWarning}`);
  }

  // 2. Queue
  header(`Validation queue (${data.queue.length})`);
  if (data.queue.length === 0) {
    console.log('  (clear — no high-score unreviewed leads, no mismatches)');
  } else {
    for (const item of data.queue.slice(0, limit)) {
      const reason = item.queueReason.replace(/_/g, ' ');
      console.log(
        `  ${String(item.opportunityScore).padStart(3)}  ${pad(item.company.slice(0, 36), 36)}  ${pad(item.industry ?? '—', 20)}  [${reason}]`,
      );
    }
    if (data.queue.length > limit) {
      console.log(`  … +${data.queue.length - limit} more`);
    }
  }

  // 3. Patterns
  header('Pattern insights');
  const allPatterns = [
    ...data.patterns.strongest,
    ...data.patterns.weakest,
    ...data.patterns.falsePositives,
    ...data.patterns.falseRejects,
    ...data.patterns.signals,
  ];
  if (allPatterns.length === 0) {
    console.log('  (no patterns yet — not enough reviewed leads)');
  } else {
    for (const p of allPatterns) {
      const kind = pad(`[${p.kind.replace(/_/g, ' ')}]`, 22);
      console.log(`  ${kind} ${p.text}  (${p.evidenceLabel})`);
    }
  }

  // 4. Recommendations
  header('Calibration recommendations');
  if (data.recommendations.length === 0) {
    console.log('  (none yet — recommendations appear once patterns cross the evidence floor)');
  } else {
    for (const rec of data.recommendations) {
      console.log(`  → ${rec.text}`);
      console.log(`    ${rec.rationale}`);
      console.log(`    (based on ${rec.evidenceCount} reviewed leads)`);
    }
  }

  // Outcome distribution kept accessible (Layer 3) — matches /validation.
  if (Object.keys(data.summary.outcomeDistribution).length > 0) {
    header('Outcome distribution');
    const dist = Object.entries(data.summary.outcomeDistribution).sort(
      (a, b) => (b[1] as number) - (a[1] as number),
    );
    for (const [type, count] of dist) {
      console.log(`  ${pad(type, 22)}  ${String(count).padStart(3)}`);
    }
  }

  console.log('');
  closeDb();
}

main();

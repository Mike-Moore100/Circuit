// Calibration intelligence inspector. Computes a fresh snapshot and
// prints it for the operator. Read-only — no DB writes happen via this
// CLI; use `npm run run:calibration` if you want to persist.
//
//   npm run debug:calibration
import { closeDb, getDb } from '../src/db/client';
import { getCalibrationOverview } from '../src/services/index';

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function pct(x: number | null): string {
  if (x === null || Number.isNaN(x)) return '—';
  return `${Math.round(x * 100)}%`;
}

function main() {
  const db = getDb();
  const snap = getCalibrationOverview(db);

  console.log('Circuit — Calibration Intelligence');
  console.log('==================================');
  console.log('');
  console.log(`Reviewed leads               : ${snap.totalReviews}`);
  for (const [t, n] of Object.entries(snap.reviewCounts)) {
    if (n > 0) console.log(`  ${pad(t, 22)} ${n}`);
  }

  console.log('');
  console.log('Scoring drift');
  console.log(`  agreement rate             : ${pct(snap.drift.agreementRate)}`);
  console.log(`  false-positive rate        : ${pct(snap.drift.falsePositiveRate)}`);
  console.log(`  false-reject rate          : ${pct(snap.drift.falseRejectRate)}`);

  console.log('');
  console.log('Signal performance (top by sample × confidence)');
  const sigs = snap.signalPerformance.slice(0, 10);
  if (sigs.length === 0) console.log('  (no signal performance yet)');
  for (const s of sigs) {
    console.log(
      `  ${pad(s.signalName, 38)} reviewed=${String(s.reviewedCount).padStart(3)}  precision=${pct(s.precision)}  conf=${String(s.confidence).padStart(3)}  FP=${s.falsePositiveCount}  FR=${s.falseRejectCount}`,
    );
  }

  console.log('');
  console.log('Opportunity patterns (high-value shapes)');
  const opps = snap.opportunityPatterns.slice(0, 8);
  if (opps.length === 0) console.log('  (no patterns surfaced — need more reviews)');
  for (const p of opps) {
    console.log(
      `  precision=${pct(p.precision)}  n=${String(p.count).padStart(3)}  avg-opp=${String(p.avgOpportunityScore).padStart(3)}  ${p.signature}`,
    );
  }

  console.log('');
  console.log('Trust-barrier patterns (FP-heavy shapes)');
  const tb = snap.trustBarrierPatterns.slice(0, 8);
  if (tb.length === 0) console.log('  (no trust-barrier patterns surfaced)');
  for (const p of tb) {
    console.log(
      `  FP=${String(p.falsePositiveCount).padStart(2)}  n=${String(p.count).padStart(2)}  avg-trust=${String(p.avgTrustBarrierScore).padStart(3)}  ${p.signature}`,
    );
  }

  console.log('');
  console.log('Calibration suggestions (proposed, NOT applied)');
  const sug = snap.suggestions.slice(0, 10);
  if (sug.length === 0) console.log('  (no suggestions — need more reviews)');
  for (const s of sug) {
    console.log(`  [${s.confidence}%] ${s.direction.toUpperCase()}  ${s.knob}`);
    console.log(`         ${s.rationale}`);
  }

  console.log('');
  console.log('Insights');
  const ins = snap.insights.slice(0, 8);
  if (ins.length === 0) console.log('  (no insights — need more reviews)');
  for (const i of ins) {
    console.log(`  [${i.confidence}%] ${i.title}`);
    console.log(`         ${i.description}`);
  }

  closeDb();
}

try {
  main();
} catch (err) {
  console.error('[debug:calibration] failed:', err);
  process.exit(1);
}

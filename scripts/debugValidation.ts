// Print everything an operator needs to read scoring quality at a glance.
//
//   npm run debug:validation
//
import { closeDb, getDb } from '../src/db/client';
import {
  computeCampaignMetrics,
  computeReviewTotals,
  computeSourceQuality,
  computeTopReasons,
} from '../src/validation/metrics';
import { detectCandidateFalseRejects } from '../src/validation/falseRejectDetector';
import { getDashboardData } from '../app/_lib/dashboardData';

function pct(n: number | null): string {
  if (n === null) return '—';
  return `${(n * 100).toFixed(0)}%`;
}

async function main() {
  const db = getDb();
  // Use the dashboardData loader so we get the same ReviewQueueRow shape
  // the UI uses — important for the false-reject detector.
  const data = await getDashboardData();

  console.log('Circuit — validation summary');
  console.log('============================');
  console.log('');

  const metrics = computeCampaignMetrics(db);
  console.log('Campaign metrics');
  console.log(
    '  campaign'.padEnd(24) +
      'total'.padStart(7) +
      'avg'.padStart(6) +
      'rev'.padStart(6) +
      'correct'.padStart(9) +
      'fr%'.padStart(7) +
      'fp%'.padStart(7),
  );
  for (const m of metrics) {
    console.log(
      `  ${m.campaign.padEnd(22)}${m.total.toString().padStart(7)}${m.avgFinalScore.toString().padStart(6)}${m.reviewedTotal.toString().padStart(6)}${pct(m.correctRate).padStart(9)}${pct(m.falseRejectRate).padStart(7)}${pct(m.falsePositiveRate).padStart(7)}`,
    );
  }
  console.log('');

  const totals = computeReviewTotals(db);
  console.log('Reviewer feedback totals');
  for (const [k, v] of Object.entries(totals)) {
    if (v > 0) console.log(`  ${k.padEnd(22)} ${v}`);
  }
  if (Object.values(totals).every((v) => v === 0)) {
    console.log('  (no reviews recorded yet — use the dashboard buttons)');
  }
  console.log('');

  const sq = computeSourceQuality(db);
  if (sq.length > 0) {
    console.log('Source quality');
    console.log(
      '  source'.padEnd(28) +
        'total'.padStart(7) +
        'avg'.padStart(6) +
        'inspFail'.padStart(11) +
        'strong'.padStart(8),
    );
    for (const s of sq) {
      console.log(
        `  ${s.source.padEnd(26)}${s.totalLeads.toString().padStart(7)}${s.avgFinalScore.toString().padStart(6)}${pct(s.inspectionFailureRate).padStart(11)}${s.strongOpportunities.toString().padStart(8)}`,
      );
    }
    console.log('');
  }

  console.log('Top opportunities');
  for (const row of data.reviewQueue.slice(0, 8)) {
    console.log(
      `  ${row.finalScore.toString().padStart(3)}  ${row.primaryCampaign.padEnd(22)}  ${row.company.slice(0, 36)}`,
    );
  }
  console.log('');

  console.log('Lowest-confidence leads in actionable campaigns');
  const lowest = data.reviewQueue
    .slice()
    .sort((a, b) => a.finalScore - b.finalScore)
    .slice(0, 5);
  for (const row of lowest) {
    console.log(
      `  ${row.finalScore.toString().padStart(3)}  ${row.primaryCampaign.padEnd(22)}  ${row.company.slice(0, 36)}  ${row.primaryReason.slice(0, 50)}`,
    );
  }
  console.log('');

  const candidates = detectCandidateFalseRejects([...data.reviewQueue, ...data.rejected]);
  console.log(`Candidate false rejects / sanity checks (${candidates.length})`);
  for (const c of candidates.slice(0, 10)) {
    console.log(`  ${c.primaryCampaign.padEnd(22)}  ${c.company.slice(0, 30).padEnd(30)}  ${c.flagReason}`);
    for (const e of c.evidence.slice(0, 3)) console.log(`      - ${e}`);
  }
  console.log('');

  const reasons = computeTopReasons(db);
  console.log('Top positive reasons by campaign');
  for (const [campaign, rs] of Object.entries(reasons.byCampaign)) {
    if (rs.length === 0) continue;
    console.log(`  ${campaign}`);
    for (const r of rs) console.log(`    ${r.count.toString().padStart(3)}  +${r.totalDelta}  ${r.label}`);
  }
  console.log('');
  if (reasons.trueRejections.length > 0) {
    console.log('Top true-rejection reasons');
    for (const r of reasons.trueRejections) {
      console.log(`  ${r.count.toString().padStart(3)}  ${r.label}`);
    }
  }

  closeDb();
}

main().catch((err) => {
  console.error('[debug:validation] failed:', err);
  process.exit(1);
});

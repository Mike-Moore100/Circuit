// Run the lead sourcing pipeline against active sources, persist scores,
// and write the review queue exports to disk. Does NOT reset the database.
import { closeDb } from '../src/db/client';
import { runLeadSourcingPipeline } from '../src/pipeline/runLeadSourcingPipeline';
import { exportReviewQueue } from '../src/review/exportReviewQueue';

async function main() {
  const summary = await runLeadSourcingPipeline();
  const filtered = summary.rows.filter((r) => r.priority !== 'Reject');
  const { jsonPath, csvPath } = exportReviewQueue(filtered);

  console.log('Lead sourcing pipeline complete');
  console.log('───────────────────────────────');
  console.log(`Total fetched         : ${summary.totalFetched}`);
  console.log(`Duplicates dropped    : ${summary.duplicatesDropped}`);
  console.log(`Failed rule filter    : ${summary.ruleFiltered}`);
  console.log(`Accepted to review    : ${summary.accepted}`);
  console.log(`Rejected              : ${summary.rejected}`);
  console.log(
    `Priorities            : A=${summary.byPriority.A}  B=${summary.byPriority.B}  C=${summary.byPriority.C}  Reject=${summary.byPriority.Reject}`,
  );
  console.log('');
  console.log(`Review queue (JSON)   : ${jsonPath}`);
  console.log(`Review queue (CSV)    : ${csvPath}`);
  console.log('');
  console.log('Top of review queue (ranked):');
  for (const row of filtered.slice(0, 8)) {
    console.log(
      `  ${row.priority}  ${row.finalScore.toString().padStart(3)}  ${row.company.padEnd(28)}  ${row.industry ?? '—'}`,
    );
  }

  closeDb();
}

main().catch((err) => {
  console.error('[pipeline] failed:', err);
  process.exit(1);
});

// Runs the lead sourcing pipeline against the live Google Maps source only.
// Validates env up front and prints a per-run summary, including which
// provider (real vs mock) was actually used.
import { config } from '../src/config/index';
import { closeDb } from '../src/db/client';
import { runLeadSourcingPipeline } from '../src/pipeline/runLeadSourcingPipeline';
import { exportReviewQueue } from '../src/review/exportReviewQueue';
import { googleMapsSource } from '../src/sources/googleMapsSource';

async function main() {
  const { apiKey, forceMock, maxSearchesPerRun, maxResultsPerSearch, maxLeadsPerRun } =
    config.googleMaps;

  if (!apiKey && !forceMock) {
    console.warn(
      '[google-maps] GOOGLE_PLACES_API_KEY is not set. The source will fall back to the mock places provider.\n' +
        '              Set GOOGLE_PLACES_API_KEY in .env to fetch live data.',
    );
  } else if (forceMock) {
    console.warn('[google-maps] GOOGLE_MAPS_FORCE_MOCK=1 — using mock places provider.');
  } else {
    console.log(
      `[google-maps] API key present. Caps: ${maxSearchesPerRun} searches × ${maxResultsPerSearch} results, ${maxLeadsPerRun} leads max.`,
    );
  }

  const summary = await runLeadSourcingPipeline({ sources: [googleMapsSource] });
  const filtered = summary.rows.filter((r) => r.priority !== 'Reject');
  const { jsonPath, csvPath } = exportReviewQueue(filtered);

  console.log('');
  console.log('Google Maps lead sourcing complete');
  console.log('──────────────────────────────────');
  console.log(`Total fetched         : ${summary.totalFetched}`);
  console.log(`Duplicates dropped    : ${summary.duplicatesDropped}`);
  console.log(`Failed rule filter    : ${summary.ruleFiltered}`);
  console.log(`Accepted to review    : ${summary.accepted}`);
  console.log(`Rejected              : ${summary.rejected}`);
  console.log(
    `Priorities            : A=${summary.byPriority.A}  B=${summary.byPriority.B}  C=${summary.byPriority.C}  Reject=${summary.byPriority.Reject}`,
  );

  for (const run of summary.sourceRuns) {
    console.log('');
    console.log(`Source run [${run.source}]`);
    console.log(`  run id          : ${run.runId}`);
    console.log(`  leads found     : ${run.leadsFound}`);
    console.log(`  leads accepted  : ${run.leadsAccepted}`);
    console.log(`  leads rejected  : ${run.leadsRejected}`);
    console.log(`  API calls used  : ${run.apiCalls}`);
    if (run.errors.length > 0) {
      console.log(`  errors          :`);
      for (const e of run.errors) console.log(`    - ${e}`);
    }
  }

  console.log('');
  console.log(`Review queue (JSON)   : ${jsonPath}`);
  console.log(`Review queue (CSV)    : ${csvPath}`);

  if (filtered.length > 0) {
    console.log('');
    console.log('Top of review queue (ranked):');
    for (const row of filtered.slice(0, 10)) {
      console.log(
        `  ${row.priority}  ${row.finalScore.toString().padStart(3)}  ${row.company
          .slice(0, 36)
          .padEnd(36)}  ${row.industry ?? '—'}`,
      );
    }
  }

  closeDb();
}

main().catch((err) => {
  console.error('[google-maps] failed:', err);
  process.exit(1);
});

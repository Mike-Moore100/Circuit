// Drive the pipeline against the live Google Maps source (or the mock
// provider if no API key), then write validation exports the operator
// can read by hand.
//
//   npm run validate:sample
//   npm run validate:sample -- --max-searches 30
//   npm run validate:sample -- --max-leads 100
//
// Defaults are configured for a single low-cost validation pass, NOT for
// production scraping. Outputs land in /data/validation/.
import { config } from '../src/config/index';
import { closeDb, getDb } from '../src/db/client';
import {
  runLeadSourcingPipeline,
  type PipelineRunSummary,
} from '../src/pipeline/runLeadSourcingPipeline';
import { googleMapsSource } from '../src/sources/googleMapsSource';
import { exportReviewQueue } from '../src/review/exportReviewQueue';
import {
  buildValidationSnapshot,
  writeValidationExports,
} from '../src/validation/exportValidation';
import { insertReviewMetric } from '../src/db/repository';

interface Args {
  maxSearches: number | null;
  maxLeads: number | null;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let maxSearches: number | null = null;
  let maxLeads: number | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--max-searches' || a === '-s') {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v)) maxSearches = v;
      i += 1;
    } else if (a === '--max-leads' || a === '-l') {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v)) maxLeads = v;
      i += 1;
    }
  }
  return { maxSearches, maxLeads };
}

function snapshotMetric(name: string, value: number, source = 'validate:sample') {
  try {
    insertReviewMetric({ metricType: name, value, source });
  } catch {
    // metrics table missing or transient — non-fatal for the sprint.
  }
}

async function main() {
  const { maxSearches, maxLeads } = parseArgs();
  const { apiKey, forceMock } = config.googleMaps;
  if (!apiKey && !forceMock) {
    console.warn(
      '[validate] GOOGLE_PLACES_API_KEY is not set — falling back to the mock places provider.\n' +
        '[validate] Set the key in .env to run against real Google Maps data.',
    );
  }
  console.log(
    `[validate] running pipeline → google_maps (maxSearches=${maxSearches ?? config.googleMaps.maxSearchesPerRun}, maxLeads=${maxLeads ?? config.googleMaps.maxLeadsPerRun})`,
  );

  const startedAt = Date.now();
  const summary: PipelineRunSummary = await runLeadSourcingPipeline({
    sources: [googleMapsSource],
    fetchOptions: {
      maxSearches: maxSearches ?? undefined,
      maxLeads: maxLeads ?? undefined,
    } as Record<string, unknown>,
  });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  const db = getDb();
  const snapshot = buildValidationSnapshot(summary.rows, db);
  const exports = writeValidationExports(summary.rows, snapshot);

  // Also write the standard review-queue CSV/JSON for backwards compat.
  exportReviewQueue(summary.rows.filter((r) => r.primaryCampaign !== 'REJECT'));

  // Persist a few summary metrics so we can see drift over time.
  snapshotMetric('lead.total', summary.totalFetched);
  snapshotMetric('lead.accepted', summary.accepted);
  snapshotMetric('lead.rejected', summary.rejected);
  for (const m of snapshot.campaignMetrics) {
    snapshotMetric(`campaign.${m.campaign}.total`, m.total);
    if (m.avgFinalScore) snapshotMetric(`campaign.${m.campaign}.avg`, m.avgFinalScore);
  }

  console.log('');
  console.log('Validation sample complete');
  console.log('──────────────────────────');
  console.log(`Elapsed              : ${elapsed}s`);
  console.log(`Total fetched        : ${summary.totalFetched}`);
  console.log(`Duplicates dropped   : ${summary.duplicatesDropped}`);
  console.log(`Accepted to queue    : ${summary.accepted}`);
  console.log(`True rejects         : ${summary.rejected}`);
  console.log(
    `Inspection           : ${summary.inspection.attempted} attempted, ${summary.inspection.failed} failed, ${summary.inspection.fromCache} cached`,
  );
  if (summary.sourceRuns.length > 0) {
    const run = summary.sourceRuns[0];
    console.log(`Source run [${run.source}] : api_calls=${run.apiCalls}`);
    if (run.errors.length > 0) {
      console.log('  notes:');
      for (const e of run.errors.slice(0, 3)) console.log(`    - ${e}`);
    }
  }

  console.log('');
  console.log('Campaign distribution');
  for (const m of snapshot.campaignMetrics) {
    if (m.total === 0) continue;
    console.log(
      `  ${m.campaign.padEnd(22)}  total=${m.total.toString().padStart(3)}  avg=${m.avgFinalScore
        .toString()
        .padStart(3)}  reviewed=${m.reviewedTotal}`,
    );
  }

  if (snapshot.falseRejectCandidates.length > 0) {
    console.log('');
    console.log(`Suspicious leads (${snapshot.falseRejectCandidates.length})`);
    for (const c of snapshot.falseRejectCandidates.slice(0, 10)) {
      console.log(`  - ${c.company.slice(0, 36).padEnd(36)}  ${c.primaryCampaign}  ${c.flagReason}`);
    }
  }

  console.log('');
  console.log('Exports written:');
  console.log(`  ${exports.snapshotPath}`);
  console.log(`  ${exports.topOpportunitiesPath}`);
  console.log(`  ${exports.falseRejectsPath}`);
  console.log(`  ${exports.sourceQualityPath}`);

  closeDb();
}

main().catch((err) => {
  console.error('[validate] failed:', err);
  process.exit(1);
});

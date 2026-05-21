// Reset and seed the local SQLite database with the mock connector's leads.
// Safe to re-run; the file is wiped at the start.
import { resetDb, closeDb } from '../src/db/client';
import { runLeadSourcingPipeline } from '../src/pipeline/runLeadSourcingPipeline';
import { mockSourceConnector } from '../src/sources/index';

async function main() {
  console.log('[seed] resetting database…');
  resetDb();

  console.log('[seed] running pipeline against mock connector…');
  const summary = await runLeadSourcingPipeline({ sources: [mockSourceConnector] });

  console.log('[seed] done.');
  console.log(`        fetched: ${summary.totalFetched}`);
  console.log(`        accepted into review queue: ${summary.accepted}`);
  console.log(`        rejected: ${summary.rejected}`);
  console.log(`        priorities: A=${summary.byPriority.A} B=${summary.byPriority.B} C=${summary.byPriority.C} Reject=${summary.byPriority.Reject}`);

  closeDb();
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});

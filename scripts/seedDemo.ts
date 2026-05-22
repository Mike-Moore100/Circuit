// Explicit DEMO seed. Loads the mock connector's fixtures, which are
// tagged data_origin='DEMO'. Real-mode dashboard views filter these
// out — that's the point.
//
// Required env: ALLOW_MOCK_DATA=1. Without it, this script refuses
// to run so the operator can never accidentally seed mock data into
// what looks like a real environment.
//
//   ALLOW_MOCK_DATA=1 npm run seed:demo
//   ALLOW_MOCK_DATA=1 npm run seed:demo -- --skip-evidence
import { closeDb } from '../src/db/client';
import { config } from '../src/config/index';
import { runSeedWorkflow } from '../src/services/index';

async function main() {
  if (!config.allowMockData) {
    console.error(
      '[seed:demo] refused — ALLOW_MOCK_DATA=1 is required to write mock data.\n' +
        '            Run: ALLOW_MOCK_DATA=1 npm run seed:demo',
    );
    process.exit(2);
  }
  const skipEvidence = process.argv.includes('--skip-evidence');
  const result = await runSeedWorkflow({
    skipEvidence,
    onProgress: (e) => {
      if (e.code.startsWith('evidence.lead.')) {
        console.log(
          `        [${e.code.endsWith('ok') ? 'ok     ' : e.code.endsWith('partial') ? 'partial' : 'failed '}] ${e.message}`,
        );
        return;
      }
      if (e.code.startsWith('intel.lead.')) return;
      console.log(`[seed:demo] ${e.message}`);
    },
  });
  const s = result.stats!;
  console.log('');
  console.log(
    `[seed:demo] done — accepted=${s.accepted} rejected=${s.rejected} evidence(ok=${s.evidenceOk}/partial=${s.evidencePartial}/failed=${s.evidenceFailed}) intelligence=${s.intelligenceComputed}`,
  );
  console.log(
    '[seed:demo] Note: these companies are tagged data_origin=DEMO and will\n' +
      "            only appear in the dashboard when DEMO_MODE=1.",
  );
  closeDb();
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error('[seed:demo] failed:', err);
  process.exit(1);
});

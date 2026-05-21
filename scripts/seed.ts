// Thin wrapper around runSeedWorkflow. Service in src/services/seedService.ts.
//
//   npm run seed
//   npm run seed -- --skip-evidence
import { closeDb } from '../src/db/client';
import { runSeedWorkflow } from '../src/services/index';

async function main() {
  const skipEvidence = process.argv.includes('--skip-evidence');
  const result = await runSeedWorkflow({
    skipEvidence,
    onProgress: (e) => {
      if (e.code.startsWith('evidence.lead.')) {
        // Per-lead evidence chatter — keep terse.
        console.log(`        [${e.code.endsWith('ok') ? 'ok     ' : e.code.endsWith('partial') ? 'partial' : 'failed '}] ${e.message}`);
        return;
      }
      if (e.code.startsWith('intel.lead.')) return; // suppress per-lead intel
      console.log(`[seed] ${e.message}`);
    },
  });
  const s = result.stats!;
  console.log('');
  console.log(
    `[seed] done — accepted=${s.accepted} rejected=${s.rejected} evidence(ok=${s.evidenceOk}/partial=${s.evidencePartial}/failed=${s.evidenceFailed}) intelligence=${s.intelligenceComputed}`,
  );
  closeDb();
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});

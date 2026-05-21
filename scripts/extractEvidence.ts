// Thin wrapper around runEvidenceBatch. Service in src/services/evidenceService.ts.
//
//   npm run extract:evidence
//   npm run extract:evidence -- --force --limit 10
import { closeDb } from '../src/db/client';
import { runEvidenceBatch } from '../src/services/index';

function parseArgs(): { force: boolean; limit: number | null } {
  const args = process.argv.slice(2);
  let force = false;
  let limit: number | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--force' || a === '-f') force = true;
    else if (a === '--limit' || a === '-n') {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v)) limit = v;
      i += 1;
    }
  }
  return { force, limit };
}

async function main() {
  const { force, limit } = parseArgs();
  const result = await runEvidenceBatch({
    force,
    limit,
    onProgress: (e) => {
      if (e.code === 'batch.start' || e.code === 'batch.done' || e.code === 'batch.disabled') {
        console.log(`[evidence] ${e.message}`);
      } else if (e.code === 'lead.ok') {
        console.log(`  ok      ${e.message}`);
      } else if (e.code === 'lead.partial') {
        console.log(`  partial ${e.message}`);
      } else if (e.code === 'lead.failed') {
        console.log(`  failed  ${e.message}`);
      }
    },
  });
  const s = result.stats!;
  console.log(
    `\n[evidence] done in ${(result.durationMs / 1000).toFixed(1)}s — ok=${s.ok} partial=${s.partial} failed=${s.failed}`,
  );
  closeDb();
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error('[evidence] failed:', err);
  process.exit(1);
});

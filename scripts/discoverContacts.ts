// Thin wrapper around runContactDiscoveryBatch — the business logic lives
// in src/services/contactDiscoveryService.ts. This script only parses CLI
// args, prints progress, and exits. The same service is callable from
// API routes, the dashboard, and any future scheduler.
//
//   npm run discover:contacts
//   npm run discover:contacts -- --force --limit 25
import { closeDb } from '../src/db/client';
import { runContactDiscoveryBatch } from '../src/services/index';

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
  const result = await runContactDiscoveryBatch({
    force,
    limit,
    onProgress: (e) => {
      if (e.code === 'batch.start' || e.code === 'batch.done') {
        console.log(`[contacts] ${e.message}`);
      } else if (e.code === 'lead.ok') {
        console.log(`  ok   ${e.message}`);
      } else if (e.code === 'lead.failed') {
        console.log(`  fail ${e.message}`);
      }
    },
  });
  const s = result.stats!;
  console.log(
    `\n[contacts] done in ${(result.durationMs / 1000).toFixed(1)}s — crawled=${s.ok} cached=${s.cached} failed=${s.failed}, contacts=${s.totalContacts} direct=${s.totalDirectEmails}, playwright=${s.playwrightInvocations}`,
  );
  closeDb();
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error('[contacts] failed:', err);
  process.exit(1);
});

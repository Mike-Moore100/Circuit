// Thin wrapper around runDiscoveryBatch. Real orchestration lives in
// src/discovery/discoveryScheduler.ts; the service contract lives in
// src/services/discoveryService.ts.
//
//   npm run run:discovery
//   npm run run:discovery -- --no-validate --rate-limit 600
//   npm run run:discovery -- --max-per-query 10
import { closeDb } from '../src/db/client';
import { runDiscoveryBatch } from '../src/services/index';

function parseArgs(): { validate: boolean; rateLimitMs: number; maxPerQuery: number | undefined } {
  const args = process.argv.slice(2);
  let validate = true;
  let rateLimitMs = 1200;
  let maxPerQuery: number | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--no-validate') validate = false;
    else if (args[i] === '--rate-limit') {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v)) rateLimitMs = v;
      i++;
    } else if (args[i] === '--max-per-query') {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v)) maxPerQuery = v;
      i++;
    }
  }
  return { validate, rateLimitMs, maxPerQuery };
}

async function main() {
  const { validate, rateLimitMs, maxPerQuery } = parseArgs();
  const result = await runDiscoveryBatch({
    validate,
    rateLimitMs,
    maxPerQuery,
    onProgress: (e) => {
      if (e.code === 'discovery.start' || e.code === 'discovery.done') {
        console.log(`[discovery] ${e.message}`);
      } else if (e.code === 'discovery.validation.invalid') {
        console.log(`  invalid ${e.message}`);
      } else if (e.code === 'discovery.validation.valid') {
        console.log(`  valid   ${e.message}`);
      }
    },
  });
  const s = result.stats!;
  console.log(
    `\n[discovery] done in ${(result.durationMs / 1000).toFixed(1)}s — raw=${s.rawFound} valid=${s.validDomains} dup=${s.deduped} rej=${s.rejected}`,
  );
  closeDb();
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error('[discovery] failed:', err);
  process.exit(1);
});

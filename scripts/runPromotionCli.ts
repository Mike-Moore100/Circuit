// Thin wrapper around runPromotionBatch. Real orchestration lives in
// src/promotion/* and src/services/promotionService.ts.
//
//   npm run run:promotion                       (promote only)
//   npm run run:promotion -- --process          (promote + run queue)
//   npm run run:promotion -- --threshold 8      (more selective)
//   npm run run:promotion -- --limit 50         (cap per run)
import { closeDb } from '../src/db/client';
import { runPromotionBatch } from '../src/services/index';

function parseArgs(): {
  processQueue: boolean;
  limit?: number;
  signalThreshold?: number;
  queueLimit?: number;
  rateLimitMs?: number;
} {
  const args = process.argv.slice(2);
  let processQueue = false;
  let limit: number | undefined;
  let signalThreshold: number | undefined;
  let queueLimit: number | undefined;
  let rateLimitMs: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--process') processQueue = true;
    else if (a === '--limit') {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v)) limit = v;
      i++;
    } else if (a === '--threshold') {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v)) signalThreshold = v;
      i++;
    } else if (a === '--queue-limit') {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v)) queueLimit = v;
      i++;
    } else if (a === '--rate-limit') {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v)) rateLimitMs = v;
      i++;
    }
  }
  return { processQueue, limit, signalThreshold, queueLimit, rateLimitMs };
}

async function main() {
  const { processQueue, limit, signalThreshold, queueLimit, rateLimitMs } = parseArgs();
  const result = await runPromotionBatch({
    processQueue,
    limit,
    signalThreshold,
    queueLimit,
    queueRateLimitMs: rateLimitMs,
    onProgress: (e) => {
      if (e.code === 'promotion.start' || e.code === 'promotion.done') {
        console.log(`[promotion] ${e.message}`);
      } else if (e.code === 'promotion.promote') {
        console.log(`  promote ${e.message}`);
      } else if (e.code === 'promotion.skip') {
        console.log(`  skip    ${e.message}`);
      } else if (e.code === 'qualification.start' || e.code === 'qualification.done') {
        console.log(`[qualification] ${e.message}`);
      } else if (e.code === 'qualification.promoted') {
        console.log(`  ok     ${e.message}`);
      } else if (e.code === 'qualification.failed') {
        console.log(`  failed ${e.message}`);
      }
    },
  });
  const s = result.stats!;
  console.log(
    `\n[promotion] done in ${(result.durationMs / 1000).toFixed(1)}s — considered=${s.considered} promoted=${s.promoted} skipped=${s.skipped} qual={attempted=${s.qualificationAttempted}, ok=${s.qualificationPromoted}, failed=${s.qualificationFailed}}`,
  );
  closeDb();
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error('[promotion] failed:', err);
  process.exit(1);
});

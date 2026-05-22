// Read-only inspector for the Discovery → Qualification queue. Shows
// queue depth, per-status breakdown, top promotion + skip reasons,
// last-24h throughput.
//
//   npm run debug:promotion
import { closeDb } from '../src/db/client';
import { getPromotionOverview } from '../src/services/index';

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function main() {
  const { stats, recent } = getPromotionOverview();
  console.log('Circuit — Discovery → Qualification queue');
  console.log('=========================================');
  console.log('');
  console.log(`Total queue rows           : ${stats.total}`);
  for (const status of ['PENDING', 'PROCESSING', 'PROMOTED', 'SKIPPED', 'FAILED']) {
    console.log(`  ${pad(status, 22)} ${stats.byStatus[status] ?? 0}`);
  }
  console.log('');
  console.log('Last 24h');
  console.log(`  promoted/pending/active : ${stats.recent24hPromoted}`);
  console.log(`  skipped                 : ${stats.recent24hSkipped}`);
  console.log(`  failed                  : ${stats.recent24hFailed}`);
  console.log('');
  console.log('Top promotion reasons');
  if (stats.topPromotionReasons.length === 0) {
    console.log('  (no promotions yet — run npm run run:promotion)');
  } else {
    for (const r of stats.topPromotionReasons) {
      console.log(`  ${String(r.count).padStart(4)}  ${r.reason}`);
    }
  }
  console.log('');
  console.log('Recent queue activity');
  if (recent.length === 0) {
    console.log('  (queue empty)');
  } else {
    for (const r of recent) {
      console.log(
        `  ${pad(r.status, 11)} prio=${String(r.priority).padStart(3)}  ${pad(r.domain, 38).slice(0, 38)}  ${r.promotion_reason.slice(0, 60)}`,
      );
    }
  }

  closeDb();
}

try {
  main();
} catch (err) {
  console.error('[debug:promotion] failed:', err);
  process.exit(1);
}

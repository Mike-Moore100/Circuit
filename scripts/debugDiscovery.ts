// Read-only diagnostic for the discovery layer. Shows throughput per
// source, validation pass rates, dedupe rates, recent runs, and the
// last 24h volume.
//
//   npm run debug:discovery
import { closeDb } from '../src/db/client';
import { getDiscoveryOverview } from '../src/services/index';

function pct(n: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((n / total) * 100)}%`;
}

function main() {
  const { stats, recentRuns } = getDiscoveryOverview();
  console.log('Circuit — Discovery Layer');
  console.log('=========================');
  console.log('');
  console.log(`Total runs                : ${stats.totalRuns}`);
  console.log(`Total raw discoveries     : ${stats.totalRawFound}`);
  console.log(`Total validated as fresh  : ${stats.totalValid}`);
  console.log(`Total marked duplicate    : ${stats.totalDeduped}`);
  console.log(`Total rejected            : ${stats.totalRejected}`);
  console.log('');
  console.log(`Last 24h raw discoveries  : ${stats.domainsToday}`);
  console.log(`Last 24h validated        : ${stats.validToday}`);
  if (stats.domainsToday > 0) {
    console.log(`  validation pass rate    : ${pct(stats.validToday, stats.domainsToday)}`);
  }
  console.log('');
  console.log('By source');
  const sources = Object.entries(stats.bySource).sort((a, b) => b[1].valid - a[1].valid);
  if (sources.length === 0) {
    console.log('  (no runs yet)');
  } else {
    for (const [src, s] of sources) {
      const total = s.valid + s.rejected + s.deduped;
      console.log(
        `  ${src.padEnd(28)}  valid=${String(s.valid).padStart(4)}  rejected=${String(s.rejected).padStart(4)}  duplicate=${String(s.deduped).padStart(4)}  pass=${pct(s.valid, total)}`,
      );
    }
  }
  console.log('');
  console.log('Top validation failure reasons');
  const failures = Object.entries(stats.validationFailures).sort((a, b) => b[1] - a[1]);
  if (failures.length === 0) {
    console.log('  (no rejected rows yet)');
  } else {
    for (const [reason, n] of failures) {
      console.log(`  ${String(n).padStart(4)}  ${reason.slice(0, 80)}`);
    }
  }
  console.log('');
  console.log('Recent runs');
  if (recentRuns.length === 0) {
    console.log('  (no runs recorded yet)');
  } else {
    for (const r of recentRuns) {
      const status = r.completed_at ? 'done' : 'running';
      console.log(
        `  ${r.started_at}  ${status.padEnd(7)}  raw=${String(r.raw_found).padStart(4)}  valid=${String(r.valid_domains).padStart(4)}  dup=${String(r.deduped).padStart(4)}  rej=${String(r.rejected).padStart(4)}  src=${r.source}`,
      );
    }
  }

  closeDb();
}

try {
  main();
} catch (err) {
  console.error('[debug:discovery] failed:', err);
  process.exit(1);
}

// validate:free-real — end-to-end real-mode validation. Runs:
//   1. free discovery (DuckDuckGo + Yell)
//   2. promotion + qualification queue processing
//   3. reports: discovered / valid / promoted / qualified
//      top real opportunities · source quality · blockers
//
// Refuses to run if ALLOW_MOCK_DATA=1 — this is a REAL-mode validator.
//
//   npm run validate:free-real
//   npm run validate:free-real -- --max-per-query 10 --rate-limit 2500

import { closeDb, getDb } from '../src/db/client';
import { config } from '../src/config/index';
import { duckDuckGoSerp } from '../src/discovery/serpDiscovery';
import { yellDirectory } from '../src/discovery/directoryDiscovery';
import type { DiscoveryQuery } from '../src/discovery/discoveryTypes';
import {
  getDiscoveryStats,
  getQualificationQueueStats,
  listOpportunityIntelligence,
} from '../src/db/repository';
import { runDiscoveryBatch, runPromotionBatch } from '../src/services/index';

const INDUSTRIES = [
  'recruitment agency',
  'marketing agency',
  'accountants',
  'estate agents',
  'consultants',
  'legal firm',
  'web agency',
];
const LOCATIONS = [
  'London',
  'Manchester',
  'Birmingham',
  'Leeds',
  'Bristol',
  'Liverpool',
  'Glasgow',
  'Edinburgh',
  'Cardiff',
  'Newcastle',
];

interface Args {
  maxPerQuery: number;
  rateLimitMs: number;
  skipDiscovery: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let maxPerQuery = 10;
  let rateLimitMs = 2500;
  let skipDiscovery = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--max-per-query' && args[i + 1]) {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v)) maxPerQuery = v;
      i++;
    } else if (a === '--rate-limit' && args[i + 1]) {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v)) rateLimitMs = v;
      i++;
    } else if (a === '--skip-discovery') {
      skipDiscovery = true;
    }
  }
  return { maxPerQuery, rateLimitMs, skipDiscovery };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

async function main() {
  if (config.allowMockData) {
    console.error(
      '[validate:free-real] refused — ALLOW_MOCK_DATA is set. This is a\n' +
        '                     REAL-mode validator. Unset and re-run.',
    );
    process.exit(2);
  }

  const { maxPerQuery, rateLimitMs, skipDiscovery } = parseArgs();
  const db = getDb();
  const errors: string[] = [];

  console.log('Circuit — validate:free-real');
  console.log('============================');
  console.log('');
  console.log(`mode              : REAL (DEMO_MODE=${config.demoMode}, ALLOW_MOCK_DATA=${config.allowMockData})`);
  console.log(`free source mode  : ${config.freeSourceMode}`);
  console.log(`UK matrix         : ${INDUSTRIES.length} industries × ${LOCATIONS.length} cities = ${INDUSTRIES.length * LOCATIONS.length} queries`);
  console.log(`rate limit        : ${rateLimitMs}ms between requests`);
  console.log('');

  // ---- 1. Discovery ---------------------------------------------------
  if (skipDiscovery) {
    console.log('[1/3] discovery — SKIPPED (--skip-discovery)');
  } else {
    console.log('[1/3] discovery — DuckDuckGo + Yell (free, no API keys)');
    const queries: DiscoveryQuery[] = INDUSTRIES.flatMap((i) =>
      LOCATIONS.map((l) => ({ industry: i, location: l })),
    );
    const discResult = await runDiscoveryBatch({
      queries,
      sources: [duckDuckGoSerp, yellDirectory],
      maxPerQuery,
      rateLimitMs,
      validate: true,
    });
    const ds = discResult.stats!;
    console.log(
      `      raw=${ds.rawFound} valid=${ds.validDomains} deduped=${ds.deduped} rejected=${ds.rejected} (${(discResult.durationMs / 1000).toFixed(1)}s)`,
    );
    if (discResult.errors.length > 0) {
      errors.push(`discovery: ${discResult.errors.length} errors (likely connector bot-blocking)`);
      for (const e of discResult.errors.slice(0, 3)) console.log(`      ! ${e}`);
    }
  }

  // ---- 2. Promotion + qualification queue processing -------------------
  console.log('');
  console.log('[2/3] promotion + qualification — process all PENDING');
  const promResult = await runPromotionBatch({
    processQueue: true,
    queueRateLimitMs: 1500,
  });
  const ps = promResult.stats!;
  console.log(
    `      considered=${ps.considered} promoted=${ps.promoted} skipped=${ps.skipped} qual={attempted=${ps.qualificationAttempted}, ok=${ps.qualificationPromoted}, failed=${ps.qualificationFailed}} (${(promResult.durationMs / 1000).toFixed(1)}s)`,
  );
  if (promResult.errors.length > 0) {
    errors.push(`promotion: ${promResult.errors.length} errors`);
    for (const e of promResult.errors.slice(0, 3)) console.log(`      ! ${e}`);
  }

  // ---- 3. Inventory + report ------------------------------------------
  console.log('');
  console.log('[3/3] inventory');

  const discoveryStats = getDiscoveryStats(db);
  const queueStats = getQualificationQueueStats(db);

  // Per-source breakdown
  console.log('');
  console.log('source quality');
  const sources = Object.entries(discoveryStats.bySource).sort((a, b) => b[1].valid - a[1].valid);
  if (sources.length === 0) {
    console.log('  (no discovery activity)');
    errors.push('discovery: no source produced any results — likely all bot-blocked');
  } else {
    for (const [src, s] of sources) {
      const total = s.valid + s.rejected + s.deduped;
      const passPct = total > 0 ? Math.round((s.valid / total) * 100) : 0;
      console.log(`  ${pad(src, 26)} valid=${String(s.valid).padStart(3)}  rej=${String(s.rejected).padStart(3)}  dup=${String(s.deduped).padStart(3)}  pass=${passPct}%`);
    }
  }

  // REAL companies count
  const realCount = (db
    .prepare("SELECT COUNT(*) AS n FROM companies WHERE data_origin = 'REAL'")
    .get() as { n: number }).n;
  const demoCount = (db
    .prepare("SELECT COUNT(*) AS n FROM companies WHERE data_origin = 'DEMO'")
    .get() as { n: number }).n;

  console.log('');
  console.log('companies (data_origin)');
  console.log(`  REAL : ${realCount}`);
  console.log(`  DEMO : ${demoCount} (filtered out of REAL-mode views)`);

  console.log('');
  console.log('qualification queue');
  for (const status of ['PENDING', 'PROCESSING', 'PROMOTED', 'SKIPPED', 'FAILED']) {
    const n = queueStats.byStatus[status] ?? 0;
    if (n > 0) console.log(`  ${pad(status, 12)} ${n}`);
  }

  // Top real opportunities
  const opps = listOpportunityIntelligence(db, { limit: 10 });
  console.log('');
  console.log('top real opportunities');
  if (opps.length === 0) {
    console.log('  (none yet — qualification needs to complete for the pipeline to score)');
  } else {
    const names = new Map(
      (db
        .prepare(
          `SELECT id, name FROM companies WHERE id IN (${opps.map(() => '?').join(',')})`,
        )
        .all(...opps.map((o) => o.company_id)) as Array<{ id: string; name: string }>).map((r) => [
        r.id,
        r.name,
      ]),
    );
    for (const o of opps.slice(0, 10)) {
      console.log(
        `  ${String(o.opportunity_score).padStart(3)}  ${pad(o.human_attention_priority, 10)}  ${pad(o.likely_project_type.toLowerCase().replace(/_/g, ' '), 22)}  ${names.get(o.company_id) ?? o.company_id}`,
      );
    }
  }

  // ---- Final verdict --------------------------------------------------
  console.log('');
  console.log('verdict');
  console.log(`  discovered (valid)        : ${discoveryStats.totalValid}`);
  console.log(`  promoted into companies   : ${queueStats.byStatus.PROMOTED ?? queueStats.byStatus.PROCESSING ?? 0}`);
  console.log(`  qualified (intelligence)  : ${opps.length}`);
  console.log(`  blockers                  : ${errors.length}`);
  if (errors.length > 0) {
    for (const e of errors) console.log(`    - ${e}`);
  }

  closeDb();
  // Exit non-zero only if there were unexpected errors.
  if (errors.length > 0 && realCount === 0) process.exit(1);
}

main().catch((err) => {
  console.error('[validate:free-real] failed:', err);
  process.exit(1);
});

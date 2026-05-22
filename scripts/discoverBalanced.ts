// discover:balanced — Phase 1 rebalance CLI. Reads the current corpus's
// industry distribution, asks the diversity planner for a balanced
// batch of queries, then runs free-source discovery against them.
//
// Crucially: marketing/web/design agencies are capped at 10% each by
// default, so the planner will refuse to pile more marketing-agency
// queries on top of the existing 100% marketing-agency corpus.
//
//   npm run discover:balanced
//   npm run discover:balanced -- --budget 30 --rate-limit 2500
//   npm run discover:balanced -- --plan-only          (don't fetch)

import { closeDb, getDb } from '../src/db/client';
import { config } from '../src/config/index';
import { runDiscoveryBatch } from '../src/services/index';
import { duckDuckGoSerp } from '../src/discovery/serpDiscovery';
import { yellDirectory } from '../src/discovery/directoryDiscovery';
import { visibleOrigins } from '../src/db/dataMode';
import { planDiversifiedDiscovery } from '../src/discovery/discoveryDiversity';
import { isCanonicalIndustry, normaliseIndustry } from '../src/discovery/industryNormalizer';

interface Args {
  budget: number;
  rateLimitMs: number;
  planOnly: boolean;
  maxPerQuery: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let budget = 25;
  let rateLimitMs = 2500;
  let planOnly = false;
  let maxPerQuery = 10;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--budget' && args[i + 1]) {
      const v = Number(args[i + 1]); if (Number.isFinite(v)) budget = v; i++;
    } else if (a === '--rate-limit' && args[i + 1]) {
      const v = Number(args[i + 1]); if (Number.isFinite(v)) rateLimitMs = v; i++;
    } else if (a === '--max-per-query' && args[i + 1]) {
      const v = Number(args[i + 1]); if (Number.isFinite(v)) maxPerQuery = v; i++;
    } else if (a === '--plan-only') {
      planOnly = true;
    }
  }
  return { budget, rateLimitMs, planOnly, maxPerQuery };
}

function readCurrentIndustryCounts(): Record<string, number> {
  const db = getDb();
  const origins = visibleOrigins();
  const placeholders = origins.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT industry, COUNT(*) AS n FROM companies
        WHERE data_origin IN (${placeholders}) AND industry IS NOT NULL
        GROUP BY industry`,
    )
    .all(...origins) as Array<{ industry: string; n: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) {
    // Defensive renormalisation — store under the canonical label.
    let key = r.industry;
    if (!isCanonicalIndustry(key)) {
      const n = normaliseIndustry(key, 'name');
      if (n.industry) key = n.industry;
    }
    out[key] = (out[key] ?? 0) + r.n;
  }
  return out;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

async function main() {
  if (config.allowMockData) {
    console.error(
      '[discover:balanced] refused — ALLOW_MOCK_DATA is set. Unset and re-run.',
    );
    process.exit(2);
  }

  const args = parseArgs();
  const industryCounts = readCurrentIndustryCounts();

  console.log('Circuit — discover:balanced');
  console.log('===========================');
  console.log(`mode              : ${args.planOnly ? 'plan-only' : 'fetch + persist'}`);
  console.log(`query budget      : ${args.budget}`);
  console.log(`rate limit        : ${args.rateLimitMs}ms`);
  console.log('');

  // Plan the batch. The planner reads industry caps (marketing 10%,
  // others 20%) and the min-industries-per-batch floor (default 5)
  // from industryBalancing's defaults — no extra config needed.
  const plan = planDiversifiedDiscovery({
    queryBudget: args.budget,
    industryCounts,
  });

  console.log('plan');
  console.log(`  industries covered : ${plan.industriesCovered}`);
  console.log(`  queries planned    : ${plan.queries.length}`);
  if (plan.minIndustriesUnmet) {
    console.log('  ⚠ minimum-industries-per-batch NOT met — too small a budget or pool');
  }
  console.log('');
  console.log('per-industry quota');
  for (const [ind, n] of Object.entries(plan.quotaPerIndustry).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )) {
    console.log(`  ${pad(ind, 30)}  ${String(n).padStart(3)}`);
  }
  console.log('');

  if (plan.queries.length === 0) {
    console.log('No queries produced. Either every target industry is over the cap or the budget is 0.');
    closeDb();
    return;
  }

  if (args.planOnly) {
    console.log('sample queries (--plan-only)');
    for (const q of plan.queries.slice(0, 30)) {
      console.log(`  ${q.queryString}`);
    }
    closeDb();
    return;
  }

  // Convert GeneratedQuery → DiscoveryQuery (drop the extras the
  // scheduler doesn't need).
  const queries = plan.queries.map((q) => ({
    industry: q.industry,
    location: q.location,
  }));

  console.log(`Running ${queries.length} queries via DuckDuckGo + Yell …`);
  const result = await runDiscoveryBatch({
    queries,
    sources: [duckDuckGoSerp, yellDirectory],
    maxPerQuery: args.maxPerQuery,
    rateLimitMs: args.rateLimitMs,
    validate: true,
    onProgress: (e) => {
      if (e.code === 'discovery.start' || e.code === 'discovery.done') {
        console.log(`[discover:balanced] ${e.message}`);
      }
    },
  });

  const s = result.stats!;
  console.log('');
  console.log('summary');
  console.log(`  duration   : ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`  raw found  : ${s.rawFound}`);
  console.log(`  valid      : ${s.validDomains}`);
  console.log(`  deduped    : ${s.deduped}`);
  console.log(`  rejected   : ${s.rejected}`);
  if (result.errors.length > 0) {
    console.log(`  errors     : ${result.errors.length}`);
    for (const err of result.errors.slice(0, 5)) console.log(`    ! ${err}`);
  }
  console.log('');
  console.log('Next:');
  console.log('  npm run run:promotion -- --process     # qualify the new leads');
  console.log('  npm run debug:corpus                   # verify the rebalance');

  closeDb();
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error('[discover:balanced] failed:', err);
  process.exit(1);
});

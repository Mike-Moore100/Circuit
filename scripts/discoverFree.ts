// Free real-source discovery. UK industries × cities, free connectors
// only (DuckDuckGo HTML SERP + Yell.com directory). Polite rate limits.
// No paid APIs.
//
//   npm run discover:free
//   npm run discover:free -- --max-per-query 15 --rate-limit 2000
//   npm run discover:free -- --industries "marketing agency,legal firm"
//   npm run discover:free -- --locations "London,Manchester"
//   npm run discover:free -- --no-validate   (skip the per-domain GET)
//
// Everything this script discovers flows through promotion +
// qualification as data_origin=REAL.

import { closeDb } from '../src/db/client';
import { config } from '../src/config/index';
import { runDiscoveryBatch } from '../src/services/index';
import { duckDuckGoSerp } from '../src/discovery/serpDiscovery';
import { yellDirectory } from '../src/discovery/directoryDiscovery';
import type { DiscoveryQuery } from '../src/discovery/discoveryTypes';

// Locked UK targets per the Phase 14.2 brief.
const DEFAULT_INDUSTRIES = [
  'recruitment agency',
  'marketing agency',
  'accountants',
  'estate agents',
  'consultants',
  'legal firm',
  'web agency',
];

const DEFAULT_LOCATIONS = [
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
  industries: string[];
  locations: string[];
  maxPerQuery: number;
  rateLimitMs: number;
  validate: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let industries = DEFAULT_INDUSTRIES;
  let locations = DEFAULT_LOCATIONS;
  // Polite defaults — DuckDuckGo will rate-limit if you hammer it.
  let maxPerQuery = 15;
  let rateLimitMs = 2000;
  let validate = true;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--industries' && args[i + 1]) {
      industries = args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else if (a === '--locations' && args[i + 1]) {
      locations = args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else if (a === '--max-per-query' && args[i + 1]) {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v)) maxPerQuery = v;
      i += 1;
    } else if (a === '--rate-limit' && args[i + 1]) {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v)) rateLimitMs = v;
      i += 1;
    } else if (a === '--no-validate') {
      validate = false;
    }
  }
  return { industries, locations, maxPerQuery, rateLimitMs, validate };
}

async function main() {
  // Phase 14.2 — refuse to run alongside mock data. If the operator
  // wants demo seeding they should use seed:demo explicitly.
  if (config.allowMockData) {
    console.error(
      '[discover:free] refused — ALLOW_MOCK_DATA is set. Free discovery is\n' +
        '                a REAL-mode operation. Unset ALLOW_MOCK_DATA and re-run.',
    );
    process.exit(2);
  }

  const { industries, locations, maxPerQuery, rateLimitMs, validate } = parseArgs();
  const queries: DiscoveryQuery[] = industries.flatMap((i) =>
    locations.map((l) => ({ industry: i, location: l })),
  );

  console.log('[discover:free] Free-source real discovery (no paid APIs)');
  console.log(
    `[discover:free] ${queries.length} queries (${industries.length} industries × ${locations.length} cities) · rate=${rateLimitMs}ms`,
  );
  console.log(`[discover:free] sources: serp.duckduckgo, directory.yell`);

  const result = await runDiscoveryBatch({
    queries,
    sources: [duckDuckGoSerp, yellDirectory],
    maxPerQuery,
    rateLimitMs,
    validate,
    onProgress: (e) => {
      if (e.code === 'discovery.start' || e.code === 'discovery.done') {
        console.log(`[discover:free] ${e.message}`);
      } else if (e.code === 'discovery.validation.valid') {
        console.log(`  valid   ${e.message}`);
      } else if (e.code === 'discovery.validation.invalid') {
        console.log(`  invalid ${e.message}`);
      }
    },
  });

  const s = result.stats!;
  console.log('');
  console.log('[discover:free] summary');
  console.log(`  duration   : ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`  raw found  : ${s.rawFound}`);
  console.log(`  valid      : ${s.validDomains}`);
  console.log(`  deduped    : ${s.deduped}`);
  console.log(`  rejected   : ${s.rejected}`);
  if (result.errors.length > 0) {
    console.log('');
    console.log(`[discover:free] ${result.errors.length} errors`);
    for (const e of result.errors.slice(0, 5)) console.log(`  ${e}`);
  }
  console.log('');
  console.log('[discover:free] Next: npm run run:promotion -- --process');

  closeDb();
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error('[discover:free] failed:', err);
  process.exit(1);
});

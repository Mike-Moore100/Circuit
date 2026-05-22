// debug:registry — Companies House enrichment status + optional fresh run.
//
//   npm run debug:registry              # print current cache + UK eligibility
//   npm run debug:registry -- --enrich  # also enrich every UK lead that isn't cached
//   npm run debug:registry -- --force   # bypass UK gating (for one-off ops)
//   npm run debug:registry -- --limit 10

import { closeDb, getDb } from '../src/db/client';
import { config } from '../src/config/index';
import {
  getRegistryEnrichment,
  getRegistryEnrichmentStats,
} from '../src/db/repository';
import { visibleOrigins } from '../src/db/dataMode';
import {
  detectUkContext,
  RegistryEnrichmentService,
} from '../src/enrichment/registryEnrichmentService';

interface Args {
  enrich: boolean;
  force: boolean;
  limit: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let enrich = false;
  let force = false;
  let limit = 25;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--enrich') enrich = true;
    else if (args[i] === '--force') force = true;
    else if (args[i] === '--limit' && args[i + 1]) {
      const v = Number(args[i + 1]); if (Number.isFinite(v)) limit = v; i++;
    }
  }
  return { enrich, force, limit };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

async function main() {
  const args = parseArgs();
  const db = getDb();

  console.log('Circuit — debug:registry');
  console.log('========================');
  console.log(`enabled       : ${config.companiesHouse.enabled}`);
  console.log(`api key set   : ${config.companiesHouse.apiKey.length > 0 ? 'yes' : 'no'}`);
  console.log(`cache TTL     : ${config.companiesHouse.cacheTtlDays}d`);
  console.log(`max per run   : ${config.companiesHouse.maxLeadsPerRun}`);
  console.log('');

  // Cache stats
  const stats = getRegistryEnrichmentStats(db);
  console.log('cache stats');
  console.log(`  total cached : ${stats.total}`);
  for (const [outcome, n] of Object.entries(stats.byOutcome).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${pad(outcome, 22)} ${n}`);
  }

  // Per-company eligibility table
  const origins = visibleOrigins();
  const placeholders = origins.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, name, domain, location, discovery_location
         FROM companies
        WHERE data_origin IN (${placeholders})
        ORDER BY name
        LIMIT ?`,
    )
    .all(...origins, args.limit) as Array<{
    id: string;
    name: string;
    domain: string | null;
    location: string | null;
    discovery_location: string | null;
  }>;

  console.log('');
  console.log(`eligibility — first ${rows.length} companies`);
  console.log(
    `  ${pad('name', 34)}  ${pad('domain', 22)}  uk?  cached?         outcome`,
  );
  for (const r of rows) {
    const detection = detectUkContext({
      domain: r.domain,
      location: r.location,
      discoveryLocation: r.discovery_location,
    });
    const cached = getRegistryEnrichment(r.id, db);
    const cachedTag = cached ? 'yes' : 'no';
    console.log(
      `  ${pad(r.name.slice(0, 34), 34)}  ${pad(r.domain ?? '—', 22)}  ${
        detection.isUk ? 'yes' : 'no '
      }  ${pad(cachedTag, 4)}  ${pad(cached?.outcome ?? '', 22)}`,
    );
  }

  if (!args.enrich) {
    console.log('');
    console.log('Tip: add --enrich to fetch missing UK leads.');
    closeDb();
    return;
  }

  // Run enrichment for any eligible lead that's missing OR not currently
  // enriched. The service handles caching + UK gating itself.
  if (!config.companiesHouse.enabled || config.companiesHouse.apiKey.length === 0) {
    console.log('');
    console.log('Cannot enrich — COMPANIES_HOUSE_ENABLED=0 or API key missing.');
    closeDb();
    return;
  }

  const service = new RegistryEnrichmentService();
  let processed = 0;
  let enrichedOk = 0;
  let skipped = 0;
  let failed = 0;
  console.log('');
  console.log('enriching …');
  for (const r of rows) {
    if (processed >= config.companiesHouse.maxLeadsPerRun) break;
    processed += 1;
    const result = await service.enrichCompany({
      companyId: r.id,
      name: r.name,
      domain: r.domain,
      location: r.location,
      discoveryLocation: r.discovery_location,
      force: args.force,
    });
    if (result.outcome === 'enriched' || result.outcome === 'skipped_cache_hit_fresh') {
      enrichedOk += 1;
      const sig = result.signals;
      console.log(
        `  [ok] ${pad(r.name.slice(0, 30), 30)} → ${result.record?.companyName ?? '—'} (${
          result.record?.status ?? '?'
        }, ${sig?.companyAgeYears ?? '?'}y, ${sig?.legitimacyConfidence ?? '?'})`,
      );
    } else if (result.outcome === 'error') {
      failed += 1;
      console.log(`  [err] ${pad(r.name.slice(0, 30), 30)} → ${result.reason}`);
    } else {
      skipped += 1;
      console.log(`  [skip ${pad(result.outcome.replace('skipped_', ''), 12)}] ${pad(r.name.slice(0, 30), 30)} → ${result.reason}`);
    }
  }

  console.log('');
  console.log('enrichment summary');
  console.log(`  processed : ${processed}`);
  console.log(`  enriched  : ${enrichedOk}`);
  console.log(`  skipped   : ${skipped}`);
  console.log(`  errors    : ${failed}`);
  closeDb();
}

main().catch((err) => {
  console.error('[debug:registry] failed:', err);
  process.exit(1);
});

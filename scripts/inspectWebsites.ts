// Inspect (or re-inspect) every known company website. Respects the cache
// unless --force is passed. Use this when scoring rules change and you want
// every lead to be re-scored with up-to-date verified signals.
//
//   npm run inspect:websites
//   npm run inspect:websites -- --force
//   npm run inspect:websites -- --limit 25
import { config } from '../src/config/index';
import { closeDb, getDb } from '../src/db/client';
import {
  extractDomain,
  getAllCompanies,
  getInspectionStats,
} from '../src/db/repository';
import { inspectAndCache, mapWithConcurrency } from '../src/inspection/inspect';

interface Args {
  force: boolean;
  limit: number | null;
}

function parseArgs(): Args {
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
  const db = getDb();
  const companies = getAllCompanies(db).filter((c) => !!c.website_url);
  const target = limit ? companies.slice(0, limit) : companies;

  console.log(
    `[inspect] ${target.length} companies with websites (force=${force}, concurrency=${config.websiteInspection.concurrency})`,
  );

  let ok = 0;
  let cached = 0;
  let failed = 0;
  const startedAt = Date.now();

  await mapWithConcurrency(target, config.websiteInspection.concurrency, async (company) => {
    const out = await inspectAndCache(
      company.website_url,
      { companyId: company.id, force },
      db,
    );
    if (!out) return;
    if (out.result.fromCache) cached += 1;
    if (out.result.status === 'ok') ok += 1;
    if (out.result.status === 'failed' || out.result.status === 'timeout') failed += 1;
    const tag =
      out.result.status === 'ok'
        ? out.result.fromCache
          ? 'cached'
          : 'ok    '
        : out.result.status.padEnd(6);
    console.log(
      `  [${tag}] ${company.name.padEnd(36).slice(0, 36)}  ${
        extractDomain(company.website_url ?? '') ?? '—'
      }  signals=${out.result.signals.length}`,
    );
  });

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const stats = getInspectionStats(db);
  console.log('');
  console.log(
    `[inspect] done in ${elapsed}s — ok=${ok}, cached=${cached}, failed=${failed}`,
  );
  console.log(
    `[inspect] DB totals: inspected=${stats.inspected}, failed=${stats.failed}, byStatus=${JSON.stringify(
      stats.byStatus,
    )}`,
  );
  closeDb();
}

main().catch((err) => {
  console.error('[inspect] failed:', err);
  process.exit(1);
});

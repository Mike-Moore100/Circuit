// backfill:industries — fill in industry/discovery_query/discovery_location
// on existing REAL companies that pre-date Phase 1 metadata capture.
//
// Inference priority (highest → lowest confidence):
//   1. company's existing discovery_query (already linked at promotion)
//   2. linked raw_discoveries.industry / .discovery_query
//   3. linked raw_discoveries.title / .snippet
//   4. company's existing name
//
// Website-body inference is supported but only fires when --read-website
// is set, since it requires fetching pages. Defaults to off to keep this
// a fast offline pass.
//
//   npm run backfill:industries
//   npm run backfill:industries -- --dry-run
//   npm run backfill:industries -- --read-website   # also fetch homepages

import { closeDb, getDb } from '../src/db/client';
import {
  normaliseFromCandidates,
  type InferenceSource,
  type NormalizationResult,
} from '../src/discovery/industryNormalizer';

interface BackfillRow {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  discovery_query: string | null;
  discovery_location: string | null;
  industry_source: string | null;
  rd_industry: string | null;
  rd_discovery_query: string | null;
  rd_discovery_location: string | null;
  rd_title: string | null;
  rd_snippet: string | null;
}

interface Args {
  dryRun: boolean;
  readWebsite: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let dryRun = false;
  let readWebsite = false;
  for (const a of args) {
    if (a === '--dry-run') dryRun = true;
    else if (a === '--read-website') readWebsite = true;
  }
  return { dryRun, readWebsite };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

async function fetchWebsiteText(domain: string): Promise<string | null> {
  // Conservative single-page fetch. The validator already proved the
  // homepage responds — we're just reading a small slice of body text
  // for keyword inference. 6s timeout, real browser UA so we don't get
  // bot-filtered.
  const url = `https://${domain}/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        Accept: 'text/html',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Strip tags + script/style noise, take the first 4kB of text.
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 4000);
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const { dryRun, readWebsite } = parseArgs();
  const db = getDb();

  // Pull every REAL company joined to its most recent raw_discoveries
  // row (matched by domain). The promoter writes both tables but the
  // discovery row is the source of truth for *what we queried for*.
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.domain, c.industry, c.discovery_query,
              c.discovery_location, c.industry_source,
              rd.industry           AS rd_industry,
              rd.discovery_query    AS rd_discovery_query,
              rd.discovery_location AS rd_discovery_location,
              rd.title              AS rd_title,
              rd.snippet            AS rd_snippet
         FROM companies c
         LEFT JOIN raw_discoveries rd
                ON rd.extracted_domain = c.domain
               AND rd.validation_status = 'valid'
        WHERE c.data_origin = 'REAL'`,
    )
    .all() as BackfillRow[];

  console.log('Circuit — backfill:industries');
  console.log('=============================');
  console.log(`real companies          : ${rows.length}`);
  console.log(`mode                    : ${dryRun ? 'dry-run' : 'apply'}`);
  console.log(`website inference       : ${readWebsite ? 'on' : 'off'}`);
  console.log('');

  let inferred = 0;
  let alreadyTagged = 0;
  let unmatched = 0;
  let updated = 0;
  const bySource: Record<string, number> = {};

  for (const r of rows) {
    if (r.industry) {
      alreadyTagged += 1;
      continue;
    }
    // Priority order — strongest evidence first.
    const candidates: Array<{ text: string | null; source: InferenceSource }> = [
      { text: r.rd_discovery_query, source: 'query' },
      { text: r.discovery_query, source: 'query' },
      { text: r.rd_industry, source: 'query' },
      { text: r.rd_title, source: 'title' },
      { text: r.rd_snippet, source: 'snippet' },
      { text: r.name, source: 'name' },
    ];

    let result: NormalizationResult = normaliseFromCandidates(candidates);

    if (!result.industry && readWebsite && r.domain) {
      const text = await fetchWebsiteText(r.domain);
      if (text) {
        result = normaliseFromCandidates([
          ...candidates,
          { text, source: 'website' },
        ]);
      }
    }

    if (!result.industry) {
      unmatched += 1;
      console.log(
        `[skip] ${pad(r.name.slice(0, 36), 36)}  ${pad(r.domain ?? '', 22)}  → no rule matched`,
      );
      continue;
    }
    inferred += 1;
    bySource[result.source ?? 'unknown'] = (bySource[result.source ?? 'unknown'] ?? 0) + 1;

    const action = dryRun ? '[dry] ' : '[set] ';
    console.log(
      `${action}${pad(r.name.slice(0, 36), 36)}  ${pad(r.domain ?? '', 22)}  → ${pad(result.industry, 24)}  (${result.source}, ${result.confidence}%)`,
    );

    if (!dryRun) {
      db.prepare(
        `UPDATE companies
            SET industry            = ?,
                industry_source     = ?,
                industry_confidence = ?,
                discovery_query     = COALESCE(discovery_query, ?),
                discovery_location  = COALESCE(discovery_location, ?),
                updated_at          = datetime('now')
          WHERE id = ?`,
      ).run(
        result.industry,
        result.source,
        result.confidence,
        r.rd_discovery_query ?? r.discovery_query,
        r.rd_discovery_location ?? r.discovery_location,
        r.id,
      );
      updated += 1;
    }
  }

  console.log('');
  console.log('summary');
  console.log(`  inferred              : ${inferred}`);
  console.log(`  already tagged        : ${alreadyTagged}`);
  console.log(`  unmatched             : ${unmatched}`);
  if (!dryRun) console.log(`  updated rows          : ${updated}`);
  if (Object.keys(bySource).length > 0) {
    console.log('  by inference source:');
    for (const [src, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${pad(src, 12)} ${n}`);
    }
  }

  closeDb();
}

main().catch((err) => {
  console.error('[backfill:industries] failed:', err);
  process.exit(1);
});

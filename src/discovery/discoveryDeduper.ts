// Aggressive deduplication for the discovery layer. Cheaper to filter
// here than to validate the same domain N times.
//
// Two passes:
//   1. In-run dedupe — collapse multiple raw rows with the same canonical
//      domain produced by the current batch. We keep the first one and
//      mark the rest as 'duplicate'.
//   2. Cross-DB dedupe — anything already in the `companies` table OR in
//      a previous `raw_discoveries` row gets marked 'duplicate' so the
//      validator skips it.
//
// The deduper is a pure function — DB-aware variants are thin wrappers.

import type { Database } from 'better-sqlite3';
import { extractDomain } from './domainExtraction';
import type { RawDiscovery } from './discoveryTypes';

export interface DedupeResult {
  unique: RawDiscovery[]; // ready for validation
  duplicates: RawDiscovery[]; // domain seen elsewhere
  unparseable: RawDiscovery[]; // raw URL didn't yield a domain
}

// In-run dedupe only. Pure function.
export function dedupeBatch(items: RawDiscovery[]): DedupeResult {
  const seen = new Set<string>();
  const unique: RawDiscovery[] = [];
  const duplicates: RawDiscovery[] = [];
  const unparseable: RawDiscovery[] = [];
  for (const item of items) {
    const domain = item.extractedDomain ?? extractDomain(item.rawUrl);
    if (!domain) {
      unparseable.push({
        ...item,
        validationStatus: 'invalid',
        validationReason: 'no extractable domain',
      });
      continue;
    }
    if (seen.has(domain)) {
      duplicates.push({
        ...item,
        extractedDomain: domain,
        validationStatus: 'duplicate',
        validationReason: 'duplicate of earlier result in same batch',
      });
      continue;
    }
    seen.add(domain);
    unique.push({ ...item, extractedDomain: domain });
  }
  return { unique, duplicates, unparseable };
}

// Cross-DB dedupe. Returns the subset of `items` whose domain is NOT
// already in `companies` and NOT already in a previous raw_discoveries
// row marked valid.
export function rejectExistingDomains(
  items: RawDiscovery[],
  db: Database,
): { fresh: RawDiscovery[]; known: RawDiscovery[] } {
  const fresh: RawDiscovery[] = [];
  const known: RawDiscovery[] = [];
  if (items.length === 0) return { fresh, known };

  // Build the domain set in one query to keep this O(N).
  const placeholders = items.map(() => '?').join(',');
  const inCompanies = db
    .prepare(`SELECT domain FROM companies WHERE domain IN (${placeholders})`)
    .all(...items.map((i) => i.extractedDomain ?? '')) as Array<{ domain: string }>;
  const inDiscoveries = db
    .prepare(
      `SELECT DISTINCT extracted_domain AS domain FROM raw_discoveries
       WHERE extracted_domain IN (${placeholders}) AND validation_status IN ('valid', 'duplicate')`,
    )
    .all(...items.map((i) => i.extractedDomain ?? '')) as Array<{ domain: string }>;

  const knownSet = new Set<string>();
  for (const row of inCompanies) knownSet.add(row.domain);
  for (const row of inDiscoveries) knownSet.add(row.domain);

  for (const item of items) {
    if (item.extractedDomain && knownSet.has(item.extractedDomain)) {
      known.push({
        ...item,
        validationStatus: 'duplicate',
        validationReason: 'already in companies or previous discoveries',
      });
    } else {
      fresh.push(item);
    }
  }
  return { fresh, known };
}

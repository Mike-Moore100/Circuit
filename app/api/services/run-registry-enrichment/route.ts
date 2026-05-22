// POST /api/services/run-registry-enrichment
//
// The UI-driven path for Companies House enrichment. The CLI
// (npm run debug:registry --enrich) stays as a developer fallback;
// every normal operator action flows through this route.
//
// Two modes:
//   { companyId, force? }  → enrich a single lead from the drawer.
//   {}                     → enrich every visible UK lead (capped by
//                            config.companiesHouse.maxLeadsPerRun).
//
// Either mode returns:
//   { ok, result | results, error? }
// where each result is the full RegistryEnrichmentResult so the
// caller can refresh the drawer without an extra fetch.

import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { config } from '../../../../src/config/index';
import { getDb } from '../../../../src/db/client';
import { visibleOrigins } from '../../../../src/db/dataMode';
import { detectUkContext, RegistryEnrichmentService } from '../../../../src/enrichment/registryEnrichmentService';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  companyId: z.string().uuid().optional(),
  force: z.boolean().optional(),
});

interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  location: string | null;
  discovery_location: string | null;
}

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { companyId, force } = parsed.data;

  // Fast pre-flight: if the global enable flag or the API key isn't
  // configured, return a useful error so the drawer can show
  // "regenerate a REST API key" without bothering the orchestrator.
  if (!config.companiesHouse.enabled) {
    return NextResponse.json(
      {
        ok: false,
        error: 'COMPANIES_HOUSE_ENABLED is off',
        outcome: 'skipped_disabled',
      },
      { status: 200 },
    );
  }
  if (!config.companiesHouse.apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error: 'COMPANIES_HOUSE_API_KEY is not set',
        outcome: 'skipped_no_key',
      },
      { status: 200 },
    );
  }

  const db = getDb();
  const service = new RegistryEnrichmentService();

  // ---- Single-lead path -------------------------------------------------
  if (companyId) {
    const row = db
      .prepare(
        'SELECT id, name, domain, location, discovery_location FROM companies WHERE id = ?',
      )
      .get(companyId) as CompanyRow | undefined;
    if (!row) {
      return NextResponse.json(
        { ok: false, error: 'No company found for that id' },
        { status: 404 },
      );
    }
    try {
      const result = await service.enrichCompany({
        companyId: row.id,
        name: row.name,
        domain: row.domain,
        location: row.location,
        discoveryLocation: row.discovery_location,
        force,
      });
      revalidatePath('/opportunities');
      return NextResponse.json({ ok: result.outcome !== 'error', result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  // ---- Batch path -------------------------------------------------------
  // Walk every visible REAL company, capped by the per-run limit. We
  // skip rows the service would reject anyway (non-UK leads) before
  // the call so we don't burn API quota on them.
  const origins = visibleOrigins();
  const placeholders = origins.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, name, domain, location, discovery_location
         FROM companies
        WHERE data_origin IN (${placeholders})
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(...origins, config.companiesHouse.maxLeadsPerRun) as CompanyRow[];

  const results = [];
  let attempted = 0;
  let enriched = 0;
  let errors = 0;
  for (const row of rows) {
    const detection = detectUkContext({
      domain: row.domain,
      location: row.location,
      discoveryLocation: row.discovery_location,
    });
    if (!detection.isUk && !force) {
      // Don't even ask the service — saves a DB read on the cache.
      continue;
    }
    attempted += 1;
    const result = await service.enrichCompany({
      companyId: row.id,
      name: row.name,
      domain: row.domain,
      location: row.location,
      discoveryLocation: row.discovery_location,
      force,
    });
    results.push(result);
    if (result.outcome === 'enriched' || result.outcome === 'skipped_cache_hit_fresh') {
      enriched += 1;
    }
    if (result.outcome === 'error') errors += 1;
    // Stop early on first auth error — burning more quota won't help.
    if (result.outcome === 'error' && /401|403|auth/i.test(result.reason)) {
      break;
    }
  }

  revalidatePath('/opportunities');
  return NextResponse.json({
    ok: errors === 0,
    attempted,
    enriched,
    errors,
    results,
  });
}

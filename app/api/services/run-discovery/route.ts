// POST /api/services/run-discovery
// Thin HTTP wrapper around runDiscoveryBatch. Body is optional — when
// empty, the default industry × city query matrix runs.
//   { queries: [{industry, location}], maxPerQuery, validate, rateLimitMs }
import { NextResponse } from 'next/server';
import { runDiscoveryBatch } from '../../../../src/services/index';

export const dynamic = 'force-dynamic';
// Discovery is rate-limited; allow generous time for a full default matrix.
export const maxDuration = 900;

interface Body {
  queries?: Array<{ industry: string; location: string; modifiers?: string[] }>;
  maxPerQuery?: number;
  validate?: boolean;
  rateLimitMs?: number;
}

export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* empty body fine */
  }
  try {
    const result = await runDiscoveryBatch({
      queries: body.queries,
      maxPerQuery: typeof body.maxPerQuery === 'number' ? body.maxPerQuery : undefined,
      validate: typeof body.validate === 'boolean' ? body.validate : undefined,
      rateLimitMs: typeof body.rateLimitMs === 'number' ? body.rateLimitMs : undefined,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

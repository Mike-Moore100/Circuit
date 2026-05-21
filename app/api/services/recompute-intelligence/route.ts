// POST /api/services/recompute-intelligence
// Thin HTTP wrapper. Two modes:
//   { companyId: "..."} → recompute one lead, returns OpportunityIntelligence.
//   {}                  → recompute every lead in the DB, returns batch result.
import { NextResponse } from 'next/server';
import {
  recomputeAllIntelligence,
  recomputeIntelligenceForLead,
} from '../../../../src/services/index';

export const dynamic = 'force-dynamic';

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  let body: { companyId?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* empty body fine */
  }

  // Single-lead path
  if (body.companyId) {
    if (!UUID_RX.test(body.companyId)) {
      return NextResponse.json({ ok: false, error: 'invalid companyId' }, { status: 400 });
    }
    try {
      const intel = recomputeIntelligenceForLead(body.companyId);
      if (!intel) {
        return NextResponse.json(
          { ok: false, error: 'no company or score found for that companyId' },
          { status: 404 },
        );
      }
      return NextResponse.json({ ok: true, intelligence: intel });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  // Batch path
  try {
    const result = await recomputeAllIntelligence();
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

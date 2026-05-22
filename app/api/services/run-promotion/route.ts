// POST /api/services/run-promotion
// Thin HTTP wrapper around runPromotionBatch. Body is optional; defaults
// promote without processing the qualification queue.
//   { processQueue?: boolean, limit?: number, signalThreshold?: number,
//     queueLimit?: number, queueRateLimitMs?: number }
import { NextResponse } from 'next/server';
import { runPromotionBatch } from '../../../../src/services/index';

export const dynamic = 'force-dynamic';
// Queue processing hits external sites for inspection / contacts — give
// it generous headroom but stop short of the 15-min Vercel ceiling.
export const maxDuration = 600;

interface Body {
  processQueue?: boolean;
  limit?: number;
  signalThreshold?: number;
  queueLimit?: number;
  queueRateLimitMs?: number;
}

export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* empty body fine */
  }
  try {
    const result = await runPromotionBatch({
      processQueue: Boolean(body.processQueue),
      limit: typeof body.limit === 'number' ? body.limit : undefined,
      signalThreshold:
        typeof body.signalThreshold === 'number' ? body.signalThreshold : undefined,
      queueLimit: typeof body.queueLimit === 'number' ? body.queueLimit : undefined,
      queueRateLimitMs:
        typeof body.queueRateLimitMs === 'number' ? body.queueRateLimitMs : undefined,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

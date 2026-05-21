// POST /api/services/extract-evidence
// Thin HTTP wrapper around runEvidenceBatch.
import { NextResponse } from 'next/server';
import { runEvidenceBatch } from '../../../../src/services/index';

export const dynamic = 'force-dynamic';
export const maxDuration = 600; // Playwright is slow; allow ample headroom.

export async function POST(req: Request) {
  let body: { force?: boolean; limit?: number } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* empty body is fine */
  }
  try {
    const result = await runEvidenceBatch({
      force: Boolean(body.force),
      limit: typeof body.limit === 'number' ? body.limit : null,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

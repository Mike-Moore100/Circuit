// POST /api/services/discover-contacts
// Thin HTTP wrapper around runContactDiscoveryBatch. Lets the dashboard
// (or any future scheduler) trigger contact discovery via fetch().
//
// Body: { force?: boolean; limit?: number }
// Returns: the ServiceResult JSON the CLI also receives.
import { NextResponse } from 'next/server';
import { runContactDiscoveryBatch } from '../../../../src/services/index';

// Discovery walks every eligible lead — can take a while. Tell Next not
// to pre-render this.
export const dynamic = 'force-dynamic';
// Allow a generous timeout for the Playwright fallback path.
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: { force?: boolean; limit?: number } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* empty body is fine */
  }
  try {
    const result = await runContactDiscoveryBatch({
      force: Boolean(body.force),
      limit: typeof body.limit === 'number' ? body.limit : null,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

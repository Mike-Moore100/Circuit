// Tiny endpoint the client-side Sidebar uses to render badge counts
// without each page server-component having to thread them through. Read-
// only, cheap, no-store.
import { NextResponse } from 'next/server';
import { getDb } from '../../../src/db/client';
import { getDiscoveryStats, getQualificationQueueStats } from '../../../src/db/repository';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const reviewQueue = (db
      .prepare(
        `SELECT COUNT(*) AS n FROM review_queue WHERE status NOT IN ('rejected','archived')`,
      )
      .get() as { n: number }).n;
    const discoveryToday = getDiscoveryStats(db).validToday;
    const qualPending = getQualificationQueueStats(db).byStatus.PENDING ?? 0;
    return NextResponse.json({
      reviewQueue,
      qualificationPending: qualPending,
      discoveryToday,
    });
  } catch (err) {
    return NextResponse.json({}, { status: 200 });
  }
}

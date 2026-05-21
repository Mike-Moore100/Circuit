import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { config } from '../../../../../src/config/index';

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  context: { params: Promise<{ companyId: string; device: string }> },
) {
  const { companyId, device } = await context.params;
  // Strict validation prevents path traversal.
  if (!UUID_RX.test(companyId)) {
    return NextResponse.json({ error: 'invalid companyId' }, { status: 400 });
  }
  if (device !== 'desktop' && device !== 'mobile') {
    return NextResponse.json({ error: 'invalid device' }, { status: 400 });
  }
  const filePath = path.join(config.evidence.screenshotDir, companyId, `${device}.png`);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const buffer = fs.readFileSync(filePath);
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=60',
    },
  });
}

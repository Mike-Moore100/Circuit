import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { updateReviewItemStatus } from '../../../src/db/repository';

const BodySchema = z.object({
  companyId: z.string().uuid(),
  action: z.enum(['accept', 'reject', 'contacted', 'requeue']),
  notes: z.string().max(2000).optional(),
});

const ACTION_TO_STATUS = {
  accept: 'investigating',
  reject: 'rejected',
  contacted: 'contacted',
  requeue: 'queued',
} as const;

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { companyId, action, notes } = parsed.data;
  const status = ACTION_TO_STATUS[action];
  const updated = updateReviewItemStatus(companyId, status, notes ?? null);
  if (!updated) {
    return NextResponse.json({ error: 'Review item not found' }, { status: 404 });
  }
  revalidatePath('/');
  return NextResponse.json({ ok: true, status, companyId });
}

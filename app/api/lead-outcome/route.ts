// Phase 1 Live Validation — record an outcome against a company. Pure
// tracking endpoint: it appends a row to lead_outcomes, nothing else.
// No outreach is triggered, no message is sent.

import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  deleteLeadOutcome,
  insertLeadOutcome,
} from '../../../src/db/repository';
import { OUTCOME_TYPES } from '../../../src/validation/outcomeTypes';

const BodySchema = z.object({
  companyId: z.string().uuid(),
  outcomeType: z.enum(OUTCOME_TYPES),
  notes: z.string().max(2000).optional(),
});

const DeleteSchema = z.object({
  id: z.string().uuid(),
});

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
  const row = insertLeadOutcome({
    companyId: parsed.data.companyId,
    outcomeType: parsed.data.outcomeType,
    notes: parsed.data.notes ?? null,
  });
  revalidatePath('/opportunities');
  revalidatePath('/validation');
  return NextResponse.json({ ok: true, outcomeId: row.id });
}

// DELETE — used by the timeline "undo" button so an operator can correct
// a fat-finger entry without leaving an audit trail of mistakes.
export async function DELETE(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = DeleteSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const removed = deleteLeadOutcome(parsed.data.id);
  revalidatePath('/opportunities');
  revalidatePath('/validation');
  return NextResponse.json({ ok: true, removed });
}

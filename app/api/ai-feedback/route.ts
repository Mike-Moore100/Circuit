import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { updateAiAnalysisFeedback } from '../../../src/db/repository';

const BodySchema = z.object({
  analysisId: z.string().uuid(),
  feedback: z.enum([
    'useful',
    'not_useful',
    'hallucination',
    'approved',
    'rejected',
    'pending',
  ]),
  notes: z.string().max(2000).optional(),
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
  const { analysisId, feedback, notes } = parsed.data;
  const ok = updateAiAnalysisFeedback(analysisId, feedback, notes ?? null);
  if (!ok) {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
  }
  revalidatePath('/');
  return NextResponse.json({ ok: true, analysisId, feedback });
}

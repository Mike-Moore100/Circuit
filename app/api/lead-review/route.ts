import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { deleteReviewTag, insertLeadReview } from '../../../src/db/repository';
import { REVIEW_TYPES } from '../../../src/validation/types';
import { CAMPAIGN_VALUES } from '../../../src/scoring/campaignTypes';

const BodySchema = z.object({
  companyId: z.string().uuid(),
  reviewType: z.enum(REVIEW_TYPES),
  previousCampaign: z.enum(CAMPAIGN_VALUES).optional(),
  correctedCampaign: z.enum(CAMPAIGN_VALUES).optional(),
  reviewerNotes: z.string().max(2000).optional(),
  // Operator tag toggle: when true, clear an existing tag of this type
  // for this company instead of inserting another row. Idempotent —
  // returning ok regardless of whether anything matched.
  remove: z.boolean().optional(),
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
  if (parsed.data.remove) {
    const removed = deleteReviewTag(parsed.data.companyId, parsed.data.reviewType);
    revalidatePath('/');
    revalidatePath('/opportunities');
    return NextResponse.json({ ok: true, removed });
  }
  const review = insertLeadReview({
    companyId: parsed.data.companyId,
    reviewType: parsed.data.reviewType,
    previousCampaign: parsed.data.previousCampaign ?? null,
    correctedCampaign: parsed.data.correctedCampaign ?? null,
    reviewerNotes: parsed.data.reviewerNotes ?? null,
  });
  revalidatePath('/');
  revalidatePath('/opportunities');
  return NextResponse.json({ ok: true, reviewId: review.id });
}

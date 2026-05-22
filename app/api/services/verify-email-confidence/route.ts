// POST /api/services/verify-email-confidence
//
// UI-triggered email verification. Two modes:
//   { contactId } → verify a single contact's email.
//   { companyId } → verify every email on the company (capped).
//
// Pure-deterministic + safe — runs syntax + DNS + risk scoring, no
// SMTP probing. Returns the structured EmailConfidenceResult so the
// caller can update the drawer without a refresh.

import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { config } from '../../../../src/config/index';
import {
  verifyContactEmail,
  verifyEmailsForCompany,
} from '../../../../src/email/emailVerificationService';

export const dynamic = 'force-dynamic';

const BodySchema = z
  .object({
    contactId: z.string().uuid().optional(),
    companyId: z.string().uuid().optional(),
  })
  .refine(
    (b) => b.contactId || b.companyId,
    'either contactId or companyId is required',
  );

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.contactId) {
      const result = await verifyContactEmail(parsed.data.contactId);
      if (!result) {
        return NextResponse.json(
          { ok: false, error: 'Contact not found or has no email' },
          { status: 404 },
        );
      }
      revalidatePath('/opportunities');
      return NextResponse.json({ ok: true, result });
    }
    // Batch by companyId
    const result = await verifyEmailsForCompany(parsed.data.companyId!, {
      max: config.email.maxPerBatch,
    });
    revalidatePath('/opportunities');
    return NextResponse.json({ ...result, ok: result.errors.length === 0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

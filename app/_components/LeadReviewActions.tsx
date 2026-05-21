'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  REVIEW_HINT,
  REVIEW_LABEL,
  REVIEW_TYPES,
  type ReviewType,
} from '../../src/validation/types';

interface Props {
  companyId: string;
  primaryCampaign: string;
  currentReview: string | null;
}

// Keep the six actions in the order the operator scans them, with the
// most-common positive vs negative outcomes grouped.
const ORDER: ReviewType[] = [
  'correct_campaign',
  'strong_opportunity',
  'weak_opportunity',
  'interesting_later',
  'false_reject',
  'false_positive',
];

// Tone map. Every button gets a coloured border by default so the row
// reads as one consistent control. Positive ratings use a success tint,
// negative ratings (the "wrongly..." pair) use a danger tint, neutrals
// stay grey. Selected state fills with the matching solid colour.
function toneClass(type: ReviewType, current: string | null): string {
  const selected = current === type;
  if (type === 'correct_campaign' || type === 'strong_opportunity') {
    return selected ? 'btn btn-success' : 'btn btn-success-outline';
  }
  if (type === 'false_reject' || type === 'false_positive') {
    return selected ? 'btn btn-danger-solid' : 'btn btn-danger';
  }
  return selected ? 'btn btn-primary' : 'btn';
}

export function LeadReviewActions({
  companyId,
  primaryCampaign,
  currentReview,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function send(reviewType: ReviewType) {
    setError(null);
    const res = await fetch('/api/lead-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId,
        reviewType,
        previousCampaign: primaryCampaign,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? `Request failed (${res.status})`);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="review-feedback">
      <div className="review-feedback-label">Was this routing right?</div>
      <div className="action-row">
        {ORDER.map((type) => (
          <button
            key={type}
            type="button"
            className={toneClass(type, currentReview)}
            onClick={() => send(type)}
            disabled={pending}
            title={REVIEW_HINT[type]}
          >
            {REVIEW_LABEL[type]}
          </button>
        ))}
      </div>
      {currentReview && (
        <div className="review-feedback-current">
          Last review: <strong>{REVIEW_LABEL[currentReview as ReviewType] ?? currentReview}</strong>
        </div>
      )}
      {error && <div className="action-error">{error}</div>}
    </div>
  );
}

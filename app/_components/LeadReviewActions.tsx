'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { REVIEW_LABEL, REVIEW_TYPES, type ReviewType } from '../../src/validation/types';

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

function toneClass(type: ReviewType, current: string | null): string {
  const base = current === type ? 'btn btn-primary' : 'btn';
  if (type === 'correct_campaign' || type === 'strong_opportunity') {
    return current === type ? 'btn btn-success' : 'btn';
  }
  if (type === 'false_reject' || type === 'false_positive') {
    return current === type ? 'btn btn-danger' : 'btn btn-ghost';
  }
  return base;
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
            title={REVIEW_LABEL[type]}
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

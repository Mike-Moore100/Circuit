'use client';

// The primary working unit on /validation. Each card answers two
// questions in 5 seconds:
//   1. Was this opportunity correctly ranked?
//   2. Why or why not?
//
// One-click action buttons dispatch a review tag (lead_reviews row).
// Deeper detail lives on /opportunities — click "Open lead" to jump.

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  REVIEW_HINT,
  REVIEW_LABEL,
  type CalibrationReviewType,
  type OperatorReviewType,
} from '../../src/validation/types';
import type { ValidationQueueItem } from '../_lib/validationData';

type ValidationAction =
  | CalibrationReviewType
  | Extract<
      OperatorReviewType,
      | 'wrong_campaign'
      | 'high_trust_barrier'
      | 'good_fit'
    >;

// Eight buttons exactly — the brief's list. Two rows for clean wrapping.
const ROW_A: ValidationAction[] = [
  'correct_campaign',
  'false_positive',
  'false_reject',
  'wrong_campaign',
];
const ROW_B: ValidationAction[] = [
  'strong_opportunity',
  'weak_opportunity',
  'high_trust_barrier',
  'good_fit',
];

const ACTION_LABEL: Record<ValidationAction, string> = {
  correct_campaign: 'Correct ranking',
  false_positive: 'False positive',
  false_reject: 'False reject',
  wrong_campaign: 'Wrong campaign',
  strong_opportunity: 'Strong opportunity',
  weak_opportunity: 'Weak opportunity',
  high_trust_barrier: 'High trust barrier',
  good_fit: 'Good fit',
  // Calibration types that aren't in the validation queue's button set
  // still need labels because the type union includes them — Map below
  // never reads these but the index signature must be exhaustive.
  interesting_later: REVIEW_LABEL.interesting_later,
};

const QUEUE_REASON_LABEL: Record<ValidationQueueItem['queueReason'], string> = {
  unreviewed_high: 'Unreviewed · high opp score',
  false_positive_candidate: 'High score · operator rejected',
  false_reject_candidate: 'Low score · operator approved',
  conflicting_tags: 'Conflicting tags',
};

const QUEUE_REASON_TONE: Record<ValidationQueueItem['queueReason'], string> = {
  unreviewed_high: 'idle',
  false_positive_candidate: 'warn',
  false_reject_candidate: 'warn',
  conflicting_tags: 'err',
};

interface Props {
  item: ValidationQueueItem;
}

export function ValidationQueueCard({ item }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<ValidationAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function tag(action: ValidationAction) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch('/api/lead-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: item.companyId,
          reviewType: action,
          previousCampaign: item.campaign ?? undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Request failed (${res.status})`);
      }
    } finally {
      setBusy(null);
    }
    startTransition(() => router.refresh());
  }

  return (
    <article className={`vq-card vq-card-${QUEUE_REASON_TONE[item.queueReason]}`}>
      <header className="vq-card-head">
        <div className="vq-card-title-block">
          <h3 className="vq-card-title">{item.company}</h3>
          <div className="vq-card-sub">
            {item.campaign && <span className="vq-card-campaign">{item.campaign.replace(/_/g, ' ')}</span>}
            {item.industry && (
              <>
                <span className="vq-sep">·</span>
                <span>{item.industry}</span>
              </>
            )}
          </div>
        </div>
        <div className="vq-card-meta">
          <span
            className={`vq-card-reason vq-card-reason-${QUEUE_REASON_TONE[item.queueReason]}`}
            title="Why this lead is in the validation queue"
          >
            {QUEUE_REASON_LABEL[item.queueReason]}
          </span>
          <span className="vq-card-score">
            {item.opportunityScore}
            <span className="vq-card-score-cap">/100</span>
          </span>
        </div>
      </header>

      <dl className="vq-card-grid">
        {item.strongestReason && (
          <Row label="Why it matters">{item.strongestReason}</Row>
        )}
        {item.bestEvidence && (
          <Row label="Strongest evidence">{item.bestEvidence}</Row>
        )}
        {item.whyNow && <Row label="Why now">{item.whyNow}</Row>}
        <Row label="Contactability">{item.contactability}</Row>
        {item.strongestRisk && (
          <Row label="Top risk" tone="neg">{item.strongestRisk}</Row>
        )}
      </dl>

      <footer className="vq-card-actions">
        <div className="vq-action-row">
          {ROW_A.map((a) => (
            <ActionButton
              key={a}
              action={a}
              busy={busy === a || pending}
              onClick={() => tag(a)}
            />
          ))}
        </div>
        <div className="vq-action-row">
          {ROW_B.map((a) => (
            <ActionButton
              key={a}
              action={a}
              busy={busy === a || pending}
              onClick={() => tag(a)}
            />
          ))}
          <Link
            href={`/opportunities?lead=${item.companyId}`}
            scroll={false}
            className="btn btn-sm vq-action-open"
          >
            Open lead →
          </Link>
        </div>
        {error && <p className="vq-card-error">{error}</p>}
        {item.appliedTags.length > 0 && (
          <p className="vq-card-applied">
            Previously tagged: {item.appliedTags.map((t) => REVIEW_LABEL[t as CalibrationReviewType] ?? t.replace(/_/g, ' ')).join(', ')}
          </p>
        )}
      </footer>
    </article>
  );
}

function Row({
  label,
  tone = 'neutral',
  children,
}: {
  label: string;
  tone?: 'neutral' | 'neg';
  children: React.ReactNode;
}) {
  return (
    <div className={`vq-row vq-row-${tone}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ActionButton({
  action,
  busy,
  onClick,
}: {
  action: ValidationAction;
  busy: boolean;
  onClick: () => void;
}) {
  const tone =
    action === 'false_positive' || action === 'false_reject' || action === 'wrong_campaign'
      ? 'err'
      : action === 'strong_opportunity' || action === 'good_fit'
      ? 'ok'
      : action === 'weak_opportunity' || action === 'high_trust_barrier'
      ? 'warn'
      : 'idle';
  return (
    <button
      type="button"
      className={`btn btn-sm vq-action vq-action-${tone}`}
      onClick={onClick}
      disabled={busy}
      title={REVIEW_HINT[action as CalibrationReviewType] ?? ACTION_LABEL[action]}
    >
      {ACTION_LABEL[action]}
    </button>
  );
}

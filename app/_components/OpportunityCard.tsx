'use client';

// OpportunityCard — Layer 1 surface in the list view. Wraps the
// reusable DecisionSummary + a compact action row. Everything else
// (sub-score numbers, why-now chips, commercial-weakness chips,
// secondary operator tags) moved into the drawer's ProofPanel /
// RawDebugPanel — accessible, not deleted.

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ReviewQueueRow } from '../../src/types';
import type {
  IntelligenceRowSummary,
  RegistryEnrichmentPanel,
} from '../_lib/dashboardData';
import {
  OPERATOR_REVIEW_TYPES,
  REVIEW_HINT,
  REVIEW_LABEL,
  type OperatorReviewType,
} from '../../src/validation/types';
import { DecisionSummary } from './DecisionSummary';
import {
  pickBestContact,
  pickStrongestEvidence,
  pickStrongestReason,
  pickTopRisk,
  recommendNextAction,
} from './decisionSummaryLogic';

interface Props {
  row: ReviewQueueRow;
  intel: IntelligenceRowSummary | undefined;
  registry: RegistryEnrichmentPanel | null;
  isSelected: boolean;
  detailHref: string;
  operatorTags: Set<string>;
  hasContact: boolean;
  hasPhone: boolean;
  index: number;
}

// Layer 1 surface only shows the three highest-priority commercial
// validation actions. The full set lives in the drawer.
const VALIDATION_ACTIONS: OperatorReviewType[] = [
  'would_contact',
  'would_not_contact',
  'strong_pain',
];

// Sanity warning if anyone adds a new operator tag and forgets the drawer.
const _allOperatorActionsCovered = (() => {
  const covered = new Set<string>([
    ...VALIDATION_ACTIONS,
    'likely_high_value',
    'likely_fast_close',
    'revisit_later',
    'ignore',
    'high_commercial_potential',
    'low_commercial_potential',
    'weak_pain',
    'wrong_campaign',
    'high_trust_barrier',
    'needs_manual_investigation',
  ]);
  for (const t of OPERATOR_REVIEW_TYPES) {
    if (!covered.has(t)) {
      // eslint-disable-next-line no-console
      console.warn(`OpportunityCard: operator tag '${t}' is unmapped.`);
    }
  }
})();

export function OpportunityCard({
  row,
  intel,
  registry,
  isSelected,
  detailHref,
  operatorTags,
  hasContact,
  hasPhone,
  index,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyAction, setBusyAction] = useState<OperatorReviewType | null>(null);

  async function toggleTag(type: OperatorReviewType) {
    setBusyAction(type);
    const remove = operatorTags.has(type);
    try {
      await fetch('/api/lead-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: row.companyId,
          reviewType: type,
          remove,
        }),
      });
    } finally {
      setBusyAction(null);
    }
    startTransition(() => router.refresh());
  }

  // Pre-compute the Layer 1 derivation. These functions are pure and
  // tested separately in tests/decisionSummary.test.ts.
  const bestContact = pickBestContact(
    { contacts: [], routes: [] }, // card only has the rollup
    intel?.likelyBuyer ?? null,
    hasPhone,
  );
  // Override the rollup-based contact line with the simpler
  // contactability summary because the card doesn't have the full
  // contact list — that lives in the drawer.
  const contactLine = hasContact
    ? hasPhone
      ? 'email + phone available'
      : 'email available'
    : hasPhone
    ? 'phone only'
    : 'no direct contact path';
  const contactSummary = {
    line: contactLine,
    tone: bestContact.tone,
  };

  const strongestReason = pickStrongestReason(intel);
  const strongestEvidence = pickStrongestEvidence(intel, null);
  const topRisk = pickTopRisk(intel);
  const recommendedAction = recommendNextAction(
    row,
    intel,
    contactSummary,
    registry,
  );

  return (
    <article
      className={`opp-card${isSelected ? ' opp-card-selected' : ''}`}
      data-card-id={row.companyId}
      data-card-index={index}
      aria-selected={isSelected}
    >
      {/* Whole-card click target. Lives behind everything else so the
         operator can click anywhere on the card to open the drawer.
         Interactive descendants (validation buttons, "Open" button,
         the host link inside the title sub-line, applied operator tags)
         all carry `position: relative` in CSS so they sit above this
         overlay and remain individually clickable. */}
      <Link
        href={detailHref}
        scroll={false}
        className="opp-card-link-overlay"
        aria-label={`Open ${row.company}`}
        tabIndex={-1}
      />
      <DecisionSummary
        lead={row}
        intel={intel}
        registry={registry}
        bestContact={contactSummary}
        recommendedAction={recommendedAction}
        strongestReason={strongestReason}
        strongestEvidence={strongestEvidence}
        topRisk={topRisk}
        mode="card"
      />

      {/* Validation row. "Open" button removed — the whole card is now
         a click target, so a separate Open is redundant. The three
         validation buttons stay (they POST to /api/lead-review, they
         aren't navigation). Each button calls stopPropagation so a
         click on it doesn't accidentally open the drawer. */}
      <div className="opp-card-validation-row" aria-label="Commercial validation">
        <span className="opp-card-section-label">Validate</span>
        {VALIDATION_ACTIONS.map((t) => {
          const active = operatorTags.has(t);
          return (
            <button
              key={t}
              type="button"
              className={`btn btn-sm opp-validation-btn${active ? ' opp-validation-active' : ''} opp-validation-${t}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleTag(t);
              }}
              disabled={pending || busyAction === t}
              title={REVIEW_HINT[t]}
              data-quick-action={t}
            >
              {REVIEW_LABEL[t]}
            </button>
          );
        })}
      </div>

      {/* Applied operator tags — visible Layer 1 because they're
         already part of the operator's decision context. Empty when
         nothing is tagged. */}
      {operatorTags.size > 0 && (
        <div className="opp-card-tags">
          {[...operatorTags].map((t) => (
            <span key={t} className={`opp-tag opp-tag-${t}`}>
              {REVIEW_LABEL[t as OperatorReviewType] ?? t.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

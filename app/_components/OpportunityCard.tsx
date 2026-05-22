'use client';

// Compact opportunity card. The default render is intentionally light so an
// operator can scan it in 5–10 seconds:
//   header: company · campaign · attention pill · opportunity score
//   bar:    opportunity score
//   chips:  why-now signals (top 3, deterministic)
//   row:    top reason · top risk · contactability · trust barrier
//   ops:    quick action row (Strong / Ignore / Revisit / More)
//
// Everything else (sub-scores, screenshots, contacts, raw signals) lives
// behind a "More" toggle that opens the side drawer. We deliberately do
// NOT inline screenshots into the card — that's the noisy debug surface
// we're trying to replace.

import Link from 'next/link';
import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ReviewQueueRow } from '../../src/types';
import type { IntelligenceRowSummary } from '../_lib/dashboardData';
import { Avatar } from './Avatar';
import { CAMPAIGN_LABEL, type Campaign } from '../../src/scoring/campaignTypes';
import {
  OPERATOR_REVIEW_TYPES,
  REVIEW_HINT,
  REVIEW_LABEL,
  type OperatorReviewType,
} from '../../src/validation/types';
import { contactabilityLabel } from './opportunityCardLogic';
import { RegistryBadge } from './RegistryBadge';

interface Props {
  row: ReviewQueueRow;
  intel: IntelligenceRowSummary | undefined;
  isSelected: boolean;
  detailHref: string;
  operatorTags: Set<string>;
  hasContact: boolean;
  hasPhone: boolean;
  index: number;
}

function domain(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Phase 1 Live Validation — the commercial validation row sits above the
// throughput row because "would I contact this?" is the fastest, most
// useful operator judgement and feeds the calibration loop directly.
const VALIDATION_ACTIONS: OperatorReviewType[] = [
  'would_contact',
  'would_not_contact',
  'strong_pain',
];

// Throughput row — same four shipped in v1. These survive because they
// answer "now what?" once an operator has decided would_contact.
const PRIMARY_QUICK_ACTIONS: OperatorReviewType[] = [
  'likely_high_value',
  'likely_fast_close',
  'revisit_later',
  'ignore',
];

// Everything else lives behind "More" so the default card stays scannable.
const SECONDARY_QUICK_ACTIONS: OperatorReviewType[] = [
  'high_commercial_potential',
  'low_commercial_potential',
  'weak_pain',
  'wrong_campaign',
  'high_trust_barrier',
  'needs_manual_investigation',
];

// Sanity check we didn't drift the action arrays apart from
// OPERATOR_REVIEW_TYPES. Caught at module load — cheaper than a test
// for catching a typo.
const _allOperatorActionsCovered = (() => {
  const covered = new Set<string>([
    ...VALIDATION_ACTIONS,
    ...PRIMARY_QUICK_ACTIONS,
    ...SECONDARY_QUICK_ACTIONS,
  ]);
  for (const t of OPERATOR_REVIEW_TYPES) {
    if (!covered.has(t)) {
      // eslint-disable-next-line no-console
      console.warn(`OpportunityCard: operator tag '${t}' is not surfaced anywhere.`);
    }
  }
})();

export function OpportunityCard({
  row,
  intel,
  isSelected,
  detailHref,
  operatorTags,
  hasContact,
  hasPhone,
  index,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showSecondary, setShowSecondary] = useState(false);
  const [busyAction, setBusyAction] = useState<OperatorReviewType | null>(null);
  const host = domain(row.website);
  const campaign = row.primaryCampaign as Campaign;

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

  // Contactability is a one-line summary on the card — full contact list
  // is in the drawer. We bias toward "what's the easiest path?" rather
  // than a per-channel breakdown.
  const contactability = contactabilityLabel(hasContact, hasPhone);

  const attentionPriority = intel?.humanAttentionPriority ?? 'IGNORE';
  const opportunityScore = intel?.opportunityScore ?? null;
  const projectTypeLabel = intel
    ? intel.likelyProjectType.replace(/_/g, ' ').toLowerCase()
    : null;
  const trustBarrier = intel?.trustBarrier ?? 0;
  const accessibility = intel?.accessibility ?? 0;
  const operationalPain = intel?.operationalPain ?? 0;
  const buyingReadiness = intel?.buyingReadiness ?? 0;

  return (
    <article
      className={`opp-card${isSelected ? ' opp-card-selected' : ''}`}
      data-card-id={row.companyId}
      data-card-index={index}
      aria-selected={isSelected}
    >
      <header className="opp-card-head">
        <Link href={detailHref} scroll={false} className="opp-card-title-link">
          <Avatar name={row.company} size={28} />
          <div className="opp-card-title-block">
            <div className="opp-card-title-row">
              <span className="opp-card-title">{row.company}</span>
              <span className={`attention-pill attention-${attentionPriority}`}>
                {attentionPriority}
              </span>
              {opportunityScore !== null && (
                <span className="opp-card-opp-score" title="Opportunity score">
                  {opportunityScore}
                  <span className="opp-card-opp-cap">/100</span>
                </span>
              )}
              <RegistryBadge registry={intel?.registry} />
            </div>
            <div className="opp-card-sub">
              <span className={`campaign-dot campaign-${campaign}`} />
              <span className="opp-card-campaign-label">
                {CAMPAIGN_LABEL[campaign]}
              </span>
              {projectTypeLabel && (
                <>
                  <span className="opp-card-sub-sep">·</span>
                  <span>{projectTypeLabel}</span>
                </>
              )}
              {host && (
                <>
                  <span className="opp-card-sub-sep">·</span>
                  <span className="opp-card-host">{host}</span>
                </>
              )}
              {row.industry && (
                <>
                  <span className="opp-card-sub-sep">·</span>
                  <span
                    className="opp-card-industry"
                    title={
                      row.discoveryQuery
                        ? `queried as "${row.discoveryQuery}"${
                            row.industrySource
                              ? ` · inferred from ${row.industrySource}`
                              : ''
                          }`
                        : undefined
                    }
                  >
                    {row.industry}
                  </span>
                </>
              )}
              {(row.location || row.discoveryLocation) && (
                <>
                  <span className="opp-card-sub-sep">·</span>
                  <span>{row.location ?? row.discoveryLocation}</span>
                </>
              )}
            </div>
          </div>
        </Link>
        <div className="opp-card-score-block">
          <div className={`score-bar ${row.priority}`}>
            <span
              className="fill"
              style={{ width: `${Math.max(0, Math.min(100, row.finalScore))}%` }}
            />
          </div>
          <span className="opp-card-final-score">{row.finalScore}</span>
        </div>
      </header>

      {/* ---- Why-now strip (deterministic urgency reasons) ---------- */}
      {intel && intel.whyNow.length > 0 && (
        <div className="opp-card-whynow" aria-label="Why now">
          <span className="opp-card-section-label">Why now</span>
          <div className="opp-card-whynow-chips">
            {intel.whyNow.map((s) => (
              <span
                key={s.kind}
                className={`whynow-chip whynow-${s.kind}`}
                title={s.detail}
              >
                {s.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ---- Commercial weakness strip (positioning gaps) ----------- */}
      {intel && intel.commercialWeaknesses.length > 0 && (
        <div className="opp-card-weakness" aria-label="Commercial weaknesses">
          <span className="opp-card-section-label">Commercial gap</span>
          <div className="opp-card-whynow-chips">
            {intel.commercialWeaknesses.map((w) => (
              <span
                key={w.kind}
                className={`weakness-chip weakness-${w.kind}`}
                title={w.detail}
              >
                {w.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ---- Commercial reasoning strip (text-heavy) -------------- */}
      <div className="opp-card-reasoning">
        {intel?.topOpportunityReason && (
          <div className="opp-card-stat">
            <span className="opp-card-stat-label">Strongest reason</span>
            <span className="opp-card-stat-value">{intel.topOpportunityReason}</span>
          </div>
        )}
        {intel?.strongestPainSignal && (
          <div className="opp-card-stat opp-card-stat-pain">
            <span className="opp-card-stat-label">Strongest pain</span>
            <span className="opp-card-stat-value">{intel.strongestPainSignal}</span>
          </div>
        )}
        {intel?.strongestEvidence && (
          <div className="opp-card-stat">
            <span className="opp-card-stat-label">Strongest evidence</span>
            <span className="opp-card-stat-value">{intel.strongestEvidence}</span>
          </div>
        )}
        {intel?.likelyBuyer && (
          <div className="opp-card-stat">
            <span className="opp-card-stat-label">Likely buyer</span>
            <span className="opp-card-stat-value">{intel.likelyBuyer}</span>
          </div>
        )}
        {intel?.topRiskFactor && (
          <div className="opp-card-stat opp-card-stat-risk">
            <span className="opp-card-stat-label">Top risk</span>
            <span className="opp-card-stat-value">{intel.topRiskFactor}</span>
          </div>
        )}
      </div>

      {/* ---- Sub-score strip (numeric, compact) ------------------- */}
      {intel && (
        <div className="opp-card-stats">
          <div className="opp-card-stat">
            <span className="opp-card-stat-label">Contact</span>
            <span className="opp-card-stat-value">{contactability}</span>
          </div>
          <div className="opp-card-stat" title="Operational pain (higher = more friction visible)">
            <span className="opp-card-stat-label">Pain</span>
            <span className="opp-card-stat-value-num">{operationalPain}</span>
          </div>
          <div className="opp-card-stat" title="Buying readiness">
            <span className="opp-card-stat-label">Readiness</span>
            <span className="opp-card-stat-value-num">{buyingReadiness}</span>
          </div>
          <div className="opp-card-stat" title="Accessibility (how easy to reach a decision-maker)">
            <span className="opp-card-stat-label">Access</span>
            <span className="opp-card-stat-value-num">{accessibility}</span>
          </div>
          <div
            className={`opp-card-stat${trustBarrier >= 50 ? ' opp-card-stat-risk' : ''}`}
            title="Trust barrier (higher = harder to win trust)"
          >
            <span className="opp-card-stat-label">Trust barrier</span>
            <span className="opp-card-stat-value-num">{trustBarrier}</span>
          </div>
        </div>
      )}

      {/* ---- Operator tags currently applied ----------------------- */}
      {operatorTags.size > 0 && (
        <div className="opp-card-tags">
          {[...operatorTags].map((t) => (
            <span key={t} className={`opp-tag opp-tag-${t}`}>
              {REVIEW_LABEL[t as OperatorReviewType] ?? t.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}

      {/* ---- Commercial validation row (always visible) ----------- */}
      <div className="opp-card-validation-row" aria-label="Commercial validation">
        <span className="opp-card-section-label">Validate</span>
        {VALIDATION_ACTIONS.map((t) => {
          const active = operatorTags.has(t);
          return (
            <button
              key={t}
              type="button"
              className={`btn btn-sm opp-validation-btn${active ? ' opp-validation-active' : ''} opp-validation-${t}`}
              onClick={() => toggleTag(t)}
              disabled={pending || busyAction === t}
              title={REVIEW_HINT[t]}
              data-quick-action={t}
            >
              {REVIEW_LABEL[t]}
            </button>
          );
        })}
      </div>

      {/* ---- Quick actions ---------------------------------------- */}
      <footer className="opp-card-actions">
        {PRIMARY_QUICK_ACTIONS.map((t) => {
          const active = operatorTags.has(t);
          return (
            <button
              key={t}
              type="button"
              className={`btn btn-sm opp-quick-btn${active ? ' opp-quick-active' : ''} opp-quick-${t}`}
              onClick={() => toggleTag(t)}
              disabled={pending || busyAction === t}
              title={REVIEW_HINT[t]}
              data-quick-action={t}
            >
              {REVIEW_LABEL[t]}
            </button>
          );
        })}
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => setShowSecondary((s) => !s)}
          aria-expanded={showSecondary}
        >
          {showSecondary ? 'Less' : 'More'}
        </button>
        <Link
          href={detailHref}
          scroll={false}
          className="btn btn-sm btn-primary opp-card-open"
          data-quick-action="open"
        >
          Open
        </Link>
      </footer>

      {showSecondary && (
        <div className="opp-card-secondary-row">
          {SECONDARY_QUICK_ACTIONS.map((t) => {
            const active = operatorTags.has(t);
            return (
              <button
                key={t}
                type="button"
                className={`btn btn-sm opp-quick-btn${active ? ' opp-quick-active' : ''}`}
                onClick={() => toggleTag(t)}
                disabled={pending || busyAction === t}
                title={REVIEW_HINT[t]}
                data-quick-action={t}
              >
                {REVIEW_LABEL[t]}
              </button>
            );
          })}
        </div>
      )}
    </article>
  );
}

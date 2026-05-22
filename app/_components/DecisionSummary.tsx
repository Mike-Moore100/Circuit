// DecisionSummary — Layer 1. Always visible. Answers "should I care
// about this lead?" in five seconds. Drives both the opportunity card
// (compact mode) and the lead drawer header (full mode).
//
// IMPORTANT: this component never hides data — it surfaces the
// *single strongest* item from each Layer 1 field. Multiples (extra
// why-now chips, full contacts, all scoring reasons) live in the
// ProofPanel and RawDebugPanel.

import { Avatar } from './Avatar';
import { RegistryBadge } from './RegistryBadge';
import { CAMPAIGN_LABEL, type Campaign } from '../../src/scoring/campaignTypes';
import type { ReviewQueueRow } from '../../src/types';
import type {
  IntelligenceRowSummary,
  RegistryEnrichmentPanel,
} from '../_lib/dashboardData';
import type { BestContactSummary, RecommendedAction } from './decisionSummaryLogic';

function domain(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

interface Props {
  lead: ReviewQueueRow;
  intel: IntelligenceRowSummary | undefined;
  registry: RegistryEnrichmentPanel | null;
  bestContact: BestContactSummary;
  recommendedAction: RecommendedAction;
  strongestReason: string | null;
  strongestEvidence: string | null;
  topRisk: string | null;
  // 'card'   → compact, no recommended-action chip
  // 'drawer' → full, with the recommended-action chip up front
  mode: 'card' | 'drawer';
}

export function DecisionSummary({
  lead,
  intel,
  registry,
  bestContact,
  recommendedAction,
  strongestReason,
  strongestEvidence,
  topRisk,
  mode,
}: Props) {
  const campaign = lead.primaryCampaign as Campaign;
  const host = domain(lead.website);
  const opp = intel?.opportunityScore ?? null;
  const attention = intel?.humanAttentionPriority ?? 'IGNORE';

  return (
    <div className={`decision-summary decision-summary-${mode}`}>
      <header className="decision-head">
        <Avatar name={lead.company} size={mode === 'drawer' ? 36 : 28} />
        <div className="decision-head-main">
          <div className="decision-title-row">
            <h3 className="decision-title">{lead.company}</h3>
            <span className={`campaign-tag campaign-${campaign}`}>
              {CAMPAIGN_LABEL[campaign]}
            </span>
            {opp !== null && (
              <span className="decision-opp-score" title="Opportunity score">
                {opp}<span className="decision-opp-cap">/100</span>
              </span>
            )}
            <span className={`attention-pill attention-${attention}`}>
              {attention}
            </span>
            <RegistryBadge registry={intel?.registry} />
          </div>
          <div className="decision-sub">
            {lead.industry && <span>{lead.industry}</span>}
            {(lead.location || lead.discoveryLocation) && (
              <>
                <span className="decision-sep">·</span>
                <span>{lead.location ?? lead.discoveryLocation}</span>
              </>
            )}
            {intel?.likelyBuyer && (
              <>
                <span className="decision-sep">·</span>
                <span>{intel.likelyBuyer}</span>
              </>
            )}
            {host && (
              <>
                <span className="decision-sep">·</span>
                <a
                  href={lead.website ?? `https://${host}`}
                  target="_blank"
                  rel="noreferrer"
                  className="decision-host"
                >
                  {host}
                </a>
              </>
            )}
          </div>

          {mode === 'drawer' && (
            <div className={`recommended-action recommended-${recommendedAction.tone}`}>
              <div className="recommended-action-head">
                <span className="recommended-action-label">Recommended</span>
                <strong>{recommendedAction.label}</strong>
              </div>
              <p className="recommended-action-reasoning">
                {recommendedAction.reasoning}
              </p>
            </div>
          )}

          {/* Decision rows live INSIDE the head-main block so they
             auto-indent to align with the title (i.e. they sit past
             the avatar). Putting them at the .decision-summary top
             level put the labels at the card's left edge and the
             title at avatar+12px — visually broken. */}
          <ul className="decision-rows">
        {strongestReason && (
          <DecisionRow label="Why it matters" tone="pos">
            {strongestReason}
          </DecisionRow>
        )}
        {strongestEvidence && (
          <DecisionRow label="Strongest evidence" tone="info">
            {strongestEvidence}
          </DecisionRow>
        )}
        <DecisionRow label="Best contact route" tone={bestContact.tone}>
          {bestContact.line}
        </DecisionRow>
        {topRisk && (
          <DecisionRow label="Top risk" tone="neg">
            {topRisk}
          </DecisionRow>
        )}
        {registry && registry.outcome === 'enriched' && registry.signals && (
          <DecisionRow
            label="Registry"
            tone={
              registry.record?.status === 'active'
                ? 'pos'
                : registry.record?.status === 'dissolved'
                ? 'neg'
                : 'info'
            }
          >
            {registrySummaryLine(registry)}
          </DecisionRow>
        )}
          </ul>
        </div>
      </header>
    </div>
  );
}

function DecisionRow({
  label,
  tone,
  children,
}: {
  label: string;
  tone: 'pos' | 'neg' | 'info' | 'warn' | 'muted' | 'ok';
  children: React.ReactNode;
}) {
  return (
    <li className={`decision-row decision-row-${tone}`}>
      <span className="decision-row-label">{label}</span>
      <span className="decision-row-value">{children}</span>
    </li>
  );
}

function registrySummaryLine(reg: RegistryEnrichmentPanel): string {
  const record = reg.record!;
  const signals = reg.signals!;
  const parts: string[] = [record.status];
  if (signals.companyAgeYears !== null) {
    parts.push(`${signals.companyAgeYears}y old`);
  }
  if (record.registryId) parts.push(record.registryId);
  if (signals.directorsFound > 0) {
    parts.push(`${signals.directorsFound} active director${signals.directorsFound === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

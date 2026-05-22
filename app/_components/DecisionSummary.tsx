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

  // Linear / Stripe / Notion-style card: ONE strong element (the
  // company name + opp score on a single row), supporting context
  // beneath at a consistent left edge, then aligned label / value
  // rows. No avatar on cards — it pushed every following element
  // 40px right and forced two competing left margins.
  return (
    <div className={`decision-summary decision-summary-${mode}`}>
      <div className="decision-headline">
        <div className="decision-headline-left">
          {mode === 'drawer' && <Avatar name={lead.company} size={36} />}
          <div className="decision-headline-text">
            <h3 className="decision-title">{lead.company}</h3>
            <div className="decision-sub">
              {lead.industry && <span>{lead.industry}</span>}
              {(lead.location || lead.discoveryLocation) && (
                <>
                  <span className="decision-sep">·</span>
                  <span>{lead.location ?? lead.discoveryLocation}</span>
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
          </div>
        </div>
        {opp !== null && (
          <div className="decision-headline-score">
            <span className="decision-opp-score-big">{opp}</span>
            <span className="decision-opp-score-cap">/100</span>
          </div>
        )}
      </div>

      <div className="decision-pills">
        <span className={`campaign-tag campaign-${campaign}`}>
          {CAMPAIGN_LABEL[campaign]}
        </span>
        <span className={`attention-pill attention-${attention}`}>
          {attention}
        </span>
        <RegistryBadge registry={intel?.registry} />
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

      <dl className="decision-rows">
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
        <DecisionRow label="Best contact" tone={bestContact.tone}>
          {bestContact.line}
          {intel?.likelyBuyer && (
            <span className="decision-row-aside"> · {intel.likelyBuyer}</span>
          )}
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
      </dl>
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
    <div className={`decision-row decision-row-${tone}`}>
      <dt className="decision-row-label">{label}</dt>
      <dd className="decision-row-value">{children}</dd>
    </div>
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

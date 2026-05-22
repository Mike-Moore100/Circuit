// ProofPanel — Layer 2. Composes the summary cards + scoring panel
// into a single "why does Circuit think this?" section. Each child
// card carries its own collapsible disclosure; this wrapper just
// orders them and adds a section header.

import { ContactSummaryCard } from './ContactSummaryCard';
import { EvidenceSummaryCard } from './EvidenceSummaryCard';
import { RegistrySummaryCard } from './RegistrySummaryCard';
import { ScoreExplanationPanel } from './ScoreExplanationPanel';
import type { ReviewQueueRow } from '../../src/types';
import type {
  AiAnalysisPanel,
  IntelligenceRowSummary,
  LeadContactBundle,
  LeadEvidenceSummary,
  RegistryEnrichmentPanel,
} from '../_lib/dashboardData';
import type { OpportunityIntelligence } from '../../src/intelligence/intelligenceTypes';

interface Props {
  lead: ReviewQueueRow;
  intel: IntelligenceRowSummary | undefined;
  intelligence: OpportunityIntelligence | null;
  contacts: LeadContactBundle;
  evidence: LeadEvidenceSummary | null;
  registry: RegistryEnrichmentPanel | null;
  ai: AiAnalysisPanel | undefined;
}

export function ProofPanel({
  lead,
  intel,
  intelligence,
  contacts,
  evidence,
  registry,
  ai,
}: Props) {
  return (
    <section className="proof-panel">
      <header className="proof-panel-head">
        <h3 className="drawer-label">Proof</h3>
        <span className="proof-panel-hint">
          Why Circuit thinks this lead matters — one click per section.
        </span>
      </header>

      <div className="proof-panel-grid">
        <RegistrySummaryCard companyId={lead.companyId} enrichment={registry} />
        <ContactSummaryCard
          contacts={contacts}
          likelyBuyer={intel?.likelyBuyer ?? null}
        />
        <EvidenceSummaryCard companyId={lead.companyId} evidence={evidence} />
      </div>

      <ScoreExplanationPanel lead={lead} intelligence={intelligence} />

      {intel && (intel.whyNow.length > 0 || intel.commercialWeaknesses.length > 0) && (
        <details className="drawer-collapsible">
          <summary className="drawer-collapsible-summary">
            Urgency + commercial gap signals
          </summary>
          <div className="summary-card-detail">
            {intel.whyNow.length > 0 && (
              <>
                <h5 className="drawer-sublabel">Why now</h5>
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
              </>
            )}
            {intel.commercialWeaknesses.length > 0 && (
              <>
                <h5 className="drawer-sublabel">Commercial gaps</h5>
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
              </>
            )}
          </div>
        </details>
      )}

      {ai && (
        <details className="drawer-collapsible">
          <summary className="drawer-collapsible-summary">
            AI analysis · confidence {ai.confidence}
          </summary>
          <div className="summary-card-detail">
            <p className="note">{ai.summary}</p>
            {ai.operationalPainPoints.length > 0 && (
              <>
                <h5 className="drawer-sublabel">Operational pain points</h5>
                <ul className="bullet-list">
                  {ai.operationalPainPoints.map((p) => (
                    <li key={p.title}>
                      <strong>{p.title}</strong> — {p.description}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {ai.automationOpportunities.length > 0 && (
              <>
                <h5 className="drawer-sublabel">Automation opportunities</h5>
                <ul className="bullet-list">
                  {ai.automationOpportunities.map((o) => (
                    <li key={o.title}>
                      <strong>{o.title}</strong> — {o.description}{' '}
                      <span className="muted">({o.implementationComplexity})</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </details>
      )}
    </section>
  );
}

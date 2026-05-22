import Link from 'next/link';
import { CAMPAIGN_LABEL, type Campaign } from '../../src/scoring/campaignTypes';
import type { ReviewQueueRow } from '../../src/types';
import type {
  AiAnalysisPanel,
  IntelligenceRowSummary,
  LeadContactBundle,
  LeadEvidenceSummary,
  LeadVerifiedSignal,
  RegistryEnrichmentPanel,
} from '../_lib/dashboardData';
import type { OpportunityIntelligence } from '../../src/intelligence/intelligenceTypes';
import { ReviewActions } from './ReviewActions';
import { LeadReviewActions } from './LeadReviewActions';
import { OutcomeTracker, type OutcomeRow } from './OutcomeTracker';
import { DecisionSummary } from './DecisionSummary';
import { ProofPanel } from './ProofPanel';
import { RawDebugPanel } from './RawDebugPanel';
import {
  pickBestContact,
  pickStrongestEvidence,
  pickStrongestReason,
  pickTopRisk,
  recommendNextAction,
} from './decisionSummaryLogic';

interface CalibrationEvent {
  kind: 'review' | 'outcome';
  type: string;
  createdAt: string;
}

interface Props {
  lead: ReviewQueueRow;
  signals: LeadVerifiedSignal[];
  ai: AiAnalysisPanel | undefined;
  currentReview: string | null;
  contacts: LeadContactBundle;
  evidence: LeadEvidenceSummary | null;
  intelligence: OpportunityIntelligence | null;
  intel: IntelligenceRowSummary | undefined;
  outcomes: OutcomeRow[];
  registryEnrichment: RegistryEnrichmentPanel | null;
  calibrationHistory: CalibrationEvent[];
  hasPhone: boolean;
}

// Lead drawer — strict 3-layer information hierarchy.
//
//   Layer 1 (always visible): DecisionSummary + recommended action.
//     Answers "should I care about this lead?" in 5 seconds.
//
//   Layer 2 (one click, open by default): ProofPanel.
//     Answers "why does Circuit think this?" — composes Registry,
//     Contact, Evidence summary cards + ScoreExplanationPanel +
//     Urgency/Commercial gap signals + AI analysis.
//
//   Layer 3 (collapsed by default): RawDebugPanel.
//     Answers "what data produced this?" — verified signals, raw
//     registry JSON, source / discovery metadata, calibration history.
//
// Outcome tracking + calibration review actions stay as primary
// functional surfaces beneath the layers — they're the operator's
// write-side, not informational hierarchy.

export function LeadDrawer({
  lead,
  signals,
  ai,
  currentReview,
  contacts,
  evidence,
  intelligence,
  intel,
  outcomes,
  registryEnrichment,
  calibrationHistory,
  hasPhone,
}: Props) {
  const campaign = lead.primaryCampaign as Campaign;
  const bestContact = pickBestContact(contacts, intel?.likelyBuyer ?? null, hasPhone);
  const strongestReason = pickStrongestReason(intel);
  const strongestEvidence = pickStrongestEvidence(intel, evidence);
  const topRisk = pickTopRisk(intel);
  const recommendedAction = recommendNextAction(
    lead,
    intel,
    bestContact,
    registryEnrichment,
  );

  return (
    <aside className="drawer" aria-label={`Lead detail — ${lead.company}`}>
      <header className="drawer-head">
        <div className="drawer-head-row">
          <span className={`campaign-tag campaign-${campaign}`}>
            {CAMPAIGN_LABEL[campaign]}
          </span>
          <Link href="?" scroll={false} className="drawer-close" aria-label="Close">
            ×
          </Link>
        </div>
      </header>

      <div className="drawer-body">
        {/* ---- Layer 1 — decision summary ------------------------ */}
        <section className="drawer-section drawer-layer-1">
          <DecisionSummary
            lead={lead}
            intel={intel}
            registry={registryEnrichment}
            bestContact={bestContact}
            recommendedAction={recommendedAction}
            strongestReason={strongestReason}
            strongestEvidence={strongestEvidence}
            topRisk={topRisk}
            mode="drawer"
          />
        </section>

        {/* ---- Layer 2 — proof ------------------------------------ */}
        <section className="drawer-section drawer-layer-2">
          <ProofPanel
            lead={lead}
            intel={intel}
            intelligence={intelligence}
            contacts={contacts}
            evidence={evidence}
            registry={registryEnrichment}
            ai={ai}
          />
        </section>

        {/* ---- Layer 3 — raw + debug ------------------------------ */}
        <section className="drawer-section drawer-layer-3">
          <RawDebugPanel
            lead={lead}
            signals={signals}
            registry={registryEnrichment}
            calibrationHistory={calibrationHistory}
          />
        </section>

        {/* ---- Functional surfaces — operator write-side. Not part
              of the information hierarchy; these are actions. ----- */}
        <section className="drawer-section">
          <h3 className="drawer-label">Outcome tracking</h3>
          <p className="drawer-section-hint">
            Record what actually happened. This is a tracking log only —
            nothing is sent.
          </p>
          <OutcomeTracker companyId={lead.companyId} outcomes={outcomes} />
        </section>

        <section className="drawer-section">
          <LeadReviewActions
            companyId={lead.companyId}
            primaryCampaign={lead.primaryCampaign}
            currentReview={currentReview}
          />
        </section>
      </div>

      <footer className="drawer-foot">
        <ReviewActions companyId={lead.companyId} status={lead.status} />
      </footer>
    </aside>
  );
}

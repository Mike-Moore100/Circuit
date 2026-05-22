// ScoreExplanationPanel — Layer 2. Renders the full scoring story:
// rule + intent + final, per-campaign breakdown, intelligence sub-
// scores, and the operator-readable reasons. Default collapsed —
// the Layer 1 DecisionSummary already exposes the headline number.

import { CAMPAIGN_LABEL, CAMPAIGN_VALUES, type Campaign } from '../../src/scoring/campaignTypes';
import type { ReviewQueueRow, ScoreReason } from '../../src/types';
import type { OpportunityIntelligence } from '../../src/intelligence/intelligenceTypes';

interface Props {
  lead: ReviewQueueRow;
  intelligence: OpportunityIntelligence | null;
  // Default closed; open when the operator clicks. The card / drawer
  // can pass `defaultOpen` if it wants this Layer-2 panel pre-expanded.
  defaultOpen?: boolean;
}

function SubBar({ label, score, inverted }: { label: string; score: number; inverted?: boolean }) {
  const tone = inverted
    ? score >= 50
      ? 'neg'
      : 'neutral'
    : score >= 70
    ? 'pos'
    : score >= 40
    ? 'neutral'
    : 'weak';
  return (
    <div className={`opp-sub opp-sub-${tone}`}>
      <span className="opp-sub-label">{label}</span>
      <div className="opp-sub-bar">
        <span
          className="fill"
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
      <span className="opp-sub-score">{score}</span>
    </div>
  );
}

function ReasonRow({ r, kind }: { r: ScoreReason; kind: 'pos' | 'neg' }) {
  return (
    <li className={`reason ${kind}`}>
      <span className="delta">
        {r.delta >= 0 ? '+' : ''}{r.delta}
      </span>
      <span className="label">{r.label}</span>
    </li>
  );
}

export function ScoreExplanationPanel({ lead, intelligence, defaultOpen = false }: Props) {
  const campaign = lead.primaryCampaign as Campaign;
  const positiveReasons = lead.reasons.filter((r) => r.delta >= 0);
  const negativeReasons = [
    ...lead.reasons.filter((r) => r.delta < 0),
    ...lead.rejectionReasons,
  ];

  return (
    <details className="drawer-collapsible" open={defaultOpen}>
      <summary className="drawer-collapsible-summary">
        Scoring details · rule {lead.ruleScore} · intent {lead.intentScore} · final {lead.finalScore}
      </summary>
      <div className="summary-card-detail">
        {lead.primaryReason && (
          <p className="note"><strong>{lead.primaryReason}</strong></p>
        )}

        <h5 className="drawer-sublabel">Per-stage scores</h5>
        <div className="drawer-score-table" role="table" aria-label="All scoring stats">
          <div className="drawer-score-row-item">
            <span className="drawer-score-label">Rule</span>
            <div className="score-bar A" style={{ height: 6 }}>
              <span className="fill" style={{ width: `${lead.ruleScore}%` }} />
            </div>
            <span className="drawer-score-value">{lead.ruleScore}</span>
          </div>
          <div className="drawer-score-row-item">
            <span className="drawer-score-label">Intent</span>
            <div className="score-bar A" style={{ height: 6 }}>
              <span className="fill" style={{ width: `${lead.intentScore}%` }} />
            </div>
            <span className="drawer-score-value">{lead.intentScore}</span>
          </div>
          <div className="drawer-score-row-item">
            <span className="drawer-score-label">Final</span>
            <div className={`score-bar ${lead.priority}`} style={{ height: 6 }}>
              <span className="fill" style={{ width: `${lead.finalScore}%` }} />
            </div>
            <span className="drawer-score-value">{lead.finalScore}</span>
          </div>
          <div className="drawer-score-divider" />
          {CAMPAIGN_VALUES.map((c) => {
            const s = lead.campaignScores[c] ?? 0;
            const active = c === campaign;
            return (
              <div key={c} className={`drawer-score-row-item ${active ? 'active' : ''}`}>
                <span className="drawer-score-label">
                  <span className={`campaign-dot campaign-${c}`} />
                  {CAMPAIGN_LABEL[c]}
                </span>
                <div className="score-bar" style={{ height: 6 }}>
                  <span
                    className="fill"
                    style={{
                      width: `${s}%`,
                      background: `var(--campaign-${c.toLowerCase()})`,
                    }}
                  />
                </div>
                <span className="drawer-score-value">{s}</span>
              </div>
            );
          })}
        </div>

        {intelligence && (
          <>
            <h5 className="drawer-sublabel">Opportunity intelligence sub-scores</h5>
            <div className="opp-sub-grid">
              <SubBar label="Operational pain" score={intelligence.operationalPain.score} />
              <SubBar label="Buying readiness" score={intelligence.buyingReadiness.score} />
              <SubBar label="Accessibility" score={intelligence.accessibility.score} />
              <SubBar label="Implementation fit" score={intelligence.implementationFit.score} />
              <SubBar label="Trust barrier" score={intelligence.trustBarrier.score} inverted />
              <SubBar label="Evidence confidence" score={intelligence.evidenceConfidence.score} />
            </div>
          </>
        )}

        {(positiveReasons.length > 0 || negativeReasons.length > 0) && (
          <>
            <h5 className="drawer-sublabel">Reasons feeding the score</h5>
            {positiveReasons.length > 0 && (
              <ul className="reason-list">
                {positiveReasons.map((r) => (
                  <ReasonRow key={`p-${r.code}`} r={r} kind="pos" />
                ))}
              </ul>
            )}
            {negativeReasons.length > 0 && (
              <>
                <h5 className="drawer-sublabel">What pulled the score down</h5>
                <ul className="reason-list">
                  {negativeReasons.map((r) => (
                    <ReasonRow key={`n-${r.code}`} r={r} kind="neg" />
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {intelligence && intelligence.opportunityReasons.length > 0 && (
          <>
            <h5 className="drawer-sublabel">Why intelligence ranked it</h5>
            <ul className="bullet-list">
              {intelligence.opportunityReasons.map((r, i) => (
                <li key={`p-${i}`}>{r}</li>
              ))}
            </ul>
          </>
        )}

        {intelligence && intelligence.riskFactors.length > 0 && (
          <>
            <h5 className="drawer-sublabel">Intelligence risk factors</h5>
            <ul className="bullet-list">
              {intelligence.riskFactors.map((r, i) => (
                <li key={`r-${i}`}>{r}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </details>
  );
}

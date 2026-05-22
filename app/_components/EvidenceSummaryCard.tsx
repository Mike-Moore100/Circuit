// EvidenceSummaryCard — Layer 2 view of evidence + proof. Confidence
// + headline issue on top; screenshots + full visual/operational
// detail behind <details>.

import type { LeadEvidenceSummary } from '../_lib/dashboardData';

interface Props {
  companyId: string;
  evidence: LeadEvidenceSummary | null;
}

export function EvidenceSummaryCard({ companyId, evidence }: Props) {
  if (!evidence) {
    return (
      <div className="summary-card summary-card-muted">
        <header className="summary-card-head">
          <h4 className="summary-card-title">Evidence</h4>
          <span className="summary-card-tag">Not captured</span>
        </header>
        <p className="summary-card-body">
          No screenshots or evidence extracted yet — run{' '}
          <code>npm run extract:evidence</code> to fill this in.
        </p>
      </div>
    );
  }

  const topVisual = evidence.visualIssues[0];
  const topClue = evidence.operationalClues[0];
  const headline = topVisual
    ? topVisual.label
    : topClue
    ? topClue.label
    : 'Captured — no critical issues flagged';
  const confidenceTone =
    evidence.evidenceConfidence >= 70
      ? 'ok'
      : evidence.evidenceConfidence >= 40
      ? 'warn'
      : 'muted';

  return (
    <div className={`summary-card summary-card-${confidenceTone}`}>
      <header className="summary-card-head">
        <h4 className="summary-card-title">Evidence</h4>
        <span className={`summary-card-tag summary-card-tag-${confidenceTone}`}>
          confidence {evidence.evidenceConfidence}
        </span>
      </header>
      <p className="summary-card-body"><strong>{headline}</strong></p>

      <div className="summary-card-grid">
        <SummaryCell label="Visual issues" value={String(evidence.visualIssues.length)} />
        <SummaryCell label="Operational clues" value={String(evidence.operationalClues.length)} />
        <SummaryCell label="Desktop shot" value={evidence.desktopScreenshotPath ? 'yes' : 'no'} />
        <SummaryCell label="Mobile shot" value={evidence.mobileScreenshotPath ? 'yes' : 'no'} />
      </div>

      <details className="drawer-collapsible">
        <summary className="drawer-collapsible-summary">
          Screenshots + per-issue detail
        </summary>
        <div className="summary-card-detail">
          {(evidence.desktopScreenshotPath || evidence.mobileScreenshotPath) && (
            <div className="evidence-screenshots">
              {evidence.desktopScreenshotPath && (
                <a
                  href={`/api/screenshot/${companyId}/desktop`}
                  target="_blank"
                  rel="noreferrer"
                  className="evidence-shot"
                >
                  <img
                    src={`/api/screenshot/${companyId}/desktop`}
                    alt="Desktop screenshot"
                  />
                  <span className="evidence-shot-label">Desktop</span>
                </a>
              )}
              {evidence.mobileScreenshotPath && (
                <a
                  href={`/api/screenshot/${companyId}/mobile`}
                  target="_blank"
                  rel="noreferrer"
                  className="evidence-shot mobile"
                >
                  <img
                    src={`/api/screenshot/${companyId}/mobile`}
                    alt="Mobile screenshot"
                  />
                  <span className="evidence-shot-label">Mobile</span>
                </a>
              )}
            </div>
          )}
          {evidence.visualIssues.length > 0 && (
            <>
              <h5 className="drawer-sublabel">Visual issues</h5>
              <div className="signal-chips">
                {evidence.visualIssues.map((v) => (
                  <span
                    key={v.code}
                    className="signal-chip neg"
                    title={v.detail ?? v.label}
                  >
                    {v.label}
                  </span>
                ))}
              </div>
            </>
          )}
          {evidence.operationalClues.length > 0 && (
            <>
              <h5 className="drawer-sublabel">Operational clues</h5>
              <ul className="reason-list">
                {evidence.operationalClues.map((c) => (
                  <li key={c.code} className="reason pos">
                    <span className="delta">{c.confidence}</span>
                    <span className="label">
                      <strong>{c.label}</strong>
                      {c.evidence.length > 0 && (
                        <span className="muted"> — {c.evidence.join(', ')}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </details>
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-cell">
      <span className="summary-cell-label">{label}</span>
      <span className="summary-cell-value">{value}</span>
    </div>
  );
}

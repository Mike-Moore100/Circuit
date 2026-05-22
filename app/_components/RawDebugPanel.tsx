// RawDebugPanel — Layer 3. Collapsed by default. Surfaces the raw
// inputs that produced the lead's state: verified signals, raw
// registry JSON, discovery metadata, calibration / review history.
// Nothing in this panel is operator-facing — it's for debugging
// scoring drift or chasing data-quality questions.

import type { ReviewQueueRow } from '../../src/types';
import type {
  LeadVerifiedSignal,
  RegistryEnrichmentPanel,
} from '../_lib/dashboardData';

interface CalibrationEvent {
  kind: 'review' | 'outcome';
  type: string;
  createdAt: string;
}

interface Props {
  lead: ReviewQueueRow;
  signals: LeadVerifiedSignal[];
  registry: RegistryEnrichmentPanel | null;
  // Lightweight calibration timeline — operator reviews + recorded
  // outcomes in time order. The lead drawer page assembles this
  // from existing repository queries.
  calibrationHistory: CalibrationEvent[];
}

function shortenSignalType(type: string): string {
  return type.replace(/^verified\./, '').replace(/_/g, ' ');
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export function RawDebugPanel({ lead, signals, registry, calibrationHistory }: Props) {
  return (
    <section className="raw-debug-panel">
      <header className="proof-panel-head">
        <h3 className="drawer-label">Raw + debug</h3>
        <span className="proof-panel-hint">
          The exact data Circuit consumed. For debugging only — collapsed
          by default.
        </span>
      </header>

      {signals.length > 0 && (
        <details className="drawer-collapsible">
          <summary className="drawer-collapsible-summary">
            Verified website signals ({signals.length})
          </summary>
          <div className="summary-card-detail">
            <div className="signal-chips">
              {signals.map((s) => {
                const penalty =
                  s.type === 'verified.website_failed' ||
                  s.type === 'verified.has_ai_automation_language' ||
                  s.type === 'verified.low_digital_maturity';
                return (
                  <span
                    key={`${s.type}-${s.value}`}
                    className={`signal-chip ${penalty ? 'neg' : 'pos'}`}
                    title={s.value}
                  >
                    {shortenSignalType(s.type)}
                  </span>
                );
              })}
            </div>
          </div>
        </details>
      )}

      {registry && registry.record && (
        <details className="drawer-collapsible">
          <summary className="drawer-collapsible-summary">
            Raw Companies House record
          </summary>
          <pre className="raw-debug-pre">{JSON.stringify(registry.record, null, 2)}</pre>
        </details>
      )}

      <details className="drawer-collapsible">
        <summary className="drawer-collapsible-summary">
          Source + discovery metadata
        </summary>
        <div className="summary-card-detail">
          <ul className="bullet-list">
            <li>
              <strong>Source:</strong> {lead.source}
            </li>
            {lead.discoveryQuery && (
              <li>
                <strong>Discovery query:</strong> {lead.discoveryQuery}
              </li>
            )}
            {lead.discoveryLocation && (
              <li>
                <strong>Discovery location:</strong> {lead.discoveryLocation}
              </li>
            )}
            {lead.industrySource && (
              <li>
                <strong>Industry inference source:</strong>{' '}
                {lead.industrySource}
                {lead.industryConfidence !== null && lead.industryConfidence !== undefined && (
                  <> · confidence {lead.industryConfidence}</>
                )}
              </li>
            )}
            {lead.website && (
              <li>
                <strong>Website:</strong>{' '}
                <a href={lead.website} target="_blank" rel="noreferrer">
                  {lead.website}
                </a>
              </li>
            )}
            <li>
              <strong>Updated:</strong> {fmtTime(lead.updatedAt)}
            </li>
          </ul>
        </div>
      </details>

      {calibrationHistory.length > 0 && (
        <details className="drawer-collapsible">
          <summary className="drawer-collapsible-summary">
            Calibration + outcome history ({calibrationHistory.length})
          </summary>
          <ol className="raw-debug-timeline">
            {calibrationHistory.map((ev, i) => (
              <li
                key={`${ev.kind}-${ev.type}-${i}`}
                className={`raw-debug-event raw-debug-${ev.kind}`}
              >
                <span className="raw-debug-when">{fmtTime(ev.createdAt)}</span>
                <span className="raw-debug-kind">{ev.kind}</span>
                <span className="raw-debug-type">{ev.type.replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

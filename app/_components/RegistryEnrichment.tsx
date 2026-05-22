// Companies House enrichment panel. Only renders when there's a real
// enrichment record — non-UK leads and skipped leads see nothing.
// Strictly informational; no scoring lives here.

import type { RegistryEnrichmentPanel } from '../_lib/dashboardData';

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
}

interface Props {
  enrichment: RegistryEnrichmentPanel | null;
}

export function RegistryEnrichment({ enrichment }: Props) {
  if (!enrichment) return null;
  // Hide the panel for skipped non-UK leads / disabled / no-key cases.
  // The dashboard rule is: show enrichment only for UK leads with data.
  if (enrichment.outcome !== 'enriched' && enrichment.outcome !== 'skipped_cache_hit_fresh') {
    return null;
  }
  const { record, signals } = enrichment;
  if (!record || !signals) return null;

  const activeDirectors = record.officers.filter((o) => o.isActive);
  const confidenceClass = `registry-confidence registry-confidence-${signals.legitimacyConfidence}`;

  return (
    <section className="drawer-section">
      <div className="registry-head">
        <h3 className="drawer-label">Companies House</h3>
        <span className={confidenceClass}>{signals.legitimacyConfidence} confidence</span>
      </div>
      <p className="drawer-section-hint">
        UK registry enrichment. Informational only — no scoring is driven
        from this section.
      </p>

      <div className="registry-grid">
        <div className="registry-cell">
          <span className="registry-cell-label">Status</span>
          <span className={`registry-cell-value registry-status registry-status-${record.status}`}>
            {record.status.replace(/_/g, ' ')}
          </span>
        </div>
        <div className="registry-cell">
          <span className="registry-cell-label">Company number</span>
          <span className="registry-cell-value">{record.registryId}</span>
        </div>
        <div className="registry-cell">
          <span className="registry-cell-label">Age</span>
          <span className="registry-cell-value">
            {signals.companyAgeYears !== null
              ? `${signals.companyAgeYears} yrs`
              : '—'}
          </span>
        </div>
        <div className="registry-cell">
          <span className="registry-cell-label">Incorporated</span>
          <span className="registry-cell-value">{fmtDate(record.incorporationDate)}</span>
        </div>
        <div className="registry-cell">
          <span className="registry-cell-label">Locality</span>
          <span className="registry-cell-value">{record.registeredOfficeLocality ?? '—'}</span>
        </div>
        <div className="registry-cell">
          <span className="registry-cell-label">Active directors</span>
          <span className="registry-cell-value">{signals.directorsFound}</span>
        </div>
      </div>

      {record.sicCodes.length > 0 && (
        <div className="registry-sic">
          <span className="registry-cell-label">SIC codes</span>
          <div className="registry-sic-chips">
            {record.sicCodes.map((c) => (
              <span key={c} className="registry-sic-chip">{c}</span>
            ))}
          </div>
        </div>
      )}

      {activeDirectors.length > 0 && (
        <details className="drawer-collapsible">
          <summary className="drawer-collapsible-summary">
            Active officers ({activeDirectors.length})
          </summary>
          <ul className="registry-officers">
            {activeDirectors.slice(0, 10).map((o) => (
              <li key={`${o.name}-${o.appointedOn}`}>
                <strong>{o.name}</strong>
                {o.role && <span className="muted"> — {o.role}</span>}
                {o.appointedOn && <span className="muted"> · since {fmtDate(o.appointedOn)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {signals.notes.length > 0 && (
        <ul className="registry-notes">
          {signals.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <p className="registry-foot">
        Source: Companies House — fetched {fmtDate(enrichment.fetchedAt)}
        {record.filingsCurrent === false && (
          <span className="registry-warning"> · filings overdue</span>
        )}
      </p>
    </section>
  );
}

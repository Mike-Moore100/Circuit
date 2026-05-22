'use client';

// Companies House enrichment panel. Always renders so the operator can
// trigger enrichment from the drawer instead of opening a terminal.
//
// Surfaces every state explicitly:
//
//   not_checked        — operator has never run this lead. Shows the
//                        "Run UK registry enrichment" button.
//   checking           — request is in flight (shows spinner).
//   enriched           — full record + signals from Companies House.
//   skipped_non_uk     — UK detection said no; operator can force.
//   skipped_no_match   — search returned nothing.
//   skipped_no_key     — API key missing.
//   skipped_disabled   — enrichment globally off.
//   error              — auth / network / other failure. Surfaces the
//                        underlying reason so the operator knows whether
//                        to regenerate the key.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { RegistryEnrichmentPanel } from '../_lib/dashboardData';
import type {
  CompanyRegistryRecord,
  RegistryEnrichmentSignals,
} from '../../src/enrichment/companyRegistryTypes';
import { RegistryDiagnostics } from './RegistryDiagnostics';

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
  companyId: string;
  enrichment: RegistryEnrichmentPanel | null;
}

type LocalStatus =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'error'; message: string };

export function RegistryEnrichment({ companyId, enrichment }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<LocalStatus>({ kind: 'idle' });

  async function run(force = false) {
    setStatus({ kind: 'running' });
    try {
      const res = await fetch('/api/services/run-registry-enrichment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, force }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok && body.error) {
        setStatus({ kind: 'error', message: body.error });
      } else {
        setStatus({ kind: 'idle' });
      }
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
    startTransition(() => router.refresh());
  }

  // ---- State derivation -----------------------------------------------
  const isRunning = status.kind === 'running' || pending;
  const outcome = enrichment?.outcome ?? 'not_checked';
  const stateClass = stateClassFor(outcome, status);

  return (
    <section className={`drawer-section registry-section ${stateClass}`}>
      <div className="registry-head">
        <h3 className="drawer-label">Companies House</h3>
        <RegistryStateBadge outcome={outcome} localStatus={status} />
      </div>
      <p className="drawer-section-hint">
        UK registry enrichment. Strictly informational — no scoring is driven
        from this section.
      </p>

      {enrichment && (enrichment.outcome === 'enriched' || enrichment.outcome === 'skipped_cache_hit_fresh') && enrichment.record && enrichment.signals && (
        <RegistryRecordView
          record={enrichment.record}
          signals={enrichment.signals}
          fetchedAt={enrichment.fetchedAt}
        />
      )}

      {enrichment && enrichment.outcome === 'error' && (
        <div className="registry-error">
          <strong>Lookup failed.</strong>
          <span>{enrichment.reason}</span>
          {/401|403|auth/i.test(enrichment.reason) && (
            <span className="registry-error-hint">
              The Companies House key may be revoked or the wrong type
              (use a REST API key, not a stream key). Regenerate one at{' '}
              <a
                href="https://developer.company-information.service.gov.uk/"
                target="_blank"
                rel="noreferrer"
              >
                developer.company-information.service.gov.uk
              </a>
              .
            </span>
          )}
        </div>
      )}

      {enrichment && enrichment.outcome === 'skipped_non_uk' && (
        <div className="registry-note">
          {enrichment.reason}. Companies House only covers UK businesses.
        </div>
      )}

      {enrichment && enrichment.outcome === 'skipped_no_match' && (
        <div className="registry-note">
          No matching record found in the UK register. The captured
          business name may differ from the registered name.
        </div>
      )}

      {(enrichment?.outcome === 'skipped_no_key' || enrichment?.outcome === 'skipped_disabled') && (
        <div className="registry-note">
          {enrichment.reason}. Set <code>COMPANIES_HOUSE_API_KEY</code> and{' '}
          <code>COMPANIES_HOUSE_ENABLED=1</code> in <code>.env.local</code>,
          then restart the app.
        </div>
      )}

      {status.kind === 'error' && (
        <div className="registry-error">
          <strong>Request failed.</strong>
          <span>{status.message}</span>
        </div>
      )}

      <RegistryActions
        outcome={outcome}
        isRunning={isRunning}
        onRun={() => run(false)}
        onForce={() => run(true)}
      />

      <RegistryDiagnostics />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function RegistryStateBadge({
  outcome,
  localStatus,
}: {
  outcome: string;
  localStatus: LocalStatus;
}) {
  if (localStatus.kind === 'running') {
    return <span className="registry-state registry-state-checking">Checking…</span>;
  }
  switch (outcome) {
    case 'not_checked':
      return <span className="registry-state registry-state-idle">Not checked</span>;
    case 'enriched':
    case 'skipped_cache_hit_fresh':
      return <span className="registry-state registry-state-ok">Match found</span>;
    case 'skipped_no_match':
      return <span className="registry-state registry-state-warn">No match</span>;
    case 'skipped_non_uk':
      return <span className="registry-state registry-state-muted">Skipped — non-UK lead</span>;
    case 'skipped_no_key':
    case 'skipped_disabled':
      return <span className="registry-state registry-state-warn">Not configured</span>;
    case 'error':
      return <span className="registry-state registry-state-err">Error</span>;
    default:
      return <span className="registry-state registry-state-muted">{outcome}</span>;
  }
}

function RegistryActions({
  outcome,
  isRunning,
  onRun,
  onForce,
}: {
  outcome: string;
  isRunning: boolean;
  onRun: () => void;
  onForce: () => void;
}) {
  if (isRunning) {
    return (
      <div className="registry-actions">
        <button type="button" className="btn btn-sm" disabled>
          Checking Companies House…
        </button>
      </div>
    );
  }
  if (outcome === 'skipped_disabled' || outcome === 'skipped_no_key') {
    // No point letting the operator click — the server will refuse.
    return null;
  }
  if (outcome === 'skipped_non_uk') {
    return (
      <div className="registry-actions">
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={onForce}
          title="Bypass the UK detection — useful when the lead is actually UK-based but the metadata didn't pick it up"
        >
          Run anyway
        </button>
      </div>
    );
  }
  if (outcome === 'enriched' || outcome === 'skipped_cache_hit_fresh') {
    return (
      <div className="registry-actions">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onRun}>
          Refresh
        </button>
      </div>
    );
  }
  // not_checked / skipped_no_match / error
  return (
    <div className="registry-actions">
      <button
        type="button"
        className="btn btn-sm btn-primary"
        onClick={onRun}
      >
        {outcome === 'not_checked' ? 'Run UK registry enrichment' : 'Retry'}
      </button>
    </div>
  );
}

function stateClassFor(outcome: string, status: LocalStatus): string {
  if (status.kind === 'running') return 'registry-section-checking';
  switch (outcome) {
    case 'not_checked': return 'registry-section-idle';
    case 'enriched':
    case 'skipped_cache_hit_fresh':
      return 'registry-section-ok';
    case 'error': return 'registry-section-err';
    case 'skipped_no_key':
    case 'skipped_disabled':
      return 'registry-section-warn';
    default: return 'registry-section-muted';
  }
}

function RegistryRecordView({
  record,
  signals,
  fetchedAt,
}: {
  record: CompanyRegistryRecord;
  signals: RegistryEnrichmentSignals;
  fetchedAt: string;
}) {
  const activeDirectors = record.officers.filter((o) => o.isActive);
  const confidenceClass = `registry-confidence registry-confidence-${signals.legitimacyConfidence}`;

  return (
    <>
      <div className="registry-record-head">
        <span className={confidenceClass}>{signals.legitimacyConfidence} confidence</span>
      </div>
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
            {signals.companyAgeYears !== null ? `${signals.companyAgeYears} yrs` : '—'}
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
        Source: Companies House — fetched {fmtDate(fetchedAt)}
        {record.filingsCurrent === false && (
          <span className="registry-warning"> · filings overdue</span>
        )}
      </p>
    </>
  );
}

'use client';

// RegistrySummaryCard — Layer 2 (proof) view of Companies House data.
// Summary first (status, age, number, SIC category, officer count,
// maturity); officers list + registered address + raw JSON live
// behind <details> so the surface stays scannable.
//
// Strictly informational. The Layer 1 DecisionSummary already shows
// the headline status badge; this card adds the depth without burying it.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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

// SIC code → high-level category — derived from the first SIC code's
// section letter. Companies House SIC codes follow the UK SIC 2007
// scheme; the leading digits cluster by section. We surface a short
// human label so the operator gets "Professional services" instead
// of "70229" with no context.
function sicCategoryHint(sic: string | undefined): string | null {
  if (!sic) return null;
  const n = Number(sic);
  if (!Number.isFinite(n)) return null;
  if (n >= 1000 && n < 4000) return 'Manufacturing / agriculture';
  if (n >= 4100 && n < 4400) return 'Construction';
  if (n >= 4500 && n < 4800) return 'Wholesale / retail';
  if (n >= 4900 && n < 5400) return 'Transport / logistics';
  if (n >= 5500 && n < 5700) return 'Hospitality';
  if (n >= 5800 && n < 6400) return 'Information / IT';
  if (n >= 6400 && n < 6700) return 'Financial services';
  if (n >= 6800 && n < 6900) return 'Real estate';
  if (n >= 6900 && n < 7600) return 'Professional services';
  if (n >= 7700 && n < 8300) return 'Admin / support';
  if (n >= 8400 && n < 8800) return 'Education / health';
  return null;
}

interface Props {
  companyId: string;
  enrichment: RegistryEnrichmentPanel | null;
}

export function RegistrySummaryCard({ companyId, enrichment }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      await fetch('/api/services/run-registry-enrichment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });
    } finally {
      setBusy(false);
    }
    startTransition(() => router.refresh());
  }

  // No row yet — surface a CTA, not nothing.
  if (!enrichment) {
    return (
      <div className="summary-card summary-card-muted">
        <header className="summary-card-head">
          <h4 className="summary-card-title">Companies House</h4>
          <span className="summary-card-tag">Not checked</span>
        </header>
        <p className="summary-card-body">
          Registry enrichment hasn't run yet for this lead.
        </p>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={refresh}
          disabled={busy || pending}
        >
          {busy ? 'Checking…' : 'Run UK registry enrichment'}
        </button>
      </div>
    );
  }

  // Non-enriched outcomes — give the operator the one-line "why" and
  // a fix CTA where appropriate. No layered data to disclose.
  if (enrichment.outcome !== 'enriched' && enrichment.outcome !== 'skipped_cache_hit_fresh') {
    return (
      <div className="summary-card summary-card-muted">
        <header className="summary-card-head">
          <h4 className="summary-card-title">Companies House</h4>
          <span className={`summary-card-tag summary-card-tag-${outcomeTone(enrichment.outcome)}`}>
            {outcomeLabel(enrichment.outcome)}
          </span>
        </header>
        <p className="summary-card-body">{enrichment.reason}</p>
        {(enrichment.outcome === 'skipped_no_match' || enrichment.outcome === 'error') && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={refresh}
            disabled={busy || pending}
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  const record = enrichment.record!;
  const signals = enrichment.signals!;
  const activeOfficers = record.officers.filter((o) => o.isActive);
  const sicHint = sicCategoryHint(record.sicCodes[0]);

  return (
    <div className={`summary-card summary-card-${record.status === 'active' ? 'ok' : 'warn'}`}>
      <header className="summary-card-head">
        <h4 className="summary-card-title">Companies House</h4>
        <span className={`summary-card-tag summary-card-tag-${record.status === 'active' ? 'ok' : 'warn'}`}>
          {record.status}
        </span>
      </header>

      <div className="summary-card-grid">
        <SummaryCell label="Age" value={signals.companyAgeYears !== null ? `${signals.companyAgeYears}y` : '—'} />
        <SummaryCell label="Company no" value={record.registryId} />
        <SummaryCell label="SIC category" value={sicHint ?? record.sicCodes[0] ?? '—'} />
        <SummaryCell label="Active officers" value={String(signals.directorsFound)} />
        <SummaryCell label="Locality" value={record.registeredOfficeLocality ?? '—'} />
        <SummaryCell
          label="Maturity"
          value={
            signals.legitimacyConfidence === 'high'
              ? 'Strong'
              : signals.legitimacyConfidence === 'medium'
              ? 'Moderate'
              : 'Limited'
          }
        />
      </div>

      {signals.notes.length > 0 && (
        <ul className="summary-card-notes">
          {signals.notes.slice(0, 4).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <details className="drawer-collapsible">
        <summary className="drawer-collapsible-summary">
          Officers + SIC + filings ({activeOfficers.length} active)
        </summary>
        <div className="summary-card-detail">
          {activeOfficers.length > 0 && (
            <>
              <h5 className="drawer-sublabel">Officers</h5>
              <ul className="registry-officers">
                {activeOfficers.slice(0, 12).map((o) => (
                  <li key={`${o.name}-${o.appointedOn}`}>
                    <strong>{o.name}</strong>
                    {o.role && <span className="muted"> — {o.role}</span>}
                    {o.appointedOn && (
                      <span className="muted"> · since {fmtDate(o.appointedOn)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {record.sicCodes.length > 0 && (
            <>
              <h5 className="drawer-sublabel">SIC codes</h5>
              <div className="registry-sic-chips">
                {record.sicCodes.map((c) => (
                  <span key={c} className="registry-sic-chip">{c}</span>
                ))}
              </div>
            </>
          )}
          <h5 className="drawer-sublabel">Filing + address</h5>
          <ul className="bullet-list">
            <li>
              Incorporated {fmtDate(record.incorporationDate)} ·{' '}
              {record.registeredOfficeLocality ?? '—'},{' '}
              {record.registeredOfficeCountry ?? '—'}
            </li>
            {record.filingsCurrent === false && (
              <li className="reason neg">Filings overdue at Companies House</li>
            )}
          </ul>
        </div>
      </details>

      <div className="summary-card-actions">
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={refresh}
          disabled={busy || pending}
        >
          {busy ? 'Refreshing…' : 'Refresh from Companies House'}
        </button>
      </div>
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

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case 'skipped_non_uk': return 'Non-UK lead';
    case 'skipped_no_match': return 'No match';
    case 'skipped_no_key':
    case 'skipped_disabled':
      return 'Not configured';
    case 'error': return 'Error';
    default: return outcome;
  }
}

function outcomeTone(outcome: string): 'ok' | 'warn' | 'muted' {
  switch (outcome) {
    case 'skipped_non_uk':
    case 'skipped_no_key':
    case 'skipped_disabled':
      return 'muted';
    case 'skipped_no_match':
    case 'error':
      return 'warn';
    default:
      return 'muted';
  }
}

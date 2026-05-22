'use client';

// ContactSummaryCard — Layer 2 view of decision-maker reach.
// Summary first (best contact route, named DM, channel mix); the
// full contact + route list lives behind <details>.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { LeadContactBundle } from '../_lib/dashboardData';
import { EmailConfidencePill } from './EmailConfidencePill';

function emailStatusLabel(status: string | null): string {
  if (!status || status === 'extracted') return 'extracted';
  if (status === 'guessed') return 'guessed';
  return status;
}

function readableSource(url: string | null): string {
  if (!url) return 'unknown';
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '');
    return path ? `${u.hostname}${path}` : `${u.hostname} (homepage)`;
  } catch {
    return url;
  }
}

interface Props {
  contacts: LeadContactBundle;
  likelyBuyer: string | null;
  // companyId allows the in-card "Verify emails" button to POST to
  // /api/services/verify-email-confidence with a single click — UI
  // is the supported path; CLI is dev-only.
  companyId: string;
}

export function ContactSummaryCard({ contacts, likelyBuyer, companyId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  async function verifyAll() {
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await fetch('/api/services/verify-email-confidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setVerifyError(body?.error ?? `Request failed (${res.status})`);
      }
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(false);
    }
    startTransition(() => router.refresh());
  }

  // Count how many contacts have been verified vs unchecked — drives
  // the badge in the card header.
  const uncheckedEmails = contacts.contacts.filter(
    (c) => c.email && (c.emailVerificationStatus === null || c.emailVerificationStatus === 'UNCHECKED'),
  ).length;
  const validLikely = contacts.contacts.filter(
    (c) => c.emailVerificationStatus === 'VALID_LIKELY',
  ).length;
  const risky = contacts.contacts.filter(
    (c) => c.emailVerificationStatus === 'RISKY',
  ).length;
  const namedContacts = contacts.contacts.filter((c) => c.name);
  const generalEmails = contacts.contacts.filter((c) => c.email && !c.name);
  const phoneRoutes = contacts.routes.filter((r) => r.type === 'PHONE');
  const linkedInRoutes = contacts.routes.filter((r) => r.type !== 'PHONE');

  const hasAnything =
    contacts.contacts.length > 0 || contacts.routes.length > 0;

  if (!hasAnything) {
    return (
      <div className="summary-card summary-card-muted">
        <header className="summary-card-head">
          <h4 className="summary-card-title">Contact</h4>
          <span className="summary-card-tag summary-card-tag-warn">No path</span>
        </header>
        <p className="summary-card-body">
          No contacts captured yet — discovery hasn't found a usable
          decision-maker email or phone.
        </p>
      </div>
    );
  }

  return (
    <div className={`summary-card summary-card-${namedContacts.length > 0 ? 'ok' : 'warn'}`}>
      <header className="summary-card-head">
        <h4 className="summary-card-title">Contact</h4>
        <span className={`summary-card-tag summary-card-tag-${namedContacts.length > 0 ? 'ok' : 'warn'}`}>
          {namedContacts.length > 0
            ? `${namedContacts.length} named`
            : 'Generic only'}
        </span>
      </header>

      {likelyBuyer && (
        <p className="summary-card-body">
          <strong>Likely buyer:</strong> {likelyBuyer}
        </p>
      )}

      <div className="summary-card-grid">
        <SummaryCell label="Named DMs" value={String(namedContacts.length)} />
        <SummaryCell label="Generic emails" value={String(generalEmails.length)} />
        <SummaryCell label="Phone routes" value={String(phoneRoutes.length)} />
        <SummaryCell label="LinkedIn / web" value={String(linkedInRoutes.length)} />
        <SummaryCell label="Likely valid" value={String(validLikely)} />
        <SummaryCell label="Risky" value={String(risky)} />
      </div>

      {/* Email-confidence surface — never buried in debug data. */}
      <div className="email-conf-actions">
        <button
          type="button"
          className="btn btn-sm"
          onClick={verifyAll}
          disabled={verifying || pending || contacts.contacts.filter((c) => c.email).length === 0}
          title="Run free email confidence checks (syntax + DNS + risk scoring)"
        >
          {verifying ? 'Verifying…' : uncheckedEmails > 0 ? `Verify ${uncheckedEmails} unchecked email${uncheckedEmails === 1 ? '' : 's'}` : 'Re-verify all'}
        </button>
        {verifyError && <span className="email-conf-error">{verifyError}</span>}
      </div>

      <details className="drawer-collapsible">
        <summary className="drawer-collapsible-summary">
          All contacts ({contacts.contacts.length}) + routes ({contacts.routes.length})
        </summary>
        <div className="summary-card-detail">
          {contacts.contacts.length > 0 && (
            <ul className="contact-list">
              {contacts.contacts.slice(0, 8).map((c, i) => (
                <li key={`${c.email ?? c.name ?? i}`} className={`contact-item ${c.isPrimary ? 'primary' : ''}`}>
                  <div className="contact-row">
                    <strong className="contact-name">{c.name ?? '—'}</strong>
                    {c.role && <span className="contact-role">{c.role}</span>}
                    <span
                      className={`contact-source-tag contact-source-${c.source}`}
                      title={`Discovered via ${c.source}`}
                    >
                      {c.source}
                    </span>
                  </div>
                  {c.email && (
                    <>
                      <div className="contact-email-row">
                        <a href={`mailto:${c.email}`} className="contact-email">
                          {c.email}
                        </a>
                        <span className={`email-status email-status-${c.emailStatus ?? 'extracted'}`}>
                          {emailStatusLabel(c.emailStatus)}
                        </span>
                        {c.emailType && (
                          <span className="email-type">
                            {c.emailType.replace(/_/g, ' ')}
                          </span>
                        )}
                        <EmailConfidencePill
                          status={c.emailVerificationStatus}
                          confidence={c.emailConfidenceScore}
                        />
                      </div>
                      {c.emailRiskReasons && c.emailRiskReasons.length > 0 && (
                        <ul className="email-conf-reasons">
                          {c.emailRiskReasons.slice(0, 4).map((r) => (
                            <li key={r.code} className={r.delta < 0 ? 'neg' : 'pos'}>
                              {r.delta >= 0 ? '+' : ''}{r.delta} · {r.label}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                  {c.sourceUrl && (
                    <div className="contact-source">
                      source:{' '}
                      <a href={c.sourceUrl} target="_blank" rel="noreferrer">
                        {readableSource(c.sourceUrl)}
                      </a>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {contacts.routes.length > 0 && (
            <>
              <h5 className="drawer-sublabel">Fallback routes</h5>
              <ul className="route-list">
                {contacts.routes.map((r, i) => (
                  <li key={`${r.type}-${i}`} className="route-item">
                    <span className="route-type">{r.type.replace(/_/g, ' ')}</span>
                    {r.type === 'PHONE' ? (
                      <a href={`tel:${r.value.replace(/[^\d+]/g, '')}`}>{r.value}</a>
                    ) : (
                      <a href={r.value} target="_blank" rel="noreferrer">
                        {r.value}
                      </a>
                    )}
                    <span className="route-confidence">{r.confidence}</span>
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

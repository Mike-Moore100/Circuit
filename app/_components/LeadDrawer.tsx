import Link from 'next/link';
import { CAMPAIGN_LABEL, CAMPAIGN_VALUES, type Campaign } from '../../src/scoring/campaignTypes';
import type { ReviewQueueRow, ScoreReason } from '../../src/types';
import type {
  AiAnalysisPanel,
  LeadContactBundle,
  LeadEvidenceSummary,
  LeadVerifiedSignal,
} from '../_lib/dashboardData';
import { ReviewActions } from './ReviewActions';
import { LeadReviewActions } from './LeadReviewActions';

interface Props {
  lead: ReviewQueueRow;
  signals: LeadVerifiedSignal[];
  ai: AiAnalysisPanel | undefined;
  currentReview: string | null;
  contacts: LeadContactBundle;
  evidence: LeadEvidenceSummary | null;
}

function emailStatusLabel(status: string | null, hasEmail: boolean): string {
  if (!hasEmail) return 'no email';
  // Legacy contacts (from Phase 1) have an email but a null status — they
  // were extracted from the source feed, so treat as 'extracted'.
  if (!status) return 'extracted';
  if (status === 'guessed') return 'guessed (unverified)';
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

function domain(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function shortenSignalType(type: string): string {
  return type.replace(/^verified\./, '').replace(/_/g, ' ');
}

function ReasonRow({ r, kind }: { r: ScoreReason; kind: 'pos' | 'neg' }) {
  return (
    <li className={`reason ${kind}`}>
      <span className="delta">
        {r.delta >= 0 ? '+' : ''}
        {r.delta}
      </span>
      <span className="label">{r.label}</span>
    </li>
  );
}

export function LeadDrawer({ lead, signals, ai, currentReview, contacts, evidence }: Props) {
  const positiveReasons = lead.reasons.filter((r) => r.delta >= 0);
  const negativeReasons = [
    ...lead.reasons.filter((r) => r.delta < 0),
    ...lead.rejectionReasons,
  ];
  const campaign = lead.primaryCampaign as Campaign;
  const campaignScore = lead.campaignScores[campaign] ?? 0;
  const host = domain(lead.website);

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
        <h2 className="drawer-title">{lead.company}</h2>
        <div className="drawer-sub">
          {lead.website ? (
            <a href={lead.website} target="_blank" rel="noreferrer">
              {host}
            </a>
          ) : (
            <span className="muted">no website</span>
          )}
          {lead.industry && <span> · {lead.industry}</span>}
          {lead.location && <span> · {lead.location}</span>}
        </div>
      </header>

      <div className="drawer-body">
        <section className="drawer-section">
          <div className="drawer-score-row">
            <div>
              <div className="drawer-label">Campaign score</div>
              <div className="drawer-score">{campaignScore}</div>
              <div className="drawer-score-sub">
                rule {lead.ruleScore} · intent {lead.intentScore} · final {lead.finalScore}
              </div>
            </div>
            <div className={`score-bar ${campaign === 'REJECT' ? 'Reject' : 'A'}`} style={{ flex: 1, height: 8 }}>
              <span className="fill" style={{ width: `${campaignScore}%` }} />
            </div>
          </div>
          <p className="note" style={{ marginTop: 8 }}>
            <strong>{lead.primaryReason}</strong>
          </p>

          <div className="drawer-score-table" role="table" aria-label="All scoring stats">
            <div className="drawer-score-row-item">
              <span className="drawer-score-label">Rule score</span>
              <div className="score-bar A" style={{ height: 6 }}>
                <span className="fill" style={{ width: `${lead.ruleScore}%` }} />
              </div>
              <span className="drawer-score-value">{lead.ruleScore}</span>
            </div>
            <div className="drawer-score-row-item">
              <span className="drawer-score-label">Intent score</span>
              <div className="score-bar A" style={{ height: 6 }}>
                <span className="fill" style={{ width: `${lead.intentScore}%` }} />
              </div>
              <span className="drawer-score-value">{lead.intentScore}</span>
            </div>
            <div className="drawer-score-row-item">
              <span className="drawer-score-label">Final score</span>
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
                <div
                  key={c}
                  className={`drawer-score-row-item ${active ? 'active' : ''}`}
                >
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
        </section>

        <section className="drawer-section">
          <h3 className="drawer-label">Evidence &amp; proof</h3>
          {!evidence ? (
            <p className="note">
              No evidence captured yet. Run <code>npm run extract:evidence</code> to take
              desktop + mobile screenshots and detect visual / operational issues.
            </p>
          ) : (
            <>
              <div className="evidence-summary-row">
                <div className="drawer-score-sub">
                  Confidence{' '}
                  <strong style={{ color: 'var(--text)' }}>
                    {evidence.evidenceConfidence}
                  </strong>{' '}
                  · {evidence.visualIssues.length} visual issue
                  {evidence.visualIssues.length === 1 ? '' : 's'} ·{' '}
                  {evidence.operationalClues.length} operational clue
                  {evidence.operationalClues.length === 1 ? '' : 's'}
                </div>
              </div>
              <div className="evidence-screenshots">
                {evidence.desktopScreenshotPath && (
                  <a
                    href={`/api/screenshot/${lead.companyId}/desktop`}
                    target="_blank"
                    rel="noreferrer"
                    className="evidence-shot"
                  >
                    <img
                      src={`/api/screenshot/${lead.companyId}/desktop`}
                      alt="Desktop screenshot"
                    />
                    <span className="evidence-shot-label">Desktop</span>
                  </a>
                )}
                {evidence.mobileScreenshotPath && (
                  <a
                    href={`/api/screenshot/${lead.companyId}/mobile`}
                    target="_blank"
                    rel="noreferrer"
                    className="evidence-shot mobile"
                  >
                    <img
                      src={`/api/screenshot/${lead.companyId}/mobile`}
                      alt="Mobile screenshot"
                    />
                    <span className="evidence-shot-label">Mobile</span>
                  </a>
                )}
              </div>
              {evidence.visualIssues.length > 0 && (
                <>
                  <h4 className="drawer-sublabel">Visual issues</h4>
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
                  <h4 className="drawer-sublabel">Operational clues</h4>
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
            </>
          )}
        </section>

        <section className="drawer-section">
          <h3 className="drawer-label">Contact</h3>
          {contacts.contacts.length === 0 && contacts.routes.length === 0 ? (
            <p className="note">
              No contact discovered yet. Run <code>npm run discover:contacts</code> to crawl
              the company website.
            </p>
          ) : (
            <>
              {contacts.contacts.length > 0 && (
                <ul className="contact-list">
                  {contacts.contacts.slice(0, 6).map((c, i) => (
                    <li
                      key={`${c.email ?? c.name ?? i}`}
                      className={`contact-item ${c.isPrimary ? 'primary' : ''}`}
                    >
                      <div className="contact-row">
                        <strong className="contact-name">{c.name ?? '—'}</strong>
                        {c.role && <span className="contact-role">{c.role}</span>}
                        <span className="contact-confidence" data-conf={c.overallConfidence >= 70 ? 'high' : c.overallConfidence >= 40 ? 'medium' : 'low'}>
                          {c.overallConfidence}
                        </span>
                      </div>
                      {c.email && (
                        <div className="contact-email-row">
                          <a href={`mailto:${c.email}`} className="contact-email">
                            {c.email}
                          </a>
                          <span
                            className={`email-status email-status-${c.emailStatus ?? 'extracted'}`}
                          >
                            {emailStatusLabel(c.emailStatus, !!c.email)}
                          </span>
                          {c.emailType && (
                            <span className="email-type">{c.emailType.replace(/_/g, ' ')}</span>
                          )}
                        </div>
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
                  <h4 className="drawer-sublabel">Fallback routes</h4>
                  <ul className="route-list">
                    {contacts.routes
                      .filter((r) => r.type !== 'EMAIL')
                      .map((r, i) => (
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
            </>
          )}
        </section>

        {signals.length > 0 && (
          <section className="drawer-section">
            <h3 className="drawer-label">Verified website signals</h3>
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
          </section>
        )}

        <section className="drawer-section">
          <h3 className="drawer-label">What worked</h3>
          {positiveReasons.length === 0 ? (
            <p className="note">No positive contributions recorded.</p>
          ) : (
            <ul className="reason-list">
              {positiveReasons.map((r) => (
                <ReasonRow key={`p-${r.code}`} r={r} kind="pos" />
              ))}
            </ul>
          )}
        </section>

        {negativeReasons.length > 0 && (
          <section className="drawer-section">
            <h3 className="drawer-label">What pulled the score down</h3>
            <ul className="reason-list">
              {negativeReasons.map((r) => (
                <ReasonRow key={`n-${r.code}`} r={r} kind="neg" />
              ))}
            </ul>
          </section>
        )}

        <section className="drawer-section">
          <h3 className="drawer-label">Next step</h3>
          <p className="note">{lead.suggestedNextStep}</p>
          {lead.likelyPainPoints.length > 0 && (
            <ul className="reason-list" style={{ marginTop: 8 }}>
              {lead.likelyPainPoints.map((p, i) => (
                <li key={i} className="reason pos">
                  <span className="delta">·</span>
                  <span className="label">{p}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {ai && (
          <section className="drawer-section drawer-ai">
            <h3 className="drawer-label">
              AI analysis · confidence {ai.confidence}
            </h3>
            <p className="note">{ai.summary}</p>
            {ai.operationalPainPoints.length > 0 && (
              <>
                <h4 className="drawer-sublabel">Operational pain points</h4>
                <ul className="reason-list">
                  {ai.operationalPainPoints.map((p) => (
                    <li key={p.title} className="reason pos">
                      <span className="delta">·</span>
                      <span className="label">
                        <strong>{p.title}</strong> — {p.description}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {ai.automationOpportunities.length > 0 && (
              <>
                <h4 className="drawer-sublabel">Automation opportunities</h4>
                <ul className="reason-list">
                  {ai.automationOpportunities.map((o) => (
                    <li key={o.title} className="reason pos">
                      <span className="delta">·</span>
                      <span className="label">
                        <strong>{o.title}</strong> — {o.description}{' '}
                        <span className="muted">({o.implementationComplexity})</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        <section className="drawer-section">
          <h3 className="drawer-label">Was this routing right?</h3>
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

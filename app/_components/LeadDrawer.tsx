import Link from 'next/link';
import { CAMPAIGN_LABEL, CAMPAIGN_VALUES, type Campaign } from '../../src/scoring/campaignTypes';
import type { ReviewQueueRow, ScoreReason } from '../../src/types';
import type {
  AiAnalysisPanel,
  LeadContactBundle,
  LeadEvidenceSummary,
  LeadVerifiedSignal,
} from '../_lib/dashboardData';
import type { OpportunityIntelligence } from '../../src/intelligence/intelligenceTypes';
import { ReviewActions } from './ReviewActions';
import { LeadReviewActions } from './LeadReviewActions';
import { OutcomeTracker, type OutcomeRow } from './OutcomeTracker';
import { RegistryEnrichment } from './RegistryEnrichment';
import type { RegistryEnrichmentPanel } from '../_lib/dashboardData';

interface Props {
  lead: ReviewQueueRow;
  signals: LeadVerifiedSignal[];
  ai: AiAnalysisPanel | undefined;
  currentReview: string | null;
  contacts: LeadContactBundle;
  evidence: LeadEvidenceSummary | null;
  intelligence: OpportunityIntelligence | null;
  outcomes: OutcomeRow[];
  registryEnrichment: RegistryEnrichmentPanel | null;
}

function emailStatusLabel(status: string | null, hasEmail: boolean): string {
  if (!hasEmail) return 'no email';
  // Legacy contacts (from Phase 1) have an email but a null status — they
  // were extracted from the source feed, so treat as 'extracted'.
  if (!status) return 'extracted';
  if (status === 'guessed') return 'guessed (unverified)';
  return status;
}

// Small inline bar used by the Opportunity Intelligence section. `inverted`
// renders the bar in danger-tone (used for trust barrier where higher = worse).
function SubBar({
  label,
  score,
  inverted,
}: {
  label: string;
  score: number;
  inverted?: boolean;
}) {
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
        <span className="fill" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
      <span className="opp-sub-score">{score}</span>
    </div>
  );
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

export function LeadDrawer({
  lead,
  signals,
  ai,
  currentReview,
  contacts,
  evidence,
  intelligence,
  outcomes,
  registryEnrichment,
}: Props) {
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
          {lead.primaryReason && (
            <p className="note">
              <strong>{lead.primaryReason}</strong>
            </p>
          )}

          {/* Single score table — rule / intent / final on top, per-campaign
             below. The Opportunity Intelligence section underneath carries
             the commercial-reasoning narrative, so we don't duplicate the
             campaign-score-hero block any more. */}
          <details className="drawer-collapsible">
            <summary className="drawer-collapsible-summary">
              Scoring breakdown ({lead.ruleScore} · {lead.intentScore} · {lead.finalScore})
            </summary>
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
          </details>
        </section>

        {intelligence && (
          <section className="drawer-section">
            <h3 className="drawer-label">Opportunity intelligence</h3>
            <div className="opp-summary">
              <div className="opp-score">
                <span className="opp-score-value">{intelligence.opportunityScore}</span>
                <span className="opp-score-cap">/100</span>
              </div>
              <div className="opp-meta">
                <span
                  className={`attention-pill attention-${intelligence.humanAttentionPriority}`}
                >
                  {intelligence.humanAttentionPriority}
                </span>
                <span className="opp-meta-line">
                  {intelligence.likelyProjectType.replace(/_/g, ' ').toLowerCase()} ·{' '}
                  {intelligence.estimatedProjectComplexity.toLowerCase()} complexity ·{' '}
                  {intelligence.estimatedCommercialPotential.toLowerCase()} potential
                </span>
              </div>
            </div>

            <div className="opp-sub-grid">
              <SubBar label="Operational pain" score={intelligence.operationalPain.score} />
              <SubBar label="Buying readiness" score={intelligence.buyingReadiness.score} />
              <SubBar label="Accessibility" score={intelligence.accessibility.score} />
              <SubBar label="Implementation fit" score={intelligence.implementationFit.score} />
              <SubBar
                label="Trust barrier"
                score={intelligence.trustBarrier.score}
                inverted
              />
              <SubBar label="Evidence confidence" score={intelligence.evidenceConfidence.score} />
            </div>

            {intelligence.opportunityReasons.length > 0 && (
              <>
                <h4 className="drawer-sublabel">Why it ranked highly</h4>
                <ul className="bullet-list">
                  {intelligence.opportunityReasons.map((r, i) => (
                    <li key={`p-${i}`}>{r}</li>
                  ))}
                </ul>
              </>
            )}
            {intelligence.riskFactors.length > 0 && (
              <>
                <h4 className="drawer-sublabel">Risk factors</h4>
                <ul className="bullet-list">
                  {intelligence.riskFactors.map((r, i) => (
                    <li key={`r-${i}`}>{r}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

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
                        <span
                          className={`contact-source-tag contact-source-${c.source}`}
                          title={`Discovered via ${c.source}`}
                        >
                          {c.source}
                        </span>
                        <span
                          className="contact-confidence"
                          data-conf={
                            c.overallConfidence >= 70
                              ? 'high'
                              : c.overallConfidence >= 40
                              ? 'medium'
                              : 'low'
                          }
                        >
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
            <details className="drawer-collapsible">
              <summary className="drawer-collapsible-summary">
                Verified website signals ({signals.length})
              </summary>
              <div className="signal-chips" style={{ marginTop: 8 }}>
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
            </details>
          </section>
        )}

        {/* Rule + intent reason lists live behind progressive disclosure —
           the Opportunity Intelligence narrative above is the primary
           commercial reasoning surface. */}
        {(positiveReasons.length > 0 || negativeReasons.length > 0) && (
          <section className="drawer-section">
            <details className="drawer-collapsible">
              <summary className="drawer-collapsible-summary">
                Raw scoring reasons ({positiveReasons.length} pos · {negativeReasons.length} neg)
              </summary>
              {positiveReasons.length > 0 && (
                <>
                  <h4 className="drawer-sublabel">What worked</h4>
                  <ul className="reason-list">
                    {positiveReasons.map((r) => (
                      <ReasonRow key={`p-${r.code}`} r={r} kind="pos" />
                    ))}
                  </ul>
                </>
              )}
              {negativeReasons.length > 0 && (
                <>
                  <h4 className="drawer-sublabel">What pulled the score down</h4>
                  <ul className="reason-list">
                    {negativeReasons.map((r) => (
                      <ReasonRow key={`n-${r.code}`} r={r} kind="neg" />
                    ))}
                  </ul>
                </>
              )}
            </details>
          </section>
        )}

        <section className="drawer-section">
          <h3 className="drawer-label">Next step</h3>
          <p className="note">{lead.suggestedNextStep}</p>
          {lead.likelyPainPoints.length > 0 && (
            <ul className="bullet-list" style={{ marginTop: 8 }}>
              {lead.likelyPainPoints.map((p, i) => (
                <li key={i}>{p}</li>
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
                <h4 className="drawer-sublabel">Automation opportunities</h4>
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
          </section>
        )}

        <RegistryEnrichment enrichment={registryEnrichment} />

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

import {
  getDashboardData,
  type AiAnalysisPanel,
  type LeadVerifiedSignal,
  type SourceRunSummary,
} from './_lib/dashboardData';
import { ReviewActions } from './_components/ReviewActions';
import { AiFeedback } from './_components/AiFeedback';
import { LeadReviewActions } from './_components/LeadReviewActions';
import { Avatar } from './_components/Avatar';
import { PriorityDonut } from './_components/PriorityDonut';
import {
  CAMPAIGN_LABEL,
  CAMPAIGN_DESCRIPTION,
  type Campaign,
} from '../src/scoring/campaignTypes';
import type { Priority, ReviewQueueRow, ScoreReason } from '../src/types';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Inline icons
// ---------------------------------------------------------------------------
const icon = {
  check: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
  ),
  trending: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
  ),
  globe: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10A15.3 15.3 0 0 1 8 12a15.3 15.3 0 0 1 4-10z" /></svg>
  ),
  zap: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
  ),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function PriorityTag({ priority }: { priority: Priority }) {
  return <span className={`priority ${priority}`}>{priority}</span>;
}

function ScoreCell({ row }: { row: ReviewQueueRow }) {
  const width = `${Math.max(0, Math.min(100, row.finalScore))}%`;
  return (
    <div>
      <div className="score-cell">
        <div className={`score-bar ${row.priority}`}>
          <span className="fill" style={{ width }} />
          <span className="threshold" style={{ left: '60%' }} />
          <span className="threshold" style={{ left: '85%' }} />
        </div>
        <span className="score-number">{row.finalScore}</span>
      </div>
      <div className="score-sub">
        rule {row.ruleScore} · intent {row.intentScore}
      </div>
    </div>
  );
}

function ReasonsList({ items, kind }: { items: ScoreReason[]; kind: 'pos' | 'neg' }) {
  if (items.length === 0) return <p className="note">No items.</p>;
  return (
    <ul className="reason-list">
      {items.map((r) => (
        <li key={`${kind}-${r.code}`} className={`reason ${kind}`}>
          <span className="delta">
            {r.delta >= 0 ? '+' : ''}
            {r.delta}
          </span>
          <span className="label">{r.label}</span>
        </li>
      ))}
    </ul>
  );
}

function SignalChips({ signals }: { signals: LeadVerifiedSignal[] }) {
  if (signals.length === 0) {
    return <p className="note">No verified signals yet — run a fresh pipeline to inspect.</p>;
  }
  return (
    <div className="signal-chips">
      {signals.map((s) => {
        const isPenalty =
          s.type === 'verified.website_failed' ||
          s.type === 'verified.has_ai_automation_language' ||
          s.type === 'verified.low_digital_maturity';
        const label = s.type.replace(/^verified\./, '').replace(/_/g, ' ');
        return (
          <span
            key={`${s.type}-${s.value}`}
            className={`signal-chip ${isPenalty ? 'neg' : 'pos'}`}
            title={s.value}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

function AiAnalysisPanelView({ panel }: { panel: AiAnalysisPanel }) {
  const totalTokens = panel.tokensInput + panel.tokensCached + panel.tokensOutput;
  return (
    <div className="ai-panel">
      <div className="ai-panel-head">
        <div>
          <div className="ai-panel-title">AI operational intelligence</div>
          <div className="ai-panel-meta">
            {panel.provider} · {panel.model} · {totalTokens} tokens · ${panel.estimatedCost.toFixed(5)}
          </div>
        </div>
        <span
          className="ai-confidence"
          title="Overall confidence (0–100)"
          data-conf={confidenceBand(panel.confidence)}
        >
          {panel.confidence}<span className="ai-confidence-suffix">/100</span>
        </span>
      </div>

      <p className="ai-summary">{panel.summary}</p>

      {panel.operationalPainPoints.length > 0 && (
        <section className="ai-section">
          <h4>Operational pain points</h4>
          <ul className="ai-list">
            {panel.operationalPainPoints.map((p) => (
              <li key={p.title}>
                <div className="ai-list-head">
                  <strong>{p.title}</strong>
                  <span className="ai-mini-conf" data-conf={confidenceBand(p.confidence)}>
                    {p.confidence}
                  </span>
                </div>
                <p>{p.description}</p>
                {p.evidence.length > 0 && (
                  <div className="ai-evidence">
                    <span className="muted">Evidence:</span>{' '}
                    {p.evidence.map((e, i) => (
                      <span key={i} className="signal-chip pos">
                        {e}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {panel.automationOpportunities.length > 0 && (
        <section className="ai-section">
          <h4>Automation opportunities</h4>
          <ul className="ai-list">
            {panel.automationOpportunities.map((o) => (
              <li key={o.title}>
                <div className="ai-list-head">
                  <strong>{o.title}</strong>
                  <span className={`tag complexity-${o.implementationComplexity}`}>
                    {o.implementationComplexity} complexity
                  </span>
                  <span className="ai-mini-conf" data-conf={confidenceBand(o.confidence)}>
                    {o.confidence}
                  </span>
                </div>
                <p>{o.description}</p>
                <p className="ai-impact">
                  <span className="muted">Impact:</span> {o.businessImpact}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="ai-meta-grid">
        <div className="ai-meta-cell">
          <span className="muted">Likely buyer</span>
          <strong>{panel.likelyBuyer.role}</strong>
          <span className="muted">{panel.likelyBuyer.reasoning}</span>
        </div>
        <div className="ai-meta-cell">
          <span className="muted">Urgency</span>
          <strong className={`urgency-${panel.urgency.level}`}>{panel.urgency.level}</strong>
          <span className="muted">{panel.urgency.reasoning}</span>
        </div>
      </div>

      {panel.proofAngles.length > 0 && (
        <section className="ai-section">
          <h4>Proof angles for outreach</h4>
          <ul className="ai-list">
            {panel.proofAngles.map((p) => (
              <li key={p.title}>
                <strong>{p.title}</strong>
                <p>{p.description}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {panel.risks.length > 0 && (
        <section className="ai-section">
          <h4>Risks &amp; objections</h4>
          <ul className="ai-risks">
            {panel.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="ai-footer">
        <AiFeedback analysisId={panel.id} current={panel.feedbackStatus} />
      </div>
    </div>
  );
}

function confidenceBand(c: number): 'high' | 'medium' | 'low' {
  if (c >= 70) return 'high';
  if (c >= 50) return 'medium';
  return 'low';
}

function fmtPct(n: number | null): string {
  if (n === null) return '—';
  return `${Math.round(n * 100)}%`;
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.round(diff / 3600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function avgFinalScore(rows: ReviewQueueRow[]): number | null {
  if (rows.length === 0) return null;
  const sum = rows.reduce((acc, r) => acc + r.finalScore, 0);
  return Math.round(sum / rows.length);
}

function domain(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default async function DashboardPage() {
  const data = await getDashboardData();
  const latestRun = data.sourceRuns[0] ?? null;
  const avg = avgFinalScore(data.reviewQueue);
  const inspectedOk = Math.max(0, data.inspection.inspected - data.inspection.failed);
  const okPct = data.inspection.inspected
    ? (inspectedOk / data.inspection.inspected) * 100
    : 0;
  const failPct = data.inspection.inspected
    ? (data.inspection.failed / data.inspection.inspected) * 100
    : 0;

  return (
    <>
      {/* ============ Topbar ============ */}
      <div className="topbar">
        <div>
          <h1>Overview</h1>
          <div className="crumbs">Pipeline · Lead intelligence</div>
        </div>
        <div className="topbar-actions">
          {latestRun && (
            <span className={`status-pill ${latestRun.status}`}>
              {latestRun.source} · {fmtRelative(latestRun.completedAt ?? latestRun.startedAt)}
            </span>
          )}
          <button type="button" className="btn btn-primary" title="Run `npm run pipeline` in your terminal">
            Run pipeline
          </button>
        </div>
      </div>

      {/* ============ Compact overview strip ============ */}
      <section className="section" id="overview">
        <div className="overview-strip">
          <div className="overview-item primary">
            <span className="overview-label">In queue</span>
            <span className="overview-value">{data.reviewQueue.length}</span>
            <span className="overview-foot priority-dots">
              <span className="dot A" /> {data.priorityCounts.A}
              <span className="dot B" style={{ marginLeft: 8 }} /> {data.priorityCounts.B}
              <span className="dot C" style={{ marginLeft: 8 }} /> {data.priorityCounts.C}
            </span>
          </div>
          <div className="overview-item">
            <span className="overview-label">Avg score</span>
            <span className="overview-value">{avg ?? '—'}</span>
            <span className="overview-foot">{data.totals.processed} processed</span>
          </div>
          <div className="overview-item">
            <span className="overview-label">Inspected</span>
            <span className="overview-value">
              {inspectedOk}
              <span className="overview-of">/{data.inspection.inspected}</span>
            </span>
            <span className="overview-foot">{data.inspection.failed} failed</span>
          </div>
          {data.ai.total > 0 && (
            <div className="overview-item">
              <span className="overview-label">AI spent today</span>
              <span className="overview-value">${data.ai.todayCostUsd.toFixed(2)}</span>
              <span className="overview-foot">of ${data.ai.dailyLimitUsd.toFixed(2)} cap</span>
            </div>
          )}
          {data.validation.falseRejectCandidates.length > 0 && (
            <a href="#diagnostics" className="overview-item overview-alert">
              <span className="overview-label">Suspicious</span>
              <span className="overview-value">{data.validation.falseRejectCandidates.length}</span>
              <span className="overview-foot">click to review</span>
            </a>
          )}
        </div>
      </section>

      {/* ============ Pipeline diagnostics (collapsed by default) ============ */}
      <section className="section" id="diagnostics">
        <details className="disclosure">
          <summary>
            Pipeline diagnostics
            <span className="summary-meta">
              Campaign distribution · AI analysis · website inspection · validation metrics · source quality
            </span>
          </summary>
          <div className="disclosure-body" style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            {/* Campaign segments */}
            <div>
              <div className="section-head" style={{ marginBottom: 'var(--space-2)' }}>
                <h3 className="section-title" style={{ fontSize: 'var(--text-xs)' }}>Campaign segments</h3>
              </div>
              <div className="campaign-grid">
                {(
                  [
                    'AI_AUTOMATION',
                    'WEB_REBUILD',
                    'FUNNEL_OPTIMIZATION',
                    'LOCAL_DIGITAL_UPGRADE',
                    'LOW_PRIORITY_NURTURE',
                    'REJECT',
                  ] as Campaign[]
                ).map((c) => (
                  <div key={c} className={`campaign-card campaign-${c}`}>
                    <div className="campaign-card-head">
                      <span className={`campaign-tag campaign-${c}`}>{CAMPAIGN_LABEL[c]}</span>
                      <span className="campaign-count">{data.campaignCounts[c]}</span>
                    </div>
                    <p className="campaign-desc">{CAMPAIGN_DESCRIPTION[c]}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Validation metrics */}
            <div>
              <div className="section-head" style={{ marginBottom: 'var(--space-2)' }}>
                <h3 className="section-title" style={{ fontSize: 'var(--text-xs)' }}>Validation metrics</h3>
                <span className="section-meta">Reviewer feedback drives the false-positive / false-reject rates</span>
              </div>
              <div className="panel">
                <table className="runs-table">
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Total</th>
                      <th>Avg score</th>
                      <th>Reviewed</th>
                      <th>Correct %</th>
                      <th>False reject %</th>
                      <th>False positive %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.validation.campaignMetrics.map((m) => (
                      <tr key={m.campaign}>
                        <td>
                          <span className={`campaign-tag campaign-${m.campaign}`}>
                            {CAMPAIGN_LABEL[m.campaign]}
                          </span>
                        </td>
                        <td className="num">{m.total}</td>
                        <td className="num">{m.avgFinalScore || '—'}</td>
                        <td className="num">{m.reviewedTotal}</td>
                        <td className="num">{fmtPct(m.correctRate)}</td>
                        <td className="num">{fmtPct(m.falseRejectRate)}</td>
                        <td className="num">{fmtPct(m.falsePositiveRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* AI / Inspection inline summaries */}
            {(data.ai.total > 0 || data.inspection.inspected > 0) && (
              <div className="diagnostics-row">
                {data.ai.total > 0 && (
                  <div className="diagnostics-cell">
                    <h3 className="section-title" style={{ fontSize: 'var(--text-xs)' }}>AI analysis</h3>
                    <p className="note" style={{ margin: '4px 0 0' }}>
                      <strong>{data.ai.ok}</strong> analyses · <strong>${data.ai.todayCostUsd.toFixed(3)}</strong> today /
                      ${data.ai.dailyLimitUsd.toFixed(2)} cap · {data.ai.failed} failed ·{' '}
                      {data.ai.feedback.approved ?? 0} approved · {data.ai.feedback.hallucination ?? 0} flagged
                    </p>
                  </div>
                )}
                {data.inspection.inspected > 0 && (
                  <div className="diagnostics-cell">
                    <h3 className="section-title" style={{ fontSize: 'var(--text-xs)' }}>Website inspection</h3>
                    <p className="note" style={{ margin: '4px 0 0' }}>
                      <strong>{inspectedOk}</strong> / {data.inspection.inspected} loaded ·{' '}
                      {data.inspection.failed} failed · {data.inspection.withContactForm} contact forms ·{' '}
                      {data.inspection.withBookingLink} booking links · {data.inspection.aiProvider} AI providers (avoid)
                    </p>
                  </div>
                )}
              </div>
            )}

            {data.validation.sourceQuality.length > 0 && (
              <div>
                <div className="section-head" style={{ marginBottom: 'var(--space-2)' }}>
                  <h3 className="section-title" style={{ fontSize: 'var(--text-xs)' }}>Source quality</h3>
                </div>
                <div className="panel">
                  <table className="runs-table">
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Total leads</th>
                        <th>Avg score</th>
                        <th>Inspection failure %</th>
                        <th>Strong opportunities</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.validation.sourceQuality.map((s) => (
                        <tr key={s.source}>
                          <td>{s.source}</td>
                          <td className="num">{s.totalLeads}</td>
                          <td className="num">{s.avgFinalScore || '—'}</td>
                          <td className="num">{fmtPct(s.inspectionFailureRate)}</td>
                          <td className="num">{s.strongOpportunities}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {data.validation.falseRejectCandidates.length > 0 && (
              <div>
                <div className="section-head" style={{ marginBottom: 'var(--space-2)' }}>
                  <h3 className="section-title" style={{ fontSize: 'var(--text-xs)' }}>
                    Suspicious leads · {data.validation.falseRejectCandidates.length} flagged for sanity check
                  </h3>
                </div>
                <div className="panel">
                  <table className="runs-table">
                    <thead>
                      <tr>
                        <th>Company</th>
                        <th>Campaign</th>
                        <th>Score</th>
                        <th>Why flagged</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.validation.falseRejectCandidates.slice(0, 20).map((c) => (
                        <tr key={c.companyId}>
                          <td>{c.company}</td>
                          <td>
                            <span className={`campaign-tag campaign-${c.primaryCampaign}`}>
                              {CAMPAIGN_LABEL[c.primaryCampaign]}
                            </span>
                          </td>
                          <td className="num">{c.finalScore}</td>
                          <td>{c.flagReason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </details>
      </section>

      {/* ============ Review queue ============ */}
      <section className="section" id="review">
        <div className="section-head">
          <h2 className="section-title">Review queue</h2>
          <span className="section-meta">
            {data.reviewQueue.length} lead{data.reviewQueue.length === 1 ? '' : 's'} · grouped by campaign
          </span>
        </div>

        <div className="panel">
          {data.reviewQueue.length === 0 ? (
            <div className="empty">
              <strong>No reviewable leads yet</strong>
              Run <code>npm run seed</code> then <code>npm run pipeline</code>.
            </div>
          ) : (
            <table className="lead-table">
              <thead>
                <tr>
                  <th className="col-campaign">Campaign</th>
                  <th>Company</th>
                  <th className="col-score">Score</th>
                  <th className="col-actions">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.reviewQueue.map((row) => {
                  const signals = data.verifiedSignalsByCompany[row.companyId] ?? [];
                  const positiveReasons = row.reasons.filter((r) => r.delta >= 0);
                  return (
                    <tr key={row.companyId}>
                      <td className="col-campaign">
                        <span className={`campaign-tag campaign-${row.primaryCampaign}`}>
                          {CAMPAIGN_LABEL[row.primaryCampaign]}
                        </span>
                        <div className="campaign-reason">{row.primaryReason}</div>
                      </td>
                      <td>
                        <div className="company-cell">
                          <Avatar name={row.company} />
                          <div className="company-text">
                            <div className="lead-name">{row.company}</div>
                            <div className="lead-sub">
                              {row.website ? (
                                <a href={row.website} target="_blank" rel="noreferrer">
                                  {domain(row.website)}
                                </a>
                              ) : (
                                <span>no website</span>
                              )}
                              {row.location && <span>· {row.location}</span>}
                            </div>
                            <div className="tag-row">
                              {row.industry && <span className="tag">{row.industry}</span>}
                              <span className="tag">{row.source}</span>
                            </div>
                            {data.aiByCompany[row.companyId] && (
                              <details className="row-details">
                                <summary>
                                  AI analysis ·{' '}
                                  <span className="muted">
                                    confidence{' '}
                                    {data.aiByCompany[row.companyId].confidence}
                                  </span>
                                </summary>
                                <AiAnalysisPanelView
                                  panel={data.aiByCompany[row.companyId]}
                                />
                              </details>
                            )}
                            <details className="row-details">
                              <summary>Why this score</summary>
                              <div className="row-details-body">
                                <div className="detail-group">
                                  <h4>What worked</h4>
                                  <ReasonsList items={positiveReasons} kind="pos" />
                                </div>
                                <div className="detail-group">
                                  <h4>What pulled the score down</h4>
                                  <ReasonsList items={row.rejectionReasons} kind="neg" />
                                </div>
                                <div className="detail-group">
                                  <h4>Verified website signals</h4>
                                  <SignalChips signals={signals} />
                                </div>
                                <div className="detail-group">
                                  <h4>Next step</h4>
                                  <p className="note">{row.suggestedNextStep}</p>
                                  {row.likelyPainPoints.length > 0 && (
                                    <>
                                      <h4 style={{ marginTop: 12 }}>Likely pain points</h4>
                                      <ul className="reason-list">
                                        {row.likelyPainPoints.map((p, i) => (
                                          <li key={i} className="reason pos">
                                            <span className="delta">·</span>
                                            <span className="label">{p}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </>
                                  )}
                                </div>
                                <div className="detail-group" style={{ gridColumn: '1 / -1' }}>
                                  <LeadReviewActions
                                    companyId={row.companyId}
                                    primaryCampaign={row.primaryCampaign}
                                    currentReview={data.validation.reviewByCompany[row.companyId] ?? null}
                                  />
                                </div>
                              </div>
                            </details>
                          </div>
                        </div>
                      </td>
                      <td className="col-score">
                        <ScoreCell row={row} />
                      </td>
                      <td className="col-actions">
                        <ReviewActions companyId={row.companyId} status={row.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ============ Collapsed sections ============ */}
      <section className="section" id="sources">
        <details className="disclosure">
          <summary>
            Recent source runs
            <span className="summary-meta">
              {data.sourceRuns.length} run{data.sourceRuns.length === 1 ? '' : 's'} recorded
            </span>
          </summary>
          <div className="disclosure-body">
            {data.sourceRuns.length === 0 ? (
              <div className="empty">No source runs recorded yet.</div>
            ) : (
              <table className="runs-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Started</th>
                    <th>Duration</th>
                    <th>Found</th>
                    <th>Accepted</th>
                    <th>API calls</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sourceRuns.map((run: SourceRunSummary) => (
                    <tr key={run.id}>
                      <td><span className="tag">{run.source}</span></td>
                      <td><span className={`status-pill ${run.status}`}>{run.status}</span></td>
                      <td>{fmtTime(run.startedAt)}</td>
                      <td className="num">{fmtDuration(run.durationMs)}</td>
                      <td className="num">{run.leadsFound}</td>
                      <td className="num">{run.leadsAccepted}</td>
                      <td className="num">{run.apiCalls}</td>
                      <td>
                        {run.errors.length === 0 ? (
                          <span>—</span>
                        ) : (
                          <details>
                            <summary>{run.errors.length} note{run.errors.length === 1 ? '' : 's'}</summary>
                            <ul className="reason-list">
                              {run.errors.map((e, i) => (
                                <li key={i} className="reason neg">
                                  <span className="delta">·</span>
                                  <span className="label">{e}</span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </details>

        {data.rejected.length > 0 && (
          <details className="disclosure" id="rejected">
            <summary>
              True rejects
              <span className="summary-meta">
                {data.rejected.length} disqualified — enterprise, hobby, internal automation team, or hard-reject industry
              </span>
            </summary>
            <div className="disclosure-body">
              <table className="runs-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Industry</th>
                    <th>Final</th>
                    <th>Why rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rejected.map((row) => (
                    <tr key={row.companyId}>
                      <td>
                        <div className="company-cell">
                          <Avatar name={row.company} size={28} />
                          <strong style={{ color: 'var(--text)' }}>{row.company}</strong>
                        </div>
                      </td>
                      <td>{row.industry ?? '—'}</td>
                      <td className="num">{row.finalScore}</td>
                      <td>
                        {row.rejectionReasons.length === 0 ? (
                          <span>Below final-score threshold ({row.finalScore})</span>
                        ) : (
                          <ul className="reason-list">
                            {row.rejectionReasons.slice(0, 3).map((r) => (
                              <li key={r.code} className="reason neg">
                                <span className="delta">{r.delta}</span>
                                <span className="label">{r.label}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>
    </>
  );
}

import Link from 'next/link';
import {
  getContactsForLead,
  getDashboardData,
  getEvidenceForLead,
  getIntelligenceForLead,
  getIntelligenceSummariesByCompany,
  type SourceRunSummary,
} from './_lib/dashboardData';
import { ReviewActions } from './_components/ReviewActions';
import { LeadDrawer } from './_components/LeadDrawer';
import { Avatar } from './_components/Avatar';
import {
  CAMPAIGN_LABEL,
  CAMPAIGN_DESCRIPTION,
  type Campaign,
} from '../src/scoring/campaignTypes';
import type { Priority, ReviewQueueRow } from '../src/types';

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
  const finalWidth = `${Math.max(0, Math.min(100, row.finalScore))}%`;
  return (
    <div className="score-cell">
      <div className={`score-bar ${row.priority}`}>
        <span className="fill" style={{ width: finalWidth }} />
      </div>
      <span className="score-number">{row.finalScore}</span>
    </div>
  );
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
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string }>;
}) {
  const params = await searchParams;
  const data = await getDashboardData();
  const intelligenceByCompany = getIntelligenceSummariesByCompany();
  const selectedLeadId = params.lead ?? null;
  const selectedLead = selectedLeadId
    ? data.reviewQueue.find((r) => r.companyId === selectedLeadId) ??
      data.rejected.find((r) => r.companyId === selectedLeadId) ??
      null
    : null;
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
      {/* ============ Topbar — title only, no fake CTA ============ */}
      <header className="topbar">
        <div className="topbar-title">
          <h1>Overview</h1>
          <div className="topbar-stats">
            {data.reviewQueue.length} leads · {data.priorityCounts.A}A · {data.priorityCounts.B}B · {data.priorityCounts.C}C · avg {avg ?? '—'}
            {data.inspection.inspected > 0 && <> · {inspectedOk}/{data.inspection.inspected} inspected</>}
            {data.ai.total > 0 && <> · ${data.ai.todayCostUsd.toFixed(2)} AI</>}
            {data.validation.falseRejectCandidates.length > 0 && (
              <> · <a href="#diagnostics" className="topbar-alert">{data.validation.falseRejectCandidates.length} flagged</a></>
            )}
          </div>
        </div>
        {latestRun && (
          <span className={`status-pill ${latestRun.status}`}>
            {latestRun.source} · {fmtRelative(latestRun.completedAt ?? latestRun.startedAt)}
          </span>
        )}
      </header>

      {/* ============ Discovery (collapsed) ============ */}
      <section className="section" id="discovery">
        <details className="disclosure">
          <summary>
            Discovery
            <span className="summary-meta">
              {data.discovery.totalValid} valid · {data.discovery.totalDeduped} dup · {data.discovery.totalRejected} rej · last 24h: {data.discovery.domainsToday} raw
            </span>
          </summary>
          <div className="disclosure-body" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Top-line throughput */}
            <div className="discovery-strip">
              <div className="discovery-stat">
                <span className="discovery-stat-label">Valid (24h)</span>
                <span className="discovery-stat-value">{data.discovery.validToday}</span>
                <span className="discovery-stat-foot">
                  of {data.discovery.domainsToday} raw ·{' '}
                  {data.discovery.validationPassRateToday !== null
                    ? `${Math.round(data.discovery.validationPassRateToday * 100)}% pass`
                    : '—'}
                </span>
              </div>
              <div className="discovery-stat">
                <span className="discovery-stat-label">All time valid</span>
                <span className="discovery-stat-value">{data.discovery.totalValid}</span>
                <span className="discovery-stat-foot">{data.discovery.totalRuns} runs</span>
              </div>
              <div className="discovery-stat">
                <span className="discovery-stat-label">Deduped</span>
                <span className="discovery-stat-value">{data.discovery.totalDeduped}</span>
                <span className="discovery-stat-foot">
                  {data.discovery.totalRawFound > 0
                    ? `${Math.round((data.discovery.totalDeduped / data.discovery.totalRawFound) * 100)}% of raw`
                    : '—'}
                </span>
              </div>
              <div className="discovery-stat">
                <span className="discovery-stat-label">Rejected</span>
                <span className="discovery-stat-value">{data.discovery.totalRejected}</span>
                <span className="discovery-stat-foot">parking · aggregator · dead</span>
              </div>
            </div>

            {/* By source */}
            {Object.keys(data.discovery.bySource).length > 0 && (
              <div>
                <h3 className="section-title" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-2)' }}>By source</h3>
                <table className="runs-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Valid</th>
                      <th>Rejected</th>
                      <th>Duplicate</th>
                      <th>Pass rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.discovery.bySource)
                      .sort((a, b) => b[1].valid - a[1].valid)
                      .map(([src, s]) => {
                        const total = s.valid + s.rejected + s.deduped;
                        return (
                          <tr key={src}>
                            <td><span className="tag">{src}</span></td>
                            <td className="num">{s.valid}</td>
                            <td className="num">{s.rejected}</td>
                            <td className="num">{s.deduped}</td>
                            <td className="num">{total > 0 ? `${Math.round((s.valid / total) * 100)}%` : '—'}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Top failures */}
            {data.discovery.topFailures.length > 0 && (
              <div>
                <h3 className="section-title" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-2)' }}>Top rejection reasons</h3>
                <ul className="reason-list">
                  {data.discovery.topFailures.map((f) => (
                    <li key={f.reason} className="reason neg">
                      <span className="delta">{f.count}</span>
                      <span className="label">{f.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      </section>

      {/* ============ Pipeline diagnostics (collapsed by default) ============ */}
      <section className="section" id="diagnostics">
        <details className="disclosure">
          <summary>
            Diagnostics
            <span className="summary-meta">Validation · inspection · AI cost</span>
          </summary>
          <div className="disclosure-body" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
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
            <table className="lead-table compact">
              <thead>
                <tr>
                  <th className="col-campaign-compact" aria-label="Campaign" />
                  <th>Company</th>
                  <th className="col-score">Score</th>
                  <th className="col-actions">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.reviewQueue.map((row) => {
                  const isSelected = row.companyId === selectedLeadId;
                  const reviewMark = data.validation.reviewByCompany[row.companyId];
                  const intel = intelligenceByCompany[row.companyId];
                  return (
                    <tr
                      key={row.companyId}
                      className={isSelected ? 'lead-row selected' : 'lead-row'}
                    >
                      <td className="col-campaign-compact">
                        <span
                          className={`campaign-dot campaign-${row.primaryCampaign}`}
                          title={CAMPAIGN_LABEL[row.primaryCampaign]}
                        />
                      </td>
                      <td className="col-company-compact">
                        <Link
                          href={`?lead=${row.companyId}`}
                          scroll={false}
                          className="company-link"
                        >
                          <Avatar name={row.company} size={22} />
                          <div className="company-line">
                            <div className="lead-name-compact">
                              {row.company}
                              {intel && (
                                <span
                                  className={`attention-pill attention-${intel.humanAttentionPriority}`}
                                  title={`Opportunity ${intel.opportunityScore} · ${intel.likelyProjectType}`}
                                >
                                  {intel.humanAttentionPriority}
                                </span>
                              )}
                              {reviewMark && (
                                <span className={`row-review-dot review-${reviewMark}`} title={reviewMark.replace(/_/g, ' ')} />
                              )}
                            </div>
                            <div className="lead-sub-compact">
                              {domain(row.website) ?? 'no website'}
                              {row.industry && <span> · {row.industry}</span>}
                              {row.location && <span> · {row.location}</span>}
                            </div>
                          </div>
                        </Link>
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

      {/* ============ Rejected (collapsed) ============ */}
      <section className="section" id="sources">
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

      {selectedLead && (
        <LeadDrawer
          lead={selectedLead}
          signals={data.verifiedSignalsByCompany[selectedLead.companyId] ?? []}
          ai={data.aiByCompany[selectedLead.companyId]}
          currentReview={data.validation.reviewByCompany[selectedLead.companyId] ?? null}
          contacts={getContactsForLead(selectedLead.companyId)}
          evidence={getEvidenceForLead(selectedLead.companyId)}
          intelligence={getIntelligenceForLead(selectedLead.companyId)}
        />
      )}
    </>
  );
}

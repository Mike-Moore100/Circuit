import {
  getDashboardData,
  type LeadVerifiedSignal,
  type SourceRunSummary,
} from './_lib/dashboardData';
import { ReviewActions } from './_components/ReviewActions';
import { Avatar } from './_components/Avatar';
import { PriorityDonut } from './_components/PriorityDonut';
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

      {/* ============ Hero pipeline card ============ */}
      <section className="section" id="overview">
        <div className="hero">
          <div>
            <div className="hero-stat-label">In review queue</div>
            <div className="hero-stat-value">{data.reviewQueue.length}</div>
            <div className="hero-stat-foot">
              <span>
                {data.totals.accepted} accepted · {data.totals.rejected} rejected · avg score{' '}
                <strong style={{ color: 'var(--text)' }}>{avg ?? '—'}</strong>
              </span>
              {data.priorityCounts.A > 0 && (
                <span className="hero-trend">
                  {icon.trending}
                  {data.priorityCounts.A} priority A
                </span>
              )}
            </div>
          </div>
          <div className="hero-divider" aria-hidden />
          <div style={{ display: 'flex', gap: 'var(--space-6)', alignItems: 'center' }}>
            <PriorityDonut counts={data.priorityCounts} />
            <div className="donut-legend">
              {(['A', 'B', 'C', 'Reject'] as Priority[]).map((key) => (
                <div key={key} className={`legend-row ${key}`}>
                  <span className="legend-key">
                    {key === 'Reject' ? 'Reject' : `Priority ${key}`}
                  </span>
                  <span className="legend-value">{data.priorityCounts[key]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ============ Secondary stats ============ */}
      <section className="section">
        <div className="stats-grid">
          <div className="stat">
            <span className="stat-icon">{icon.check}</span>
            <span className="stat-label">Leads processed</span>
            <span className="stat-value">{data.totals.processed}</span>
            <span className="stat-foot">
              {data.totals.accepted} accepted · {data.totals.rejected} rejected
            </span>
          </div>
          <div className="stat">
            <span className="stat-icon" style={{ background: 'rgba(99, 102, 241, 0.1)', color: 'var(--accent)' }}>
              {icon.globe}
            </span>
            <span className="stat-label">Website verification</span>
            <span className="stat-value">
              {inspectedOk}
              <span style={{ color: 'var(--text-subtle)', fontWeight: 500, fontSize: 18 }}>
                {' '}
                / {data.inspection.inspected}
              </span>
            </span>
            <span className="stat-foot">
              <span className="verification-bar" title={`${inspectedOk} ok · ${data.inspection.failed} failed`}>
                <span className="ok" style={{ width: `${okPct}%` }} />
                <span className="fail" style={{ width: `${failPct}%` }} />
              </span>
            </span>
            <span className="stat-foot" style={{ marginTop: -4 }}>
              {data.inspection.failed} failed · {data.inspection.aiProvider} AI provider
            </span>
          </div>
          <div className="stat">
            <span className="stat-icon" style={{ background: 'rgba(5, 150, 105, 0.1)', color: 'var(--success)' }}>
              {icon.zap}
            </span>
            <span className="stat-label">Quality signals</span>
            <span className="stat-value">
              {data.inspection.withContactForm + data.inspection.withBookingLink + data.inspection.highAutomationFit}
            </span>
            <span className="stat-foot">
              {data.inspection.withContactForm} contact · {data.inspection.withBookingLink} booking ·{' '}
              {data.inspection.highAutomationFit} high-fit
            </span>
          </div>
        </div>
      </section>

      {/* ============ Review queue ============ */}
      <section className="section" id="review">
        <div className="section-head">
          <h2 className="section-title">Review queue</h2>
          <span className="section-meta">
            {data.reviewQueue.length} lead{data.reviewQueue.length === 1 ? '' : 's'} · sorted by score
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
                  <th className="col-priority">Priority</th>
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
                      <td className="col-priority">
                        <PriorityTag priority={row.priority} />
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
              Rejected leads
              <span className="summary-meta">
                {data.rejected.length} below the review threshold
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

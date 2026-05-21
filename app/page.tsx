import {
  getDashboardData,
  type LeadVerifiedSignal,
  type SourceRunSummary,
} from './_lib/dashboardData';
import { ReviewActions } from './_components/ReviewActions';
import type { ReviewQueueRow, ScoreReason } from '../src/types';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Small presentational helpers (kept inline; they're trivial and used once)
// ---------------------------------------------------------------------------

function PriorityTag({ priority }: { priority: ReviewQueueRow['priority'] }) {
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
  if (items.length === 0) {
    return <p className="note">No items.</p>;
  }
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">C</div>
          <div>
            <div className="brand-title">Circuit</div>
            <div className="brand-subtitle">Lead sourcing &amp; opportunity intelligence</div>
          </div>
        </div>
        <div className="header-meta">
          <div className="meta-item">
            <span className="meta-label">Last run</span>
            <span className="meta-value">{fmtRelative(latestRun?.completedAt ?? latestRun?.startedAt ?? null)}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Pipeline</span>
            <span className="meta-value">
              <code>npm run pipeline</code>
            </span>
          </div>
        </div>
      </header>

      {/* ============ Overview stats ============ */}
      <section className="section">
        <div className="stats-grid">
          <div className="stat">
            <span className="stat-label">Leads processed</span>
            <span className="stat-value">{data.totals.processed}</span>
            <span className="stat-foot">
              {data.totals.accepted} accepted · {data.totals.rejected} rejected
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">In review queue</span>
            <span className="stat-value">{data.reviewQueue.length}</span>
            <span className="stat-foot">
              <span className="priority-dots" title="A / B / C">
                <span className="dot A" />
                {data.priorityCounts.A}
                <span className="dot B" style={{ marginLeft: 6 }} />
                {data.priorityCounts.B}
                <span className="dot C" style={{ marginLeft: 6 }} />
                {data.priorityCounts.C}
              </span>
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Avg final score</span>
            <span className="stat-value">{avg ?? '—'}</span>
            <span className="stat-foot">across {data.reviewQueue.length || 0} queued leads</span>
          </div>
          <div className="stat">
            <span className="stat-label">Website verification</span>
            <span className="stat-value">
              {inspectedOk}
              <span style={{ color: 'var(--text-subtle)', fontWeight: 500, fontSize: 14 }}>
                {' '}
                / {data.inspection.inspected}
              </span>
            </span>
            <span className="stat-foot">
              <span
                className="verification-bar"
                title={`${inspectedOk} ok · ${data.inspection.failed} failed`}
              >
                <span
                  className="ok"
                  style={{
                    width: data.inspection.inspected
                      ? `${(inspectedOk / data.inspection.inspected) * 100}%`
                      : '0%',
                  }}
                />
                <span
                  className="fail"
                  style={{
                    width: data.inspection.inspected
                      ? `${(data.inspection.failed / data.inspection.inspected) * 100}%`
                      : '0%',
                  }}
                />
              </span>
              {data.inspection.failed} failed · {data.inspection.aiProvider} AI provider
            </span>
          </div>
        </div>
      </section>

      {/* ============ Review queue ============ */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Review queue</h2>
          <span className="section-meta">
            {data.reviewQueue.length} lead{data.reviewQueue.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="panel">
          {data.reviewQueue.length === 0 ? (
            <div className="empty">
              <strong>No reviewable leads yet</strong>
              Run <code>npm run seed</code> then <code>npm run pipeline</code> to populate the
              queue.
            </div>
          ) : (
            <table className="lead-table">
              <thead>
                <tr>
                  <th className="col-priority">Priority</th>
                  <th>Company</th>
                  <th className="col-score">Score</th>
                  <th className="col-actions">Actions</th>
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

      {/* ============ Collapsed: latest pipeline + rejected ============ */}
      <section className="section">
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
                      <td>
                        <span className="tag">{run.source}</span>
                      </td>
                      <td>
                        <span className={`status-pill ${run.status}`}>{run.status}</span>
                      </td>
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
          <details className="disclosure">
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
                        <strong style={{ color: 'var(--text)' }}>{row.company}</strong>
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
    </div>
  );
}

import { getDashboardData, type SourceRunSummary } from './_lib/dashboardData';
import { ReviewActions } from './_components/ReviewActions';
import type { ReviewQueueRow } from '../src/types';

export const dynamic = 'force-dynamic';

function PriorityPill({ priority }: { priority: ReviewQueueRow['priority'] }) {
  return <span className={`pill ${priority}`}>{priority}</span>;
}

function ReasonList({ row }: { row: ReviewQueueRow }) {
  const positive = row.reasons.filter((r) => r.delta >= 0).slice(0, 4);
  const negative = row.rejectionReasons.slice(0, 4);
  return (
    <ul className="reasons">
      {positive.map((r) => (
        <li key={`p-${r.code}`} className="pos">
          +{r.delta} · {r.label}
        </li>
      ))}
      {negative.map((r) => (
        <li key={`n-${r.code}`} className="neg">
          {r.delta} · {r.label}
        </li>
      ))}
    </ul>
  );
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function SourceRunRow({ run }: { run: SourceRunSummary }) {
  return (
    <tr>
      <td>{run.source}</td>
      <td>
        <span className={`status-tag status-${run.status}`}>{run.status}</span>
      </td>
      <td className="muted">{fmtTime(run.startedAt)}</td>
      <td className="muted">{fmtTime(run.completedAt)}</td>
      <td className="score">{fmtDuration(run.durationMs)}</td>
      <td className="score">{run.leadsFound}</td>
      <td className="score">{run.leadsAccepted}</td>
      <td className="score">{run.leadsRejected}</td>
      <td className="score">{run.apiCalls}</td>
      <td>
        {run.errors.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <details>
            <summary>{run.errors.length} note{run.errors.length === 1 ? '' : 's'}</summary>
            <ul className="reasons">
              {run.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </details>
        )}
      </td>
    </tr>
  );
}

export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <main>
      <h1>Circuit — Lead Review</h1>
      <p className="subtitle">
        Internal operator view. Run <code>npm run pipeline</code> or{' '}
        <code>npm run pipeline:google-maps</code> to refresh.
      </p>

      <div className="cards">
        <div className="card">
          <div className="label">Total processed</div>
          <div className="value">{data.totals.processed}</div>
        </div>
        <div className="card">
          <div className="label">Accepted</div>
          <div className="value">{data.totals.accepted}</div>
        </div>
        <div className="card">
          <div className="label">Rejected</div>
          <div className="value">{data.totals.rejected}</div>
        </div>
        <div className="card A">
          <div className="label">Priority A</div>
          <div className="value">{data.priorityCounts.A}</div>
        </div>
        <div className="card B">
          <div className="label">Priority B</div>
          <div className="value">{data.priorityCounts.B}</div>
        </div>
        <div className="card C">
          <div className="label">Priority C</div>
          <div className="value">{data.priorityCounts.C}</div>
        </div>
      </div>

      <h2>Source runs</h2>
      {data.sourceRuns.length === 0 ? (
        <div className="empty">No source runs recorded yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Status</th>
              <th>Started</th>
              <th>Completed</th>
              <th>Duration</th>
              <th>Found</th>
              <th>Accepted</th>
              <th>Rejected</th>
              <th>API calls</th>
              <th>Errors / notes</th>
            </tr>
          </thead>
          <tbody>
            {data.sourceRuns.map((run) => (
              <SourceRunRow key={run.id} run={run} />
            ))}
          </tbody>
        </table>
      )}

      <h2>Review queue</h2>
      {data.reviewQueue.length === 0 ? (
        <div className="empty">
          No reviewable leads yet. Run <code>npm run seed</code> then <code>npm run pipeline</code>.
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Priority</th>
              <th>Company</th>
              <th>Industry</th>
              <th>Source</th>
              <th>Rule</th>
              <th>Intent</th>
              <th>Final</th>
              <th>Actions</th>
              <th>Score breakdown / next step</th>
            </tr>
          </thead>
          <tbody>
            {data.reviewQueue.map((row) => (
              <tr key={row.companyId}>
                <td>
                  <PriorityPill priority={row.priority} />
                </td>
                <td>
                  <strong>{row.company}</strong>
                  <br />
                  {row.website ? (
                    <a href={row.website} target="_blank" rel="noreferrer">
                      {row.website}
                    </a>
                  ) : (
                    <span className="muted">no website</span>
                  )}
                </td>
                <td className="muted">{row.industry ?? '—'}</td>
                <td className="muted">{row.source}</td>
                <td className="score">{row.ruleScore}</td>
                <td className="score">{row.intentScore}</td>
                <td className="score">{row.finalScore}</td>
                <td>
                  <ReviewActions companyId={row.companyId} status={row.status} />
                </td>
                <td>
                  <ReasonList row={row} />
                  <details>
                    <summary>Likely pain points / next step</summary>
                    <ul className="reasons">
                      {row.likelyPainPoints.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                      <li>
                        <em>Next:</em> {row.suggestedNextStep}
                      </li>
                    </ul>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data.rejected.length > 0 && (
        <>
          <h2>Rejected (latest run)</h2>
          <table>
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
                  <td>{row.company}</td>
                  <td className="muted">{row.industry ?? '—'}</td>
                  <td className="score">{row.finalScore}</td>
                  <td>
                    <ul className="reasons">
                      {row.rejectionReasons.map((r) => (
                        <li key={r.code} className="neg">
                          {r.delta} · {r.label}
                        </li>
                      ))}
                      {row.rejectionReasons.length === 0 && (
                        <li className="muted">Below final score threshold ({row.finalScore})</li>
                      )}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}

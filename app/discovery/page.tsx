// Discovery — top-of-funnel operational view. Throughput, per-source
// quality, validation pass rate, dedupe rate, recent runs.

import { PageHeader } from '../_components/PageHeader';
import { StatStrip } from '../_components/StatStrip';
import { getDiscoveryPageData } from '../_lib/pageData';

export const dynamic = 'force-dynamic';

function pct(n: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((n / total) * 100)}%`;
}

export default async function DiscoveryPage() {
  const { stats, recentRuns } = getDiscoveryPageData();
  const passRate24h =
    stats.domainsToday > 0
      ? `${Math.round((stats.validToday / stats.domainsToday) * 100)}% pass`
      : '—';

  return (
    <>
      <PageHeader
        title="Discovery"
        subtitle="Top-of-funnel SERP + directory throughput. Validated domains feed the promotion queue."
      />

      <section className="section">
        <StatStrip
          items={[
            {
              label: 'Valid (24h)',
              value: stats.validToday,
              foot: `of ${stats.domainsToday} raw · ${passRate24h}`,
              tone: 'accent',
            },
            {
              label: 'All-time valid',
              value: stats.totalValid,
              foot: `${stats.totalRuns} runs`,
            },
            {
              label: 'Deduped',
              value: stats.totalDeduped,
              foot:
                stats.totalRawFound > 0
                  ? `${Math.round((stats.totalDeduped / stats.totalRawFound) * 100)}% of raw`
                  : '—',
            },
            {
              label: 'Rejected',
              value: stats.totalRejected,
              foot: 'parking · aggregator · dead',
              tone: 'warning',
            },
          ]}
        />
      </section>

      {Object.keys(stats.bySource).length > 0 && (
        <section className="section">
          <h2 className="section-title">By source</h2>
          <div className="panel">
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
                {Object.entries(stats.bySource)
                  .sort((a, b) => b[1].valid - a[1].valid)
                  .map(([src, s]) => {
                    const total = s.valid + s.rejected + s.deduped;
                    return (
                      <tr key={src}>
                        <td><span className="tag">{src}</span></td>
                        <td className="num">{s.valid}</td>
                        <td className="num">{s.rejected}</td>
                        <td className="num">{s.deduped}</td>
                        <td className="num">{pct(s.valid, total)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {Object.keys(stats.validationFailures).length > 0 && (
        <section className="section">
          <h2 className="section-title">Top rejection reasons</h2>
          <ul className="reason-list">
            {Object.entries(stats.validationFailures)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 8)
              .map(([reason, count]) => (
                <li key={reason} className="reason neg">
                  <span className="delta">{count}</span>
                  <span className="label">{reason}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      <section className="section">
        <h2 className="section-title">Recent runs</h2>
        <div className="panel">
          {recentRuns.length === 0 ? (
            <div className="empty">
              <strong>No discovery runs yet</strong>
              Run <code>npm run run:discovery</code> or hit{' '}
              <code>POST /api/services/run-discovery</code>.
            </div>
          ) : (
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Source</th>
                  <th>Raw</th>
                  <th>Valid</th>
                  <th>Dup</th>
                  <th>Rejected</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.started_at).toLocaleString()}</td>
                    <td><span className="tag">{r.source}</span></td>
                    <td className="num">{r.raw_found}</td>
                    <td className="num">{r.valid_domains}</td>
                    <td className="num">{r.deduped}</td>
                    <td className="num">{r.rejected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}

// Queue Monitor — live qualification queue depth, throughput, failures.
// Shows the bridge between discovery and qualification in operational
// terms.

import { PageHeader } from '../_components/PageHeader';
import { StatStrip } from '../_components/StatStrip';
import { getQueuePageData } from '../_lib/pageData';

export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  const { stats, pending, processing, failed } = getQueuePageData();
  const totalActive =
    (stats.byStatus.PENDING ?? 0) + (stats.byStatus.PROCESSING ?? 0);

  return (
    <>
      <PageHeader
        title="Queue Monitor"
        subtitle="Promotion gate → qualification pipeline. Live state of every domain in flight."
      />

      <section className="section">
        <StatStrip
          items={[
            {
              label: 'Active',
              value: totalActive,
              foot: 'pending + processing',
              tone: totalActive > 50 ? 'warning' : 'default',
            },
            {
              label: 'Promoted',
              value: stats.byStatus.PROMOTED ?? 0,
              foot: `${stats.recent24hPromoted} in last 24h`,
              tone: 'success',
            },
            {
              label: 'Skipped',
              value: stats.byStatus.SKIPPED ?? 0,
              foot: `${stats.recent24hSkipped} in last 24h`,
            },
            {
              label: 'Failed',
              value: stats.byStatus.FAILED ?? 0,
              foot: `${stats.recent24hFailed} in last 24h`,
              tone: (stats.byStatus.FAILED ?? 0) > 0 ? 'danger' : 'default',
            },
          ]}
        />
      </section>

      {pending.length > 0 && (
        <section className="section">
          <h2 className="section-title">Pending — awaiting qualification ({pending.length})</h2>
          <div className="panel">
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Domain</th>
                  <th>Source</th>
                  <th>Reason</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((r) => (
                  <tr key={r.id}>
                    <td className="num">{r.priority}</td>
                    <td>{r.domain}</td>
                    <td><span className="tag">{r.source}</span></td>
                    <td>{r.promotion_reason}</td>
                    <td>{new Date(r.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {processing.length > 0 && (
        <section className="section">
          <h2 className="section-title">Processing now ({processing.length})</h2>
          <div className="panel">
            <table className="runs-table">
              <thead>
                <tr><th>Domain</th><th>Source</th><th>Started</th></tr>
              </thead>
              <tbody>
                {processing.map((r) => (
                  <tr key={r.id}>
                    <td>{r.domain}</td>
                    <td><span className="tag">{r.source}</span></td>
                    <td>{new Date(r.updated_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {failed.length > 0 && (
        <section className="section">
          <h2 className="section-title">Recent failures ({failed.length})</h2>
          <div className="panel">
            <table className="runs-table">
              <thead>
                <tr><th>Domain</th><th>Source</th><th>Reason</th></tr>
              </thead>
              <tbody>
                {failed.map((r) => (
                  <tr key={r.id}>
                    <td>{r.domain}</td>
                    <td><span className="tag">{r.source}</span></td>
                    <td>{r.error_message ?? r.promotion_reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {pending.length === 0 && processing.length === 0 && failed.length === 0 && (
        <section className="section">
          <div className="panel">
            <div className="empty">
              <strong>Queue is clear</strong>
              No items currently pending, processing, or failed. Run{' '}
              <code>npm run run:promotion</code> to evaluate new discoveries.
            </div>
          </div>
        </section>
      )}

      {stats.topPromotionReasons.length > 0 && (
        <section className="section">
          <h2 className="section-title">Top promotion reasons</h2>
          <ul className="reason-list">
            {stats.topPromotionReasons.map((r) => (
              <li key={r.reason} className="reason pos">
                <span className="delta">{r.count}</span>
                <span className="label">{r.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// Queue Monitor — pipeline health. Pending / Processing / Failed only.
// Promotion reasons moved to Discovery (where the operator thinks
// about source quality); skip reasons there too.

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
        subtitle="Promotion → qualification pipeline state. Pending, processing, failed."
      />

      <section className="section">
        <StatStrip
          items={[
            {
              label: 'Active',
              value: totalActive,
              foot: `${stats.byStatus.PENDING ?? 0} pending · ${stats.byStatus.PROCESSING ?? 0} processing`,
              tone: totalActive > 50 ? 'warning' : 'default',
            },
            {
              label: 'Promoted (24h)',
              value: stats.recent24hPromoted,
              tone: 'success',
            },
            {
              label: 'Failed (24h)',
              value: stats.recent24hFailed,
              tone: stats.recent24hFailed > 0 ? 'danger' : 'default',
            },
          ]}
        />
      </section>

      {totalActive === 0 && failed.length === 0 && (
        <section className="section">
          <div className="panel">
            <div className="empty">
              <strong>Queue is clear</strong>
              Nothing pending, processing, or failed. Run{' '}
              <code>npm run run:promotion</code> to evaluate new discoveries.
            </div>
          </div>
        </section>
      )}

      {pending.length > 0 && (
        <section className="section">
          <h2 className="section-title">Pending ({pending.length})</h2>
          <div className="panel">
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Domain</th>
                  <th>Source</th>
                  <th>Promoted</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((r) => (
                  <tr key={r.id}>
                    <td className="num">{r.priority}</td>
                    <td>{r.domain}</td>
                    <td><span className="tag">{r.source}</span></td>
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
          <h2 className="section-title">Processing ({processing.length})</h2>
          <div className="panel">
            <table className="runs-table">
              <thead>
                <tr><th>Domain</th><th>Source</th><th>Since</th></tr>
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
          <h2 className="section-title">Failed ({failed.length})</h2>
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
    </>
  );
}

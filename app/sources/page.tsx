// Sources — pipeline source connector health. Discovery connector
// quality lives on the Discovery page (that's where the operator
// actually thinks about it); this page is about the pipeline source
// runs (Google Maps, mock, etc.) — their fetch volume and failure
// patterns.

import { PageHeader } from '../_components/PageHeader';
import { StatStrip } from '../_components/StatStrip';
import { getSourcesPageData } from '../_lib/pageData';

export const dynamic = 'force-dynamic';

export default async function SourcesPage() {
  const { recent } = getSourcesPageData();
  const totalCalls = recent.reduce((acc, r) => acc + r.api_calls, 0);
  const failed = recent.filter((r) => r.status === 'failed').length;
  const fresh = recent[0];

  return (
    <>
      <PageHeader
        title="Sources"
        subtitle="Pipeline source connector health. Discovery connector quality lives on Discovery."
      />

      <section className="section">
        <StatStrip
          items={[
            { label: 'Recent runs', value: recent.length },
            { label: 'API calls', value: totalCalls },
            {
              label: 'Failures',
              value: failed,
              tone: failed > 0 ? 'warning' : 'default',
            },
            {
              label: 'Last run',
              value: fresh ? new Date(fresh.started_at).toLocaleDateString() : '—',
              foot: fresh ? fresh.source : 'no runs yet',
            },
          ]}
        />
      </section>

      <section className="section">
        <h2 className="section-title">Recent pipeline runs</h2>
        <div className="panel">
          {recent.length === 0 ? (
            <div className="empty">
              <strong>No pipeline runs recorded</strong>
              Run <code>npm run seed</code> or <code>npm run pipeline:google-maps</code>.
            </div>
          ) : (
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Found</th>
                  <th>Accepted</th>
                  <th>Rejected</th>
                  <th>API calls</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td><span className="tag">{r.source}</span></td>
                    <td>
                      <span className={`status-pill ${r.status}`}>{r.status}</span>
                    </td>
                    <td>{new Date(r.started_at).toLocaleString()}</td>
                    <td className="num">{r.leads_found}</td>
                    <td className="num">{r.leads_accepted}</td>
                    <td className="num">{r.leads_rejected}</td>
                    <td className="num">{r.api_calls}</td>
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

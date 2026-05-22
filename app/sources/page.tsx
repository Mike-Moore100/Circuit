// Sources — source connector health + recent run history. Both pipeline
// sources (Google Maps, mock) and discovery connectors (DuckDuckGo,
// directories) surface here.

import { PageHeader } from '../_components/PageHeader';
import { StatStrip } from '../_components/StatStrip';
import { getSourcesPageData } from '../_lib/pageData';

export const dynamic = 'force-dynamic';

export default async function SourcesPage() {
  const { recent, discoveryStats } = getSourcesPageData();
  const totalCalls = recent.reduce((acc, r) => acc + r.api_calls, 0);

  return (
    <>
      <PageHeader
        title="Sources"
        subtitle="Discovery + lead sourcing connectors. Free + paid both surface here."
      />

      <section className="section">
        <StatStrip
          items={[
            { label: 'Discovery sources', value: Object.keys(discoveryStats.bySource).length },
            { label: 'Pipeline runs', value: recent.length },
            { label: 'API calls (recent)', value: totalCalls },
            { label: 'Discovery valid 24h', value: discoveryStats.validToday },
          ]}
        />
      </section>

      <section className="section">
        <h2 className="section-title">Discovery connector quality</h2>
        <div className="panel">
          {Object.keys(discoveryStats.bySource).length === 0 ? (
            <div className="empty">No discovery activity yet.</div>
          ) : (
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Runs</th>
                  <th>Valid</th>
                  <th>Rejected</th>
                  <th>Duplicate</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(discoveryStats.bySource)
                  .sort((a, b) => b[1].valid - a[1].valid)
                  .map(([src, s]) => (
                    <tr key={src}>
                      <td><span className="tag">{src}</span></td>
                      <td className="num">{s.runs}</td>
                      <td className="num">{s.valid}</td>
                      <td className="num">{s.rejected}</td>
                      <td className="num">{s.deduped}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Recent pipeline runs</h2>
        <div className="panel">
          {recent.length === 0 ? (
            <div className="empty">No pipeline runs recorded yet.</div>
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

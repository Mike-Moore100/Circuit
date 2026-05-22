// Discovery — top-of-funnel only. Throughput, source quality, rejection
// reasons. The all-time numbers and cross-pipeline stats moved to Overview;
// the per-pipeline-run history moved to Sources.

import Link from 'next/link';
import { CorpusHealth } from '../_components/CorpusHealth';
import { PageHeader } from '../_components/PageHeader';
import { StatStrip } from '../_components/StatStrip';
import { getCorpusHealthReport } from '../_lib/corpusHealthData';
import { getDiscoveryPageData } from '../_lib/pageData';

export const dynamic = 'force-dynamic';

function pct(n: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((n / total) * 100)}%`;
}

export default async function DiscoveryPage() {
  const { stats } = getDiscoveryPageData();
  const corpus = getCorpusHealthReport();
  const passRate24h = pct(stats.validToday, stats.domainsToday);
  const dedupeRate = pct(stats.totalDeduped, stats.totalRawFound);

  return (
    <>
      <PageHeader
        title="Discovery"
        subtitle="Top-of-funnel SERP + directory throughput. Validated, deduped domains feed promotion."
      />

      <section className="section">
        <StatStrip
          items={[
            {
              label: 'Valid (24h)',
              value: stats.validToday,
              foot: `of ${stats.domainsToday} raw · ${passRate24h} pass`,
              tone: 'accent',
            },
            {
              label: 'Dedupe rate',
              value: dedupeRate,
              foot: `${stats.totalDeduped} of ${stats.totalRawFound} all-time`,
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

      {/* Entering qualification — directional cue */}
      <section className="section">
        <Link href="/qualification" className="bottleneck-callout">
          <span className="bottleneck-icon" aria-hidden>
            →
          </span>
          <span className="bottleneck-text">
            {stats.validToday} valid domains entering qualification
          </span>
          <span className="bottleneck-arrow" aria-hidden>
            →
          </span>
        </Link>
      </section>

      <CorpusHealth report={corpus} />

      {Object.keys(stats.bySource).length > 0 && (
        <section className="section">
          <h2 className="section-title">Source quality</h2>
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
              .slice(0, 6)
              .map(([reason, count]) => (
                <li key={reason} className="reason neg">
                  <span className="delta">{count}</span>
                  <span className="label">{reason}</span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </>
  );
}

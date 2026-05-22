// Overview — compact cross-cutting pipeline summary. Replaces the legacy
// single-page dashboard. Heavy operational views (queue tables, lead
// drawer, per-section disclosures) now live on their own routes; this
// page only shows the throughput shape of the system and links to each.

import Link from 'next/link';
import { PageHeader } from './_components/PageHeader';
import { PipelineFlow } from './_components/PipelineFlow';
import { StatStrip } from './_components/StatStrip';
import { getOverviewData } from './_lib/pageData';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const data = getOverviewData();
  const pending = data.qualification.byStatus.PENDING ?? 0;
  const processing = data.qualification.byStatus.PROCESSING ?? 0;
  const promoted = data.qualification.byStatus.PROMOTED ?? 0;
  const skipped = data.qualification.byStatus.SKIPPED ?? 0;
  const failed = data.qualification.byStatus.FAILED ?? 0;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`${data.totalCompanies} companies tracked · ${data.reviewQueue} in review queue`}
      />

      {/* ---- Pipeline flow ------------------------------------------- */}
      <section className="section">
        <h2 className="section-title">Pipeline</h2>
        <PipelineFlow
          stages={[
            {
              href: '/discovery',
              label: 'Discovery',
              value: data.discovery.validToday,
              sub: `${data.discovery.domainsToday} raw / 24h`,
            },
            {
              href: '/queue',
              label: 'Promotion queue',
              value: pending,
              sub: `${promoted} promoted · ${skipped} skipped`,
              alert: failed > 0,
            },
            {
              href: '/qualification',
              label: 'Qualification',
              value: processing > 0 ? `${processing} active` : 'idle',
              sub: data.inspection.inspected > 0
                ? `${data.inspection.inspected} inspected · ${data.inspection.failed} failed`
                : 'no inspections yet',
            },
            {
              href: '/opportunities',
              label: 'Opportunities',
              value: data.reviewQueue,
              sub: data.topOpps[0]
                ? `top: ${data.topOpps[0].opportunity_score}/100`
                : 'no scored leads yet',
            },
          ]}
        />
      </section>

      {/* ---- Cross-cutting stats ------------------------------------- */}
      <section className="section">
        <h2 className="section-title">System health</h2>
        <StatStrip
          items={[
            {
              label: 'Discovery (24h)',
              value: data.discovery.domainsToday,
              foot: `${data.discovery.validToday} valid · ${data.discovery.totalRejected} rejected all-time`,
            },
            {
              label: 'Queue depth',
              value: pending + processing,
              foot: `${pending} pending · ${processing} processing`,
              tone: pending > 50 ? 'warning' : 'default',
            },
            {
              label: 'Review queue',
              value: data.reviewQueue,
              foot: 'awaiting operator action',
            },
            {
              label: 'AI cost today',
              value: `$${data.ai.todayCostUsd.toFixed(2)}`,
              foot: `of $${data.ai.dailyLimitUsd.toFixed(2)} cap`,
            },
          ]}
        />
      </section>

      {/* ---- Top opportunities --------------------------------------- */}
      {data.topOpps.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Top opportunities</h2>
            <Link href="/opportunities" className="section-link">
              See all →
            </Link>
          </div>
          <div className="panel">
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Score</th>
                  <th>Priority</th>
                  <th>Project</th>
                  <th>Complexity</th>
                </tr>
              </thead>
              <tbody>
                {data.topOpps.map((o) => (
                  <tr key={o.company_id}>
                    <td className="num">{o.opportunity_score}</td>
                    <td>
                      <span className={`attention-pill attention-${o.human_attention_priority}`}>
                        {o.human_attention_priority}
                      </span>
                    </td>
                    <td>{o.likely_project_type.replace(/_/g, ' ').toLowerCase()}</td>
                    <td>{o.estimated_project_complexity.toLowerCase()}</td>
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

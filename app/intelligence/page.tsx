// Intelligence — opportunity-scoring debug view. Shows the full per-lead
// sub-score breakdown across all leads in the system. Click through to a
// lead opens the drawer on the Opportunities page.

import Link from 'next/link';
import { PageHeader } from '../_components/PageHeader';
import { StatStrip } from '../_components/StatStrip';
import { getIntelligencePageData } from '../_lib/pageData';

export const dynamic = 'force-dynamic';

export default async function IntelligencePage() {
  const { intelligence } = getIntelligencePageData();
  const counts = intelligence.reduce(
    (acc, r) => {
      acc[r.human_attention_priority] = (acc[r.human_attention_priority] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  // Lead name lookup — single query, indexed.
  const byCompanyName = await getCompanyNames(intelligence.map((r) => r.company_id));

  return (
    <>
      <PageHeader
        title="Intelligence"
        subtitle="Deterministic opportunity-scoring breakdown. Six sub-scores per lead, no AI in the scoring path."
      />

      <section className="section">
        <details className="disclosure">
          <summary>
            Sub-score legend
            <span className="summary-meta">What each column means</span>
          </summary>
          <div className="disclosure-body" style={{ padding: 'var(--space-4)', fontSize: 'var(--text-sm)' }}>
            <dl className="legend-grid">
              <div><dt>Pain</dt><dd>Operational pain detected (broken site, manual workflows, missing CTA).</dd></div>
              <div><dt>Readiness</dt><dd>Likelihood the business is active + currently buying (size, industry, working site).</dd></div>
              <div><dt>Access</dt><dd>How reachable a real decision-maker is (named DM + extracted email beats forms).</dd></div>
              <div><dt>Fit</dt><dd>How cleanly the lead maps onto a campaign we deliver.</dd></div>
              <div><dt>Trust</dt><dd>Penalty score — enterprise / technical / existing-automation barriers.</dd></div>
              <div><dt>Conf</dt><dd>How much we actually know (inspection ok, screenshots, verified signals).</dd></div>
            </dl>
          </div>
        </details>
      </section>

      <section className="section">
        <StatStrip
          items={[
            { label: 'IMMEDIATE', value: counts.IMMEDIATE ?? 0, tone: 'danger' },
            { label: 'HIGH', value: counts.HIGH ?? 0, tone: 'warning' },
            { label: 'MEDIUM', value: counts.MEDIUM ?? 0, tone: 'accent' },
            { label: 'LOW', value: counts.LOW ?? 0 },
            { label: 'IGNORE', value: counts.IGNORE ?? 0 },
          ]}
        />
      </section>

      <section className="section">
        <h2 className="section-title">All scored leads</h2>
        <div className="panel">
          {intelligence.length === 0 ? (
            <div className="empty">
              <strong>No intelligence rows yet</strong>
              Run <code>npm run seed</code> or hit the pipeline to populate.
            </div>
          ) : (
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Score</th>
                  <th>Priority</th>
                  <th>Pain</th>
                  <th>Readiness</th>
                  <th>Access</th>
                  <th>Fit</th>
                  <th>Trust</th>
                  <th>Conf</th>
                  <th>Project</th>
                </tr>
              </thead>
              <tbody>
                {intelligence.map((r) => (
                  <tr key={r.company_id}>
                    <td>
                      <Link
                        href={`/opportunities?lead=${r.company_id}`}
                        scroll={false}
                        className="company-link"
                      >
                        {byCompanyName.get(r.company_id) ?? r.company_id}
                      </Link>
                    </td>
                    <td className="num">{r.opportunity_score}</td>
                    <td>
                      <span className={`attention-pill attention-${r.human_attention_priority}`}>
                        {r.human_attention_priority}
                      </span>
                    </td>
                    <td className="num">{r.operational_pain_score}</td>
                    <td className="num">{r.buying_readiness_score}</td>
                    <td className="num">{r.accessibility_score}</td>
                    <td className="num">{r.implementation_fit_score}</td>
                    <td className="num">{r.trust_barrier_score}</td>
                    <td className="num">{r.evidence_confidence_score}</td>
                    <td>{r.likely_project_type.replace(/_/g, ' ').toLowerCase()}</td>
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

async function getCompanyNames(ids: string[]): Promise<Map<string, string>> {
  const { getDb } = await import('../../src/db/client');
  const db = getDb();
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id, name FROM companies WHERE id IN (${placeholders})`)
    .all(...ids) as Array<{ id: string; name: string }>;
  return new Map(rows.map((r) => [r.id, r.name]));
}

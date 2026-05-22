// Review — operator feedback + calibration. Surfaces what the scoring
// system is doing wrong (and what it's getting right) according to the
// reviewer, plus the learning module's calibration suggestions.

import { PageHeader } from '../_components/PageHeader';
import { StatStrip } from '../_components/StatStrip';
import { getReviewPageData } from '../_lib/pageData';
import { CAMPAIGN_LABEL, type Campaign } from '../../src/scoring/campaignTypes';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const { learning, rejected } = getReviewPageData();
  const fp = learning.reviewCounts.false_positive ?? 0;
  const fr = learning.reviewCounts.false_reject ?? 0;
  const correct = learning.reviewCounts.correct_campaign ?? 0;
  const strong = learning.reviewCounts.strong_opportunity ?? 0;

  return (
    <>
      <PageHeader
        title="Review"
        subtitle="Operator feedback drives calibration. Marks here teach the scoring system what to up- or down-weight."
      />

      <section className="section">
        <StatStrip
          items={[
            { label: 'Total reviews', value: learning.totalReviews },
            { label: 'Correct routing', value: correct, tone: 'success' },
            { label: 'Strong opportunity', value: strong, tone: 'success' },
            { label: 'Wrongly accepted', value: fp, tone: fp > 0 ? 'warning' : 'default' },
            { label: 'Wrongly rejected', value: fr, tone: fr > 0 ? 'warning' : 'default' },
          ]}
        />
      </section>

      {learning.insights.length > 0 && (
        <section className="section">
          <h2 className="section-title">Insights</h2>
          <ul className="bullet-list">
            {learning.insights.map((i, idx) => (
              <li key={idx}>
                <strong>[{i.tone}] {i.headline}</strong> — {i.detail}
              </li>
            ))}
          </ul>
        </section>
      )}

      {learning.suggestions.length > 0 && (
        <section className="section">
          <h2 className="section-title">Calibration suggestions</h2>
          <div className="panel">
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Knob</th>
                  <th>Direction</th>
                  <th>Confidence</th>
                  <th>Evidence</th>
                  <th>Rationale</th>
                </tr>
              </thead>
              <tbody>
                {learning.suggestions.map((s) => (
                  <tr key={s.id}>
                    <td><code>{s.knob}</code></td>
                    <td>{s.direction}</td>
                    <td className="num">{s.confidence}%</td>
                    <td className="num">{s.evidenceCount}</td>
                    <td>{s.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {learning.patterns.length > 0 && (
        <section className="section">
          <h2 className="section-title">Review patterns</h2>
          <div className="panel">
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Review type</th>
                  <th>Previous campaign</th>
                  <th>Count</th>
                  <th>Avg opportunity</th>
                  <th>Sample</th>
                </tr>
              </thead>
              <tbody>
                {learning.patterns.slice(0, 12).map((p, idx) => (
                  <tr key={`${p.reviewType}-${p.previousCampaign}-${idx}`}>
                    <td>{p.reviewType.replace(/_/g, ' ')}</td>
                    <td>
                      <span className={`campaign-tag campaign-${p.previousCampaign}`}>
                        {CAMPAIGN_LABEL[p.previousCampaign as Campaign] ?? p.previousCampaign}
                      </span>
                    </td>
                    <td className="num">{p.count}</td>
                    <td className="num">{p.avgOpportunityScore}</td>
                    <td>{p.sampleCompanies.slice(0, 3).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {rejected.length > 0 && (
        <section className="section">
          <h2 className="section-title">Recently rejected leads</h2>
          <div className="panel">
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Industry</th>
                  <th>Final score</th>
                  <th>Campaign</th>
                </tr>
              </thead>
              <tbody>
                {rejected.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td>{r.industry ?? '—'}</td>
                    <td className="num">{r.final_score}</td>
                    <td>{r.primary_campaign ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {learning.totalReviews === 0 && (
        <section className="section">
          <div className="panel">
            <div className="empty">
              <strong>No reviewer feedback yet</strong>
              Open a lead on the Opportunities page and tap one of the routing-feedback buttons to start building calibration data.
            </div>
          </div>
        </section>
      )}
    </>
  );
}

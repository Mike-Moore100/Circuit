// Review — human calibration only. False positives, false rejects,
// operator decisions, and the calibration suggestions the learning
// module derives from them. Patterns + recent-rejects tables got
// dropped — the rejected list belongs on Opportunities with the
// REJECT filter, and patterns are pure noise without a visualisation.

import { PageHeader } from '../_components/PageHeader';
import { StatStrip } from '../_components/StatStrip';
import { getReviewPageData } from '../_lib/pageData';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const { learning } = getReviewPageData();
  const fp = learning.reviewCounts.false_positive ?? 0;
  const fr = learning.reviewCounts.false_reject ?? 0;
  const correct = learning.reviewCounts.correct_campaign ?? 0;
  const strong = learning.reviewCounts.strong_opportunity ?? 0;

  return (
    <>
      <PageHeader
        title="Review"
        subtitle="Operator feedback drives scoring calibration. Mark routing as right or wrong on Opportunities."
      />

      <section className="section">
        <StatStrip
          items={[
            {
              label: 'Correct routing',
              value: correct,
              tone: correct > 0 ? 'success' : 'default',
            },
            {
              label: 'Strong opportunity',
              value: strong,
              tone: strong > 0 ? 'success' : 'default',
            },
            {
              label: 'Wrongly accepted',
              value: fp,
              tone: fp > 0 ? 'warning' : 'default',
            },
            {
              label: 'Wrongly rejected',
              value: fr,
              tone: fr > 0 ? 'warning' : 'default',
            },
          ]}
        />
      </section>

      {learning.insights.length > 0 && (
        <section className="section">
          <h2 className="section-title">Insights</h2>
          <ul className="bullet-list">
            {learning.insights.map((i, idx) => (
              <li key={idx}>
                <strong>{i.headline}</strong> — {i.detail}
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
                  <th>Rationale</th>
                </tr>
              </thead>
              <tbody>
                {learning.suggestions.map((s) => (
                  <tr key={s.id}>
                    <td><code>{s.knob}</code></td>
                    <td>{s.direction}</td>
                    <td className="num">{s.confidence}%</td>
                    <td>{s.rationale}</td>
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

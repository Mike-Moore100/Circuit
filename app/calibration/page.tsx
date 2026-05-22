// Calibration — scoring intelligence + pattern insights + suggestions.
// Sits between Review (where feedback is captured) and Intelligence
// (where per-lead scoring is debugged). Operator-controlled: every
// recommendation here is proposed, never applied.

import { PageHeader } from '../_components/PageHeader';
import { StatStrip } from '../_components/StatStrip';
import { getCalibrationOverview } from '../../src/services/index';

export const dynamic = 'force-dynamic';

function pct(x: number | null): string {
  if (x === null || Number.isNaN(x)) return '—';
  return `${Math.round(x * 100)}%`;
}

export default async function CalibrationPage() {
  const snap = getCalibrationOverview();

  return (
    <>
      <PageHeader
        title="Calibration"
        subtitle="Patterns in operator feedback. Suggestions are proposed — never applied automatically."
      />

      <section className="section">
        <StatStrip
          items={[
            { label: 'Reviewed leads', value: snap.totalReviews },
            {
              label: 'Agreement',
              value: pct(snap.drift.agreementRate),
              foot: 'system + operator agree',
              tone: snap.drift.agreementRate >= 0.7 ? 'success' : 'default',
            },
            {
              label: 'False positives',
              value: pct(snap.drift.falsePositiveRate),
              tone: snap.drift.falsePositiveRate > 0.2 ? 'warning' : 'default',
            },
            {
              label: 'False rejects',
              value: pct(snap.drift.falseRejectRate),
              tone: snap.drift.falseRejectRate > 0.2 ? 'warning' : 'default',
            },
          ]}
        />
      </section>

      {snap.totalReviews === 0 && (
        <section className="section">
          <div className="panel">
            <div className="empty">
              <strong>No reviewer feedback yet</strong>
              Open a lead on Opportunities and tap a routing-feedback button to start building calibration data. Patterns surface after ~3-5 reviews per shape.
            </div>
          </div>
        </section>
      )}

      {snap.insights.length > 0 && (
        <section className="section">
          <h2 className="section-title">Insights</h2>
          <ul className="bullet-list">
            {snap.insights.slice(0, 8).map((i) => (
              <li key={i.id}>
                <strong>[{i.confidence}%]</strong> {i.title} — {i.description}
              </li>
            ))}
          </ul>
        </section>
      )}

      {snap.suggestions.length > 0 && (
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
                {snap.suggestions.slice(0, 12).map((s) => (
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

      {snap.signalPerformance.length > 0 && (
        <section className="section">
          <h2 className="section-title">Signal performance</h2>
          <div className="panel">
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Reviewed</th>
                  <th>Precision</th>
                  <th>FP</th>
                  <th>FR</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {snap.signalPerformance.slice(0, 12).map((s) => (
                  <tr key={s.signalName}>
                    <td><code>{s.signalName}</code></td>
                    <td className="num">{s.reviewedCount}</td>
                    <td className="num">{pct(s.precision)}</td>
                    <td className="num">{s.falsePositiveCount}</td>
                    <td className="num">{s.falseRejectCount}</td>
                    <td className="num">{s.confidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {snap.opportunityPatterns.length > 0 && (
        <section className="section">
          <h2 className="section-title">High-value opportunity patterns</h2>
          <div className="panel">
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Shape</th>
                  <th>Count</th>
                  <th>Positive</th>
                  <th>Strong</th>
                  <th>Precision</th>
                  <th>Avg opp</th>
                </tr>
              </thead>
              <tbody>
                {snap.opportunityPatterns.slice(0, 10).map((p) => (
                  <tr key={p.signature}>
                    <td>{p.signature}</td>
                    <td className="num">{p.count}</td>
                    <td className="num">{p.positiveCount}</td>
                    <td className="num">{p.strongCount}</td>
                    <td className="num">{pct(p.precision)}</td>
                    <td className="num">{p.avgOpportunityScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {snap.trustBarrierPatterns.length > 0 && (
        <section className="section">
          <h2 className="section-title">Trust-barrier patterns</h2>
          <div className="panel">
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Shape</th>
                  <th>Count</th>
                  <th>False positive</th>
                  <th>Avg trust barrier</th>
                </tr>
              </thead>
              <tbody>
                {snap.trustBarrierPatterns.slice(0, 8).map((p) => (
                  <tr key={p.signature}>
                    <td>{p.signature}</td>
                    <td className="num">{p.count}</td>
                    <td className="num">{p.falsePositiveCount}</td>
                    <td className="num">{p.avgTrustBarrierScore}</td>
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

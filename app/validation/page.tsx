// Phase 1 Validation page — ranking quality review workflow.
//
// Four sections in strict order:
//
//   1. Validation Summary     — compact rates + best/worst industries
//   2. Validation Queue       — primary working area (review one lead at a time)
//   3. Pattern Insights       — text-driven patterns from operator history
//   4. Calibration Recommendations — one-line scoring tweaks with evidence
//
// Old surface (top-ranked tables, conversion opportunities, score
// vs agreement breakouts, outcome distribution etc.) is NOT removed.
// It moves to the Patterns section where it belongs (insight, not
// dashboard) or onto the per-lead drawer on /opportunities.

import { PageHeader } from '../_components/PageHeader';
import { PatternInsightCard } from '../_components/PatternInsightCard';
import { RecommendationCard } from '../_components/RecommendationCard';
import { ValidationQueueCard } from '../_components/ValidationQueueCard';
import { getValidationData } from '../_lib/validationData';

export const dynamic = 'force-dynamic';

function pct(rate: number | null): string {
  if (rate === null) return '—';
  return `${Math.round(rate * 100)}%`;
}

export default function ValidationPage() {
  const data = getValidationData();
  const m = data.summary.metrics;
  const queueByReason = {
    unreviewed: data.queue.filter((q) => q.queueReason === 'unreviewed_high').length,
    falsePos: data.queue.filter((q) => q.queueReason === 'false_positive_candidate').length,
    falseRej: data.queue.filter((q) => q.queueReason === 'false_reject_candidate').length,
    conflicts: data.queue.filter((q) => q.queueReason === 'conflicting_tags').length,
  };
  const subtitle = data.queue.length === 0
    ? `Nothing in the queue right now. Score history: ${m.totalReviewed} reviewed.`
    : `${data.queue.length} in queue · ${queueByReason.unreviewed} unreviewed · ${queueByReason.falsePos + queueByReason.falseRej} mismatches`;

  return (
    <>
      <PageHeader title="Validation" subtitle={subtitle} />

      {/* ---- 1. SUMMARY -------------------------------------------- */}
      <section className="section">
        <h2 className="section-title section-title-quiet">Summary</h2>
        <div className="vs-summary">
          <SummaryStat label="Agreement" value={pct(m.operatorAgreementRate)} tone="ok" />
          <SummaryStat
            label="False positives"
            value={pct(m.falsePositiveRate)}
            sub={`${m.highScoreRejected}/${m.totalHighScore} high-score rejected`}
            tone="err"
          />
          <SummaryStat
            label="False rejects"
            value={pct(m.falseNegativeRate)}
            sub={`${m.lowScoreApproved}/${m.totalLowScore} low-score approved`}
            tone="warn"
          />
          <SummaryStat
            label="Ranking confidence"
            value={m.rankingConfidence === null ? '—' : `${m.rankingConfidence}/100`}
            sub={m.totalReviewed < 5 ? `${m.totalReviewed}/5 reviewed` : 'composite'}
            tone="info"
          />
          <SummaryStat
            label="Strongest industry"
            value={data.summary.strongestIndustry ?? '—'}
            tone="ok"
          />
          <SummaryStat
            label="Weakest industry"
            value={data.summary.weakestIndustry ?? '—'}
            tone="warn"
          />
        </div>
        {data.summary.scoringDriftWarning && (
          <p className="vs-drift">
            <strong>Drift:</strong> {data.summary.scoringDriftWarning}
          </p>
        )}
      </section>

      {/* ---- 2. QUEUE — PRIMARY ----------------------------------- */}
      <section className="section">
        <header className="section-head">
          <h2 className="section-title">Validation queue</h2>
          <span className="section-hint-inline">
            Review each lead with one click. Tags persist as calibration history.
          </span>
        </header>
        {data.queue.length === 0 ? (
          <div className="panel">
            <div className="empty">
              <strong>Queue is clear.</strong>
              Every high-score lead has been reviewed. Re-run discovery or
              wait for the next promotion batch.
            </div>
          </div>
        ) : (
          <div className="vq-list">
            {data.queue.map((item) => (
              <ValidationQueueCard key={item.companyId} item={item} />
            ))}
          </div>
        )}
      </section>

      {/* ---- 3. PATTERN INSIGHTS ---------------------------------- */}
      <section className="section">
        <header className="section-head">
          <h2 className="section-title">Pattern insights</h2>
          <span className="section-hint-inline">
            Derived from operator review history. Each insight carries its evidence count.
          </span>
        </header>
        {totalInsights(data.patterns) === 0 ? (
          <div className="panel">
            <div className="empty">
              <strong>Not enough reviewed leads to surface patterns yet.</strong>
              Review at least {3} leads per industry to unlock insights.
            </div>
          </div>
        ) : (
          <div className="pattern-grid">
            {data.patterns.strongest.map((p, i) => (
              <PatternInsightCard key={`s${i}`} insight={p} />
            ))}
            {data.patterns.weakest.map((p, i) => (
              <PatternInsightCard key={`w${i}`} insight={p} />
            ))}
            {data.patterns.falsePositives.map((p, i) => (
              <PatternInsightCard key={`fp${i}`} insight={p} />
            ))}
            {data.patterns.falseRejects.map((p, i) => (
              <PatternInsightCard key={`fr${i}`} insight={p} />
            ))}
            {data.patterns.signals.map((p, i) => (
              <PatternInsightCard key={`sig${i}`} insight={p} />
            ))}
          </div>
        )}
      </section>

      {/* ---- 4. CALIBRATION RECOMMENDATIONS ----------------------- */}
      <section className="section">
        <header className="section-head">
          <h2 className="section-title">Calibration recommendations</h2>
          <span className="section-hint-inline">
            Concrete scoring tweaks evidenced by the patterns above.
          </span>
        </header>
        {data.recommendations.length === 0 ? (
          <div className="panel">
            <div className="empty">
              <strong>No calibration tweaks recommended yet.</strong>
              Recommendations appear once enough patterns reach the
              evidence threshold (3+ reviews per signal).
            </div>
          </div>
        ) : (
          <div className="rec-grid">
            {data.recommendations.map((rec, i) => (
              <RecommendationCard key={i} recommendation={rec} />
            ))}
          </div>
        )}
      </section>

      {/* ---- Outcome distribution moved into Layer 3 collapsible
              — kept accessible per the brief's "don't delete data"
              rule but pushed below the operator's primary workflow. */}
      {Object.keys(data.summary.outcomeDistribution).length > 0 && (
        <section className="section">
          <details className="drawer-collapsible">
            <summary className="drawer-collapsible-summary">
              Outcome distribution ({Object.values(data.summary.outcomeDistribution).reduce((s, n) => s + n, 0)} recorded)
            </summary>
            <table className="runs-table">
              <thead>
                <tr><th>Outcome</th><th>Count</th></tr>
              </thead>
              <tbody>
                {Object.entries(data.summary.outcomeDistribution)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => (
                    <tr key={type}>
                      <td>{type.replace(/_/g, ' ').toLowerCase()}</td>
                      <td className="num">{count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </details>
        </section>
      )}
    </>
  );
}

function totalInsights(patterns: ReturnType<typeof getValidationData>['patterns']): number {
  return (
    patterns.strongest.length +
    patterns.weakest.length +
    patterns.falsePositives.length +
    patterns.falseRejects.length +
    patterns.signals.length
  );
}

function SummaryStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: 'ok' | 'warn' | 'err' | 'info';
}) {
  return (
    <div className={`vs-stat vs-stat-${tone}`}>
      <span className="vs-stat-label">{label}</span>
      <span className="vs-stat-value">{value}</span>
      {sub && <span className="vs-stat-sub">{sub}</span>}
    </div>
  );
}

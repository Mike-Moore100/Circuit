// Corpus Health — visual surface for the Phase 1 Discovery Diversity layer.
// Shows distribution shape (industry / source / campaign / opportunity),
// over/under-represented industries, source concentration, diversity
// scores, and any active warnings. Server component — the underlying
// loader is pure SQL.

import type { CorpusHealthReport } from '../../src/discovery/corpusHealth';

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

interface RowBarProps {
  label: string;
  count: number;
  share: number;
  tone?: 'pos' | 'neg' | 'neutral' | 'warn';
}

function RowBar({ label, count, share, tone = 'neutral' }: RowBarProps) {
  return (
    <div className={`corpus-bar corpus-bar-${tone}`}>
      <span className="corpus-bar-label">{label}</span>
      <div className="corpus-bar-track">
        <span
          className="corpus-bar-fill"
          style={{ width: `${Math.max(2, share * 100)}%` }}
        />
      </div>
      <span className="corpus-bar-count">{count}</span>
      <span className="corpus-bar-share">{pct(share)}</span>
    </div>
  );
}

interface Props {
  report: CorpusHealthReport;
}

export function CorpusHealth({ report }: Props) {
  const empty = report.total === 0;

  return (
    <section className="section corpus-health">
      <div className="section-head">
        <h2 className="section-title">Corpus health</h2>
        <div className="corpus-diversity">
          <span className="corpus-diversity-value">{report.overallDiversityScore}</span>
          <span className="corpus-diversity-cap">/100 diversity</span>
        </div>
      </div>

      {empty ? (
        <div className="panel">
          <div className="empty">
            <strong>No companies in the corpus yet.</strong>
            Run discovery to seed.
          </div>
        </div>
      ) : (
        <>
          {/* ---- Diversity tiles ----------------------------------- */}
          <div className="corpus-tile-grid">
            <div className="corpus-tile">
              <div className="corpus-tile-label">Industry diversity</div>
              <div className="corpus-tile-value">{pct(report.diversityScores.industry)}</div>
              <div className="corpus-tile-sub">
                {report.industryDistribution.length} industries · {report.total} companies
              </div>
            </div>
            <div className="corpus-tile">
              <div className="corpus-tile-label">Source diversity</div>
              <div className="corpus-tile-value">{pct(report.diversityScores.source)}</div>
              <div className="corpus-tile-sub">
                {report.sourceDistribution.length} sources active
              </div>
            </div>
            <div className="corpus-tile">
              <div className="corpus-tile-label">Campaign diversity</div>
              <div className="corpus-tile-value">{pct(report.diversityScores.campaign)}</div>
              <div className="corpus-tile-sub">
                {report.campaignDistribution.length} campaigns assigned
              </div>
            </div>
            <div className="corpus-tile">
              <div className="corpus-tile-label">Opportunity diversity</div>
              <div className="corpus-tile-value">{pct(report.diversityScores.opportunity)}</div>
              <div className="corpus-tile-sub">
                spread across opportunity score bands
              </div>
            </div>
          </div>

          {/* ---- Warnings ------------------------------------------ */}
          {report.warnings.length > 0 && (
            <div className="corpus-warnings">
              {report.warnings.map((w) => (
                <div key={w.code} className={`corpus-warning corpus-warning-${w.level}`}>
                  <span className="corpus-warning-level">{w.level}</span>
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* ---- Industry distribution ---------------------------- */}
          <div className="three-col">
            <div className="panel">
              <h3 className="panel-sub">Top industries</h3>
              {report.industryDistribution.length === 0 ? (
                <div className="empty muted">No industry data — backfill industry tags from discovery queries.</div>
              ) : (
                <div className="corpus-bar-list">
                  {report.industryDistribution.slice(0, 8).map((b) => (
                    <RowBar
                      key={b.bucket}
                      label={b.bucket}
                      count={b.count}
                      share={b.share}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="panel">
              <h3 className="panel-sub">Overrepresented</h3>
              {report.industryBalance.deprioritize.length === 0 ? (
                <div className="empty muted">None — corpus is within concentration limits.</div>
              ) : (
                <ul className="corpus-flag-list">
                  {report.industryBalance.classifications
                    .filter((c) => c.status === 'overrepresented')
                    .map((c) => (
                      <li key={c.industry} className="corpus-flag-row">
                        <span className="corpus-flag-name">{c.industry}</span>
                        <span className="corpus-flag-share">{pct(c.share)}</span>
                        <span className="corpus-flag-target">
                          target {pct(c.targetShare)}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </div>

            <div className="panel">
              <h3 className="panel-sub">Underrepresented</h3>
              {report.industryBalance.prioritize.length === 0 ? (
                <div className="empty muted">None — every target industry is present in healthy share.</div>
              ) : (
                <ul className="corpus-flag-list">
                  {report.industryBalance.classifications
                    .filter(
                      (c) =>
                        c.status === 'underrepresented' || c.status === 'missing',
                    )
                    .slice(0, 8)
                    .map((c) => (
                      <li key={c.industry} className="corpus-flag-row">
                        <span className="corpus-flag-name">{c.industry}</span>
                        <span className="corpus-flag-share">
                          {c.count === 0 ? 'missing' : pct(c.share)}
                        </span>
                        <span className="corpus-flag-target">
                          target {pct(c.targetShare)}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </div>

          {/* ---- Source + campaign concentration ----------------- */}
          <div className="three-col">
            <div className="panel">
              <h3 className="panel-sub">Source concentration</h3>
              <div className="corpus-bar-list">
                {report.sourceDistribution.map((b) => (
                  <RowBar
                    key={b.bucket}
                    label={b.bucket}
                    count={b.count}
                    share={b.share}
                    tone={
                      report.sourceConcentration.dominantSource === b.bucket
                        ? 'warn'
                        : 'neutral'
                    }
                  />
                ))}
              </div>
              {report.sourceConcentration.isOverconcentrated && (
                <div className="corpus-warning corpus-warning-critical">
                  Single source above {pct(report.sourceConcentration.concentrationLimit)} share.
                </div>
              )}
            </div>

            <div className="panel">
              <h3 className="panel-sub">Campaign distribution</h3>
              <div className="corpus-bar-list">
                {report.campaignDistribution.map((b) => (
                  <RowBar key={b.bucket} label={b.bucket} count={b.count} share={b.share} />
                ))}
              </div>
            </div>

            <div className="panel">
              <h3 className="panel-sub">Opportunity distribution</h3>
              <div className="corpus-bar-list">
                {report.opportunityDistribution.map((b) => (
                  <RowBar key={b.bucket} label={b.bucket} count={b.count} share={b.share} />
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

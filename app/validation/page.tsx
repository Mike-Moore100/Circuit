// Phase 1 Live Validation dashboard. Answers the question the rest of
// the system can't answer on its own: "is the opportunity ranking
// actually surfacing commercially valuable leads?"
//
// Layout is intentionally dense — operators looking at this page already
// have the per-lead detail on /opportunities. This is the aerial view.

import Link from 'next/link';
import { PageHeader } from '../_components/PageHeader';
import { getValidationData, type ValidationLeadView } from '../_lib/validationData';
import { OUTCOME_LABEL, OUTCOME_TONE } from '../../src/validation/outcomeTypes';

export const dynamic = 'force-dynamic';

function pct(rate: number | null): string {
  if (rate === null) return '—';
  return `${Math.round(rate * 100)}%`;
}

function LeadRow({ lead }: { lead: ValidationLeadView }) {
  return (
    <tr>
      <td className="num">{lead.opportunityScore}</td>
      <td>
        <Link
          href={`/opportunities?lead=${lead.companyId}`}
          scroll={false}
          className="company-link"
        >
          {lead.company}
        </Link>
        {lead.industry && <span className="muted"> · {lead.industry}</span>}
      </td>
      <td>
        <span className={`attention-pill attention-${lead.attentionPriority}`}>
          {lead.attentionPriority}
        </span>
      </td>
      <td className="num">{lead.trustBarrier}</td>
      <td className="num">{lead.operationalPain}</td>
      <td>
        {lead.latestOutcome ? (
          <span
            className={`outcome-pill outcome-${
              (OUTCOME_TONE as Record<string, string>)[lead.latestOutcome] ?? 'neutral'
            }`}
          >
            {(OUTCOME_LABEL as Record<string, string>)[lead.latestOutcome] ??
              lead.latestOutcome}
          </span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td>
        {lead.approved && <span className="vdot vdot-approved" title="Operator approved">●</span>}
        {lead.rejected && <span className="vdot vdot-rejected" title="Operator rejected">●</span>}
      </td>
    </tr>
  );
}

function LeadTable({
  title,
  rows,
  emptyHint,
}: {
  title: string;
  rows: ValidationLeadView[];
  emptyHint: string;
}) {
  return (
    <section className="section">
      <h2 className="section-title">{title}</h2>
      <div className="panel">
        {rows.length === 0 ? (
          <div className="empty">{emptyHint}</div>
        ) : (
          <table className="runs-table validation-table">
            <thead>
              <tr>
                <th>Score</th>
                <th>Company</th>
                <th>Priority</th>
                <th>Trust</th>
                <th>Pain</th>
                <th>Latest outcome</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <LeadRow key={r.companyId} lead={r} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export default function ValidationPage() {
  const data = getValidationData();
  const m = data.metrics;

  return (
    <>
      <PageHeader
        title="Validation"
        subtitle={`${m.totalReviewed} reviewed · ${pct(m.operatorAgreementRate)} agreement · ${
          m.rankingConfidence === null ? 'confidence pending' : `confidence ${m.rankingConfidence}/100`
        }`}
      />

      {/* ---- Calibration metric strip --------------------------------- */}
      <section className="section">
        <div className="validation-metric-strip">
          <div className="vmetric">
            <div className="vmetric-label">Agreement</div>
            <div className="vmetric-value">{pct(m.operatorAgreementRate)}</div>
            <div className="vmetric-sub">operator approved / reviewed</div>
          </div>
          <div className="vmetric">
            <div className="vmetric-label">Disagreement</div>
            <div className="vmetric-value">{pct(m.operatorDisagreementRate)}</div>
            <div className="vmetric-sub">operator rejected / reviewed</div>
          </div>
          <div className="vmetric vmetric-danger">
            <div className="vmetric-label">False positives</div>
            <div className="vmetric-value">{pct(m.falsePositiveRate)}</div>
            <div className="vmetric-sub">
              {m.highScoreRejected}/{m.totalHighScore} high-score rejected
            </div>
          </div>
          <div className="vmetric vmetric-warn">
            <div className="vmetric-label">False negatives</div>
            <div className="vmetric-value">{pct(m.falseNegativeRate)}</div>
            <div className="vmetric-sub">
              {m.lowScoreApproved}/{m.totalLowScore} low-score approved
            </div>
          </div>
          <div className="vmetric vmetric-confidence">
            <div className="vmetric-label">Ranking confidence</div>
            <div className="vmetric-value">
              {m.rankingConfidence === null ? '—' : `${m.rankingConfidence}/100`}
            </div>
            <div className="vmetric-sub">
              {m.totalReviewed < 5
                ? `${m.totalReviewed}/5 reviewed (need more data)`
                : 'composite of agreement + false rates'}
            </div>
          </div>
        </div>
      </section>

      {/* ---- Top-ranked + highest-approved -------------------------- */}
      <LeadTable
        title="Top-ranked opportunities"
        rows={data.topRanked}
        emptyHint="No scored opportunities yet — run discovery + qualification first."
      />
      <LeadTable
        title="Highest operator-approved leads"
        rows={data.highestApproved}
        emptyHint="No approval tags yet. Open /opportunities and mark a few leads as 'Would contact' / 'High commercial potential'."
      />

      {/* ---- Conversion opportunities (commercial weakness) --------- */}
      <LeadTable
        title="Strongest conversion opportunities (weak onboarding + high opp)"
        rows={data.conversionOpportunities}
        emptyHint="No high-opp leads with weak onboarding flow detected."
      />

      {/* ---- Trust barrier patterns -------------------------------- */}
      <LeadTable
        title="Highest trust barrier patterns"
        rows={data.highestTrustBarrier}
        emptyHint="No trust barrier signals detected."
      />

      {/* ---- Commercial pain pattern counts ------------------------ */}
      <section className="section">
        <h2 className="section-title">Strongest commercial pain patterns</h2>
        <div className="panel">
          {data.commercialPainPatterns.length === 0 ? (
            <div className="empty">No commercial pain patterns detected yet.</div>
          ) : (
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Pattern</th>
                  <th>Companies</th>
                </tr>
              </thead>
              <tbody>
                {data.commercialPainPatterns.map((p) => (
                  <tr key={p.kind}>
                    <td>{p.label}</td>
                    <td className="num">{p.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ---- Score vs operator agreement --------------------------- */}
      <section className="section">
        <h2 className="section-title">Opportunity score vs operator agreement</h2>
        <div className="three-col">
          <div className="panel">
            <h3 className="panel-sub">High score · approved <span className="vdot vdot-approved">●</span></h3>
            {data.scoreVsAgreement.highScoreApproved.length === 0 ? (
              <div className="empty">No high-score approved leads yet.</div>
            ) : (
              <ul className="lead-mini-list">
                {data.scoreVsAgreement.highScoreApproved.map((l) => (
                  <li key={l.companyId}>
                    <Link href={`/opportunities?lead=${l.companyId}`} scroll={false}>
                      {l.company}
                    </Link>
                    <span className="muted"> · {l.opportunityScore}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="panel">
            <h3 className="panel-sub">High score · rejected <span className="vdot vdot-rejected">●</span></h3>
            <p className="muted">
              False positives — the ranking surfaced these but the operator rejected.
            </p>
            {data.scoreVsAgreement.highScoreRejected.length === 0 ? (
              <div className="empty">No false positives yet.</div>
            ) : (
              <ul className="lead-mini-list">
                {data.scoreVsAgreement.highScoreRejected.map((l) => (
                  <li key={l.companyId}>
                    <Link href={`/opportunities?lead=${l.companyId}`} scroll={false}>
                      {l.company}
                    </Link>
                    <span className="muted"> · {l.opportunityScore}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="panel">
            <h3 className="panel-sub">Low score · approved <span className="vdot vdot-approved">●</span></h3>
            <p className="muted">
              False negatives — the operator wants these but the ranking didn't.
            </p>
            {data.scoreVsAgreement.lowScoreApproved.length === 0 ? (
              <div className="empty">No false negatives yet.</div>
            ) : (
              <ul className="lead-mini-list">
                {data.scoreVsAgreement.lowScoreApproved.map((l) => (
                  <li key={l.companyId}>
                    <Link href={`/opportunities?lead=${l.companyId}`} scroll={false}>
                      {l.company}
                    </Link>
                    <span className="muted"> · {l.opportunityScore}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* ---- Outcome distribution --------------------------------- */}
      {Object.keys(data.outcomeDistribution).length > 0 && (
        <section className="section">
          <h2 className="section-title">Outcome distribution</h2>
          <div className="panel">
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Outcome</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.outcomeDistribution)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => (
                    <tr key={type}>
                      <td>
                        <span
                          className={`outcome-pill outcome-${
                            (OUTCOME_TONE as Record<string, string>)[type] ?? 'neutral'
                          }`}
                        >
                          {(OUTCOME_LABEL as Record<string, string>)[type] ?? type}
                        </span>
                      </td>
                      <td className="num">{count}</td>
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

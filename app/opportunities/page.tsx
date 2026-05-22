// Opportunities — the operator's primary workspace. Ranked lead table
// + side drawer for per-lead detail. URL-driven selection (?lead=<id>)
// so a lead is shareable / refreshable.

import Link from 'next/link';
import {
  getContactsForLead,
  getDashboardData,
  getEvidenceForLead,
  getIntelligenceForLead,
  getIntelligenceSummariesByCompany,
} from '../_lib/dashboardData';
import { Avatar } from '../_components/Avatar';
import { LeadDrawer } from '../_components/LeadDrawer';
import { PageHeader } from '../_components/PageHeader';
import { RealModeEmpty } from '../_components/RealModeEmpty';
import { ReviewActions } from '../_components/ReviewActions';
import { currentDataMode } from '../../src/db/dataMode';
import { CAMPAIGN_LABEL, type Campaign } from '../../src/scoring/campaignTypes';
import type { ReviewQueueRow } from '../../src/types';

export const dynamic = 'force-dynamic';

const ALL_CAMPAIGNS: Campaign[] = [
  'AI_AUTOMATION',
  'WEB_REBUILD',
  'FUNNEL_OPTIMIZATION',
  'LOCAL_DIGITAL_UPGRADE',
  'LOW_PRIORITY_NURTURE',
  'REJECT',
];

function domain(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function ScoreCell({ row }: { row: ReviewQueueRow }) {
  const finalWidth = `${Math.max(0, Math.min(100, row.finalScore))}%`;
  return (
    <div className="score-cell">
      <div className={`score-bar ${row.priority}`}>
        <span className="fill" style={{ width: finalWidth }} />
      </div>
      <span className="score-number">{row.finalScore}</span>
    </div>
  );
}

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string; campaign?: string }>;
}) {
  const params = await searchParams;
  const data = await getDashboardData();
  const intelligenceByCompany = getIntelligenceSummariesByCompany();
  const selectedLeadId = params.lead ?? null;
  const campaignFilter = params.campaign ?? null;

  // Filter the queue if a campaign filter is in the URL
  const visibleRows = campaignFilter
    ? data.reviewQueue.filter((r) => r.primaryCampaign === campaignFilter)
    : data.reviewQueue;

  const selectedLead = selectedLeadId
    ? data.reviewQueue.find((r) => r.companyId === selectedLeadId) ??
      data.rejected.find((r) => r.companyId === selectedLeadId) ??
      null
    : null;

  return (
    <>
      <PageHeader
        title="Opportunities"
        subtitle={`${data.reviewQueue.length} in review queue · ${data.priorityCounts.A}A · ${data.priorityCounts.B}B · ${data.priorityCounts.C}C`}
      />

      {/* ---- Campaign filter strip --------------------------------- */}
      <section className="section">
        <div className="filter-strip">
          <Link
            href="/opportunities"
            className={`filter-chip${!campaignFilter ? ' filter-chip-active' : ''}`}
            scroll={false}
          >
            All <span className="filter-chip-count">{data.reviewQueue.length}</span>
          </Link>
          {ALL_CAMPAIGNS.map((c) => {
            const count = data.campaignCounts[c] ?? 0;
            if (count === 0) return null;
            return (
              <Link
                key={c}
                href={`/opportunities?campaign=${c}`}
                className={`filter-chip${campaignFilter === c ? ' filter-chip-active' : ''}`}
                scroll={false}
              >
                <span className={`campaign-dot campaign-${c}`} />
                {CAMPAIGN_LABEL[c]} <span className="filter-chip-count">{count}</span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ---- The lead table ----------------------------------------- */}
      <section className="section">
        {visibleRows.length === 0 && !campaignFilter && currentDataMode() === 'REAL' ? (
          <RealModeEmpty />
        ) : (
        <div className="panel">
          {visibleRows.length === 0 ? (
            <div className="empty">
              <strong>No leads in this view</strong>
              {campaignFilter ? (
                <>Try the <Link href="/opportunities">All</Link> filter.</>
              ) : (
                <>Run <code>npm run run:discovery</code> or trigger a real pipeline source.</>
              )}
            </div>
          ) : (
            <table className="lead-table compact">
              <thead>
                <tr>
                  <th className="col-campaign-compact" aria-label="Campaign" />
                  <th>Company</th>
                  <th className="col-score">Score</th>
                  <th className="col-actions">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const isSelected = row.companyId === selectedLeadId;
                  const reviewMark = data.validation.reviewByCompany[row.companyId];
                  const intel = intelligenceByCompany[row.companyId];
                  // Preserve the active campaign filter when selecting
                  // a lead so the drawer keeps the operator's context.
                  const leadHref = `/opportunities?${new URLSearchParams({
                    lead: row.companyId,
                    ...(campaignFilter ? { campaign: campaignFilter } : {}),
                  }).toString()}`;
                  return (
                    <tr
                      key={row.companyId}
                      className={isSelected ? 'lead-row selected' : 'lead-row'}
                    >
                      <td className="col-campaign-compact">
                        <span
                          className={`campaign-dot campaign-${row.primaryCampaign}`}
                          title={CAMPAIGN_LABEL[row.primaryCampaign]}
                        />
                      </td>
                      <td className="col-company-compact">
                        <Link href={leadHref} scroll={false} className="company-link">
                          <Avatar name={row.company} size={22} />
                          <div className="company-line">
                            <div className="lead-name-compact">
                              {row.company}
                              {intel && (
                                <span
                                  className={`attention-pill attention-${intel.humanAttentionPriority}`}
                                  title={`Opportunity ${intel.opportunityScore} · ${intel.likelyProjectType}`}
                                >
                                  {intel.humanAttentionPriority}
                                </span>
                              )}
                              {reviewMark && (
                                <span
                                  className={`row-review-dot review-${reviewMark}`}
                                  title={reviewMark.replace(/_/g, ' ')}
                                />
                              )}
                            </div>
                            <div className="lead-sub-compact">
                              {domain(row.website) ?? 'no website'}
                              {row.industry && <span> · {row.industry}</span>}
                              {row.location && <span> · {row.location}</span>}
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="col-score"><ScoreCell row={row} /></td>
                      <td className="col-actions">
                        <ReviewActions companyId={row.companyId} status={row.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        )}
      </section>

      {/* ---- Side drawer (URL-driven) ------------------------------- */}
      {selectedLead && (
        <LeadDrawer
          lead={selectedLead}
          signals={data.verifiedSignalsByCompany[selectedLead.companyId] ?? []}
          ai={data.aiByCompany[selectedLead.companyId]}
          currentReview={data.validation.reviewByCompany[selectedLead.companyId] ?? null}
          contacts={getContactsForLead(selectedLead.companyId)}
          evidence={getEvidenceForLead(selectedLead.companyId)}
          intelligence={getIntelligenceForLead(selectedLead.companyId)}
        />
      )}
    </>
  );
}

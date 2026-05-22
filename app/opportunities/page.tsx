// Opportunity Command Center. Compact card list + side drawer for full
// detail. URL-driven selection (?lead=<id>) so a lead is shareable /
// refreshable. Keyboard-first throughput (j/k, s/i/r/v/f/w/t/m, e, ?)
// is owned by OpportunityList — see app/_components/OpportunityList.tsx.

import Link from 'next/link';
import {
  getContactRollupsByCompany,
  getContactsForLead,
  getDashboardData,
  getEvidenceForLead,
  getIntelligenceForLead,
  getIntelligenceSummariesByCompany,
  getOperatorTagsByCompany,
} from '../_lib/dashboardData';
import { LeadDrawer } from '../_components/LeadDrawer';
import { OpportunityHelp } from '../_components/OpportunityHelp';
import {
  OpportunityList,
  type OpportunityListItem,
} from '../_components/OpportunityList';
import { PageHeader } from '../_components/PageHeader';
import { RealModeEmpty } from '../_components/RealModeEmpty';
import { currentDataMode } from '../../src/db/dataMode';
import { CAMPAIGN_LABEL, type Campaign } from '../../src/scoring/campaignTypes';

export const dynamic = 'force-dynamic';

const ALL_CAMPAIGNS: Campaign[] = [
  'AI_AUTOMATION',
  'WEB_REBUILD',
  'FUNNEL_OPTIMIZATION',
  'LOCAL_DIGITAL_UPGRADE',
  'LOW_PRIORITY_NURTURE',
  'REJECT',
];

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string; campaign?: string }>;
}) {
  const params = await searchParams;
  const data = await getDashboardData();
  const intelligenceByCompany = getIntelligenceSummariesByCompany();
  const operatorTagsByCompany = getOperatorTagsByCompany();
  const contactRollups = getContactRollupsByCompany();
  const selectedLeadId = params.lead ?? null;
  const campaignFilter = params.campaign ?? null;

  const visibleRows = campaignFilter
    ? data.reviewQueue.filter((r) => r.primaryCampaign === campaignFilter)
    : data.reviewQueue;

  // Build the list items the OpportunityList renders. We do the joining
  // here so the client component stays a thin rendering layer.
  const items: OpportunityListItem[] = visibleRows.map((row) => ({
    row,
    intel: intelligenceByCompany[row.companyId],
    operatorTags: operatorTagsByCompany[row.companyId] ?? [],
    hasContact: contactRollups[row.companyId]?.hasContact ?? false,
    hasPhone: contactRollups[row.companyId]?.hasPhone ?? false,
  }));

  // Top-line counts shown in the header. Keep this lean — the cards
  // expose the per-lead detail, so we don't repeat A/B/C breakdowns
  // here (the calibration page is the right home for those).
  const immediateCount = items.filter(
    (it) => it.intel?.humanAttentionPriority === 'IMMEDIATE',
  ).length;
  const highCount = items.filter(
    (it) => it.intel?.humanAttentionPriority === 'HIGH',
  ).length;

  const selectedLead = selectedLeadId
    ? data.reviewQueue.find((r) => r.companyId === selectedLeadId) ??
      data.rejected.find((r) => r.companyId === selectedLeadId) ??
      null
    : null;

  return (
    <>
      <PageHeader
        title="Opportunity command center"
        subtitle={`${items.length} in review · ${immediateCount} immediate · ${highCount} high attention`}
      />

      {/* ---- Campaign filter strip + help -------------------------- */}
      <section className="section">
        <div className="filter-strip-row">
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
          <OpportunityHelp />
        </div>
      </section>

      {/* ---- The opportunity card list ------------------------------ */}
      <section className="section">
        {items.length === 0 && !campaignFilter && currentDataMode() === 'REAL' ? (
          <RealModeEmpty />
        ) : items.length === 0 ? (
          <div className="panel">
            <div className="empty">
              <strong>No opportunities in this view</strong>
              {campaignFilter ? (
                <>
                  Try the <Link href="/opportunities">All</Link> filter.
                </>
              ) : (
                <>
                  Run <code>npm run run:discovery</code> or trigger a real pipeline source.
                </>
              )}
            </div>
          </div>
        ) : (
          <OpportunityList
            items={items}
            selectedId={selectedLeadId}
            campaignFilter={campaignFilter}
          />
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

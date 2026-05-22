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
  getOutcomesForLead,
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

// Phase 1 Live Validation — supported Top N slices. URL `?top=25|50|100`.
// Anything else falls back to "all". Pre-sorted by opportunity score
// (with finalScore as tiebreak so leads without intelligence don't
// silently float to the top).
const TOP_N_VALUES = [25, 50, 100] as const;
type TopN = (typeof TOP_N_VALUES)[number];

function parseTop(raw: string | undefined): TopN | null {
  const n = raw ? Number(raw) : NaN;
  return (TOP_N_VALUES as readonly number[]).includes(n) ? (n as TopN) : null;
}

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string; campaign?: string; top?: string }>;
}) {
  const params = await searchParams;
  const data = await getDashboardData();
  const intelligenceByCompany = getIntelligenceSummariesByCompany();
  const operatorTagsByCompany = getOperatorTagsByCompany();
  const contactRollups = getContactRollupsByCompany();
  const selectedLeadId = params.lead ?? null;
  const campaignFilter = params.campaign ?? null;
  const topN = parseTop(params.top);

  // Pre-sort by opportunity score (intelligence-aware ranking),
  // breaking ties with finalScore.
  const sortedQueue = [...data.reviewQueue].sort((a, b) => {
    const aScore = intelligenceByCompany[a.companyId]?.opportunityScore ?? 0;
    const bScore = intelligenceByCompany[b.companyId]?.opportunityScore ?? 0;
    if (bScore !== aScore) return bScore - aScore;
    return b.finalScore - a.finalScore;
  });

  const campaignFiltered = campaignFilter
    ? sortedQueue.filter((r) => r.primaryCampaign === campaignFilter)
    : sortedQueue;
  const visibleRows = topN ? campaignFiltered.slice(0, topN) : campaignFiltered;

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

      {/* ---- Filter strips + help ---------------------------------- */}
      <section className="section">
        <div className="filter-strip-row">
          <div className="filter-strip">
            <Link
              href={topN ? `/opportunities?top=${topN}` : '/opportunities'}
              className={`filter-chip${!campaignFilter ? ' filter-chip-active' : ''}`}
              scroll={false}
            >
              All <span className="filter-chip-count">{data.reviewQueue.length}</span>
            </Link>
            {ALL_CAMPAIGNS.map((c) => {
              const count = data.campaignCounts[c] ?? 0;
              if (count === 0) return null;
              const query = new URLSearchParams({ campaign: c });
              if (topN) query.set('top', String(topN));
              return (
                <Link
                  key={c}
                  href={`/opportunities?${query.toString()}`}
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
        {/* Top N strip — preserves the active campaign so the slice
           composes with whatever filter is already on. */}
        <div className="filter-strip filter-strip-top" style={{ marginTop: 8 }}>
          <Link
            href={
              campaignFilter ? `/opportunities?campaign=${campaignFilter}` : '/opportunities'
            }
            className={`filter-chip${topN === null ? ' filter-chip-active' : ''}`}
            scroll={false}
          >
            All <span className="filter-chip-count">{campaignFiltered.length}</span>
          </Link>
          {TOP_N_VALUES.map((n) => {
            const q = new URLSearchParams({ top: String(n) });
            if (campaignFilter) q.set('campaign', campaignFilter);
            return (
              <Link
                key={n}
                href={`/opportunities?${q.toString()}`}
                className={`filter-chip${topN === n ? ' filter-chip-active' : ''}`}
                scroll={false}
              >
                Top {n}
              </Link>
            );
          })}
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
            topN={topN}
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
          outcomes={getOutcomesForLead(selectedLead.companyId)}
        />
      )}
    </>
  );
}

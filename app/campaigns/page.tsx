// Campaigns — operational segmentation only. Cards convey count +
// avg opportunity + immediate/high counts; the distribution table that
// duplicated this got dropped.

import Link from 'next/link';
import { PageHeader } from '../_components/PageHeader';
import { getCampaignsPageData } from '../_lib/pageData';
import { CAMPAIGN_LABEL, type Campaign } from '../../src/scoring/campaignTypes';

export const dynamic = 'force-dynamic';

// Order reflects pipeline preference: actionable campaigns first,
// nurture next, reject last.
const CAMPAIGN_ORDER: Campaign[] = [
  'AI_AUTOMATION',
  'WEB_REBUILD',
  'FUNNEL_OPTIMIZATION',
  'LOCAL_DIGITAL_UPGRADE',
  'LOW_PRIORITY_NURTURE',
  'REJECT',
];

export default async function CampaignsPage() {
  const { campaigns } = getCampaignsPageData();
  const byKey = new Map<string, (typeof campaigns)[number]>();
  for (const c of campaigns) {
    if (c.campaign) byKey.set(c.campaign, c);
  }

  return (
    <>
      <PageHeader
        title="Campaigns"
        subtitle="Operational segmentation. Click a campaign to filter the Opportunities queue."
      />

      <section className="section">
        <div className="campaign-grid">
          {CAMPAIGN_ORDER.map((c) => {
            const stats = byKey.get(c);
            const total = stats?.total ?? 0;
            // Empty campaigns still render so the operator sees the full
            // segmentation; they're just visually muted.
            if (total === 0) {
              return (
                <div key={c} className={`campaign-card campaign-${c} campaign-card-empty`}>
                  <div className="campaign-card-head">
                    <span className={`campaign-tag campaign-${c}`}>{CAMPAIGN_LABEL[c]}</span>
                    <span className="campaign-count">0</span>
                  </div>
                </div>
              );
            }
            return (
              <Link
                key={c}
                href={`/opportunities?campaign=${c}`}
                className={`campaign-card campaign-${c} campaign-card-link`}
              >
                <div className="campaign-card-head">
                  <span className={`campaign-tag campaign-${c}`}>{CAMPAIGN_LABEL[c]}</span>
                  <span className="campaign-count">{total}</span>
                </div>
                {stats && (
                  <div className="campaign-card-stats">
                    {stats.avg_opp !== null && (
                      <span>avg opp {Math.round(stats.avg_opp ?? 0)}</span>
                    )}
                    {(stats.immediate ?? 0) > 0 && (
                      <span className="attention-pill attention-IMMEDIATE">
                        {stats.immediate} IMMEDIATE
                      </span>
                    )}
                    {(stats.high ?? 0) > 0 && (
                      <span className="attention-pill attention-HIGH">
                        {stats.high} HIGH
                      </span>
                    )}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </section>
    </>
  );
}

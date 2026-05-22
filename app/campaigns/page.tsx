// Campaigns — per-campaign breakdown with attention bucket distribution
// + average opportunity score. Click through to the filtered opportunities
// view for any campaign.

import Link from 'next/link';
import { PageHeader } from '../_components/PageHeader';
import { getCampaignsPageData } from '../_lib/pageData';
import {
  CAMPAIGN_LABEL,
  CAMPAIGN_DESCRIPTION,
  type Campaign,
} from '../../src/scoring/campaignTypes';

export const dynamic = 'force-dynamic';

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
        subtitle="Per-campaign segmentation. Click any campaign to filter the Opportunities queue."
      />

      <section className="section">
        <div className="campaign-grid">
          {CAMPAIGN_ORDER.map((c) => {
            const stats = byKey.get(c);
            const total = stats?.total ?? 0;
            if (total === 0 && c !== 'REJECT') {
              return (
                <div key={c} className={`campaign-card campaign-${c}`}>
                  <div className="campaign-card-head">
                    <span className={`campaign-tag campaign-${c}`}>{CAMPAIGN_LABEL[c]}</span>
                    <span className="campaign-count">0</span>
                  </div>
                  <p className="campaign-desc">{CAMPAIGN_DESCRIPTION[c]}</p>
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
                <p className="campaign-desc">{CAMPAIGN_DESCRIPTION[c]}</p>
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

      <section className="section">
        <h2 className="section-title">Distribution</h2>
        <div className="panel">
          <table className="runs-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Total</th>
                <th>Avg score</th>
                <th>Avg opportunity</th>
                <th>Immediate</th>
                <th>High</th>
                <th>Medium</th>
              </tr>
            </thead>
            <tbody>
              {CAMPAIGN_ORDER.map((c) => {
                const stats = byKey.get(c);
                if (!stats) return null;
                return (
                  <tr key={c}>
                    <td>
                      <span className={`campaign-tag campaign-${c}`}>{CAMPAIGN_LABEL[c]}</span>
                    </td>
                    <td className="num">{stats.total}</td>
                    <td className="num">{stats.avg_score === null ? '—' : Math.round(stats.avg_score)}</td>
                    <td className="num">{stats.avg_opp === null ? '—' : Math.round(stats.avg_opp)}</td>
                    <td className="num">{stats.immediate ?? 0}</td>
                    <td className="num">{stats.high ?? 0}</td>
                    <td className="num">{stats.medium ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

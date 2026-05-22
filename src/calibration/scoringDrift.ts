// Scoring drift — does the system AGREE with the operator at scale?
// Per-campaign accuracy / FP / FR rates. Pure aggregator.

import type { Campaign } from '../scoring/campaignTypes';
import type { CalibrationLeadRow } from '../db/repository';
import type { ScoringDriftReport } from './calibrationTypes';

const AGREEMENT = new Set([
  'correct_campaign',
  'strong_opportunity',
  'interesting_later',
]);

export function computeScoringDrift(rows: CalibrationLeadRow[]): ScoringDriftReport {
  if (rows.length === 0) {
    return {
      totalReviews: 0,
      agreementRate: 0,
      falsePositiveRate: 0,
      falseRejectRate: 0,
      byCampaign: [],
    };
  }
  const total = rows.length;
  const agree = rows.filter((r) => AGREEMENT.has(r.review_type)).length;
  const fp = rows.filter((r) => r.review_type === 'false_positive').length;
  const fr = rows.filter((r) => r.review_type === 'false_reject').length;

  // Per-campaign breakdown
  const byCampaignMap = new Map<Campaign, CalibrationLeadRow[]>();
  for (const r of rows) {
    if (!r.previous_campaign) continue;
    const c = r.previous_campaign as Campaign;
    if (!byCampaignMap.has(c)) byCampaignMap.set(c, []);
    byCampaignMap.get(c)!.push(r);
  }
  const byCampaign = Array.from(byCampaignMap.entries()).map(([campaign, rs]) => ({
    campaign,
    reviewed: rs.length,
    agreement: rs.filter((r) => AGREEMENT.has(r.review_type)).length / rs.length,
    falsePositive:
      rs.filter((r) => r.review_type === 'false_positive').length / rs.length,
    falseReject:
      rs.filter((r) => r.review_type === 'false_reject').length / rs.length,
  }));

  return {
    totalReviews: total,
    agreementRate: agree / total,
    falsePositiveRate: fp / total,
    falseRejectRate: fr / total,
    byCampaign,
  };
}

import type { ReviewQueueRow } from '../types/index';
import type { FalseRejectCandidate } from './types';

// Surfaces leads worth a sanity check. These are not *automatically*
// re-routed — the classifier already handled the obvious case (broken
// site → WEB_REBUILD). The detector flags edge cases the operator
// should manually review during the validation sprint.
//
// Flag patterns:
//   1. REJECT campaign on a lead that still looks like a valid SMB
//      (size 2-50, has a reachable contact, has commercial intent
//      signals). The hard disqualifier may have over-fired.
//   2. LOW_PRIORITY_NURTURE despite strong web/funnel signals — these
//      are leads where a competing campaign almost won but lost to
//      the nurture baseline.
//   3. Actionable campaign but extremely low final score (<40) — the
//      campaign chose this route but the underlying signal is weak;
//      worth a human look before chasing.
export function detectCandidateFalseRejects(
  rows: ReviewQueueRow[],
): FalseRejectCandidate[] {
  const candidates: FalseRejectCandidate[] = [];

  for (const row of rows) {
    const evidence: string[] = [];

    if (row.primaryCampaign === 'REJECT') {
      const codes = new Set(row.reasons.map((r) => r.code));
      const hasSmbSize =
        codes.has('size_ideal') || codes.has('size_good');
      const hasFounder = codes.has('founder_reachable');
      const hasTargetIndustry = codes.has('industry_target');
      if (hasSmbSize || hasFounder || hasTargetIndustry) {
        if (hasSmbSize) evidence.push('SMB-sized headcount detected');
        if (hasFounder) evidence.push('founder/owner contact present');
        if (hasTargetIndustry) evidence.push('industry is in our target list');
        candidates.push({
          companyId: row.companyId,
          company: row.company,
          primaryCampaign: row.primaryCampaign,
          finalScore: row.finalScore,
          flagReason:
            'Rejected as hard disqualifier but the SMB shape looks reachable — verify the disqualifier still applies.',
          evidence,
        });
        continue;
      }
    }

    if (row.primaryCampaign === 'LOW_PRIORITY_NURTURE') {
      const second = topNonNurtureScore(row);
      if (second.score >= 45) {
        candidates.push({
          companyId: row.companyId,
          company: row.company,
          primaryCampaign: row.primaryCampaign,
          finalScore: row.finalScore,
          flagReason: `Landed in nurture but a real campaign (${second.campaign}) scored ${second.score} — re-check whether the nurture baseline outweighed a viable route.`,
          evidence: [`Closest alternative: ${second.campaign} (${second.score})`],
        });
        continue;
      }
    }

    if (
      row.finalScore < 40 &&
      row.primaryCampaign !== 'REJECT' &&
      row.primaryCampaign !== 'LOW_PRIORITY_NURTURE'
    ) {
      candidates.push({
        companyId: row.companyId,
        company: row.company,
        primaryCampaign: row.primaryCampaign,
        finalScore: row.finalScore,
        flagReason:
          'In an actionable campaign but final score is very low — confirm the routing isn’t over-eager.',
        evidence: [`final score ${row.finalScore}`],
      });
    }
  }

  return candidates;
}

function topNonNurtureScore(row: ReviewQueueRow): {
  campaign: string;
  score: number;
} {
  let best = { campaign: 'none', score: 0 };
  for (const [campaign, score] of Object.entries(row.campaignScores)) {
    if (campaign === 'LOW_PRIORITY_NURTURE' || campaign === 'REJECT') continue;
    if (score > best.score) best = { campaign, score };
  }
  return best;
}

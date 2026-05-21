// Narrative insights derived from review patterns. Designed to be displayed
// at the top of the dashboard so the operator notices systemic problems
// before they read individual leads.

import type { FeedbackInsight, ReviewPattern } from './learningTypes';

export function deriveInsights(patterns: ReviewPattern[]): FeedbackInsight[] {
  const out: FeedbackInsight[] = [];

  // Detect a campaign with disproportionate false positives — the most
  // important systemic warning.
  const fpByCampaign = new Map<string, number>();
  for (const p of patterns) {
    if (p.reviewType !== 'false_positive') continue;
    fpByCampaign.set(p.previousCampaign, (fpByCampaign.get(p.previousCampaign) ?? 0) + p.count);
  }
  const topFp = [...fpByCampaign.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topFp && topFp[1] >= 3) {
    out.push({
      headline: `${topFp[0]} is over-routing`,
      detail: `${topFp[1]} leads in ${topFp[0]} were marked as wrongly accepted. Review the campaign's positive signals or raise its routing threshold.`,
      tone: 'warning',
      reviewCount: topFp[1],
    });
  }

  // Detect a campaign that's consistently producing strong opportunities —
  // worth more attention. Even one good signal here is exciting; require 2+.
  const strongByCampaign = new Map<string, number>();
  for (const p of patterns) {
    if (p.reviewType !== 'strong_opportunity') continue;
    strongByCampaign.set(
      p.previousCampaign,
      (strongByCampaign.get(p.previousCampaign) ?? 0) + p.count,
    );
  }
  const topStrong = [...strongByCampaign.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topStrong && topStrong[1] >= 2) {
    out.push({
      headline: `${topStrong[0]} keeps producing strong opportunities`,
      detail: `${topStrong[1]} leads in ${topStrong[0]} have been marked Strong Opportunity — consider expanding sourcing into adjacent industries / locations that fit this campaign.`,
      tone: 'opportunity',
      reviewCount: topStrong[1],
    });
  }

  // Detect persistent false rejects — system is too aggressive on rejects.
  const frCount = patterns
    .filter((p) => p.reviewType === 'false_reject')
    .reduce((a, b) => a + b.count, 0);
  if (frCount >= 3) {
    out.push({
      headline: `${frCount} leads wrongly rejected`,
      detail: `Operator has overridden ${frCount} reject decisions. The rule-based filter or the hard-reject industry list may be too aggressive — review the most common rejection reasons.`,
      tone: 'warning',
      reviewCount: frCount,
    });
  }

  return out;
}

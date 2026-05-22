// Opportunity patterns — recurring shapes of leads the OPERATOR has
// reviewed positively. The detector groups by (industry × size band
// × campaign × accessibility) and keeps any combination that produces
// ≥ the configured minimum sample size.
//
// Pure function over CalibrationLeadRow[].

import type { Campaign } from '../scoring/campaignTypes';
import type { CalibrationLeadRow } from '../db/repository';
import {
  sizeBandFor,
  type OpportunityPattern,
  type OpportunityPatternSegments,
  type SizeBand,
} from './calibrationTypes';

const MIN_SAMPLE = 2; // pattern needs ≥ 2 reviewed leads to surface

const POSITIVE = new Set([
  'correct_campaign',
  'strong_opportunity',
  'weak_opportunity',
  'interesting_later',
]);

// Two grouping dimensions chosen so we don't combinatorially explode:
//   • (industry, sizeBand)           — the "shape of the business" key
//   • (industry, campaign)           — the "what we'd sell them" key
// Each lead contributes to both groupings; the dashboard surfaces
// strongest from each so the operator sees both lenses.
type GroupKey = string;

interface Bucket {
  segments: OpportunityPatternSegments;
  signature: string;
  rows: CalibrationLeadRow[];
}

function pushTo(map: Map<GroupKey, Bucket>, key: GroupKey, bucket: () => Bucket, row: CalibrationLeadRow): void {
  let b = map.get(key);
  if (!b) {
    b = bucket();
    map.set(key, b);
  }
  b.rows.push(row);
}

export function detectOpportunityPatterns(
  rows: CalibrationLeadRow[],
): OpportunityPattern[] {
  const map = new Map<GroupKey, Bucket>();

  for (const row of rows) {
    const industry = (row.industry ?? '').toLowerCase().trim();
    if (!industry) continue;
    const sizeBand: SizeBand = sizeBandFor(row.size_estimate);
    const campaign = (row.previous_campaign ?? null) as Campaign | null;

    // Lens 1: business shape
    const k1: GroupKey = `industry|${industry}|size|${sizeBand}`;
    pushTo(
      map,
      k1,
      () => ({
        segments: { industry, sizeBand },
        signature: `${industry} · ${sizeBand} employees`,
        rows: [],
      }),
      row,
    );

    // Lens 2: industry × campaign
    if (campaign) {
      const k2: GroupKey = `industry|${industry}|campaign|${campaign}`;
      pushTo(
        map,
        k2,
        () => ({
          segments: { industry, campaign },
          signature: `${industry} · ${campaign.toLowerCase().replace(/_/g, ' ')} fit`,
          rows: [],
        }),
        row,
      );
    }

    // Lens 3: accessibility — only one extra grouping, to avoid blow-up
    if (row.has_direct_email) {
      const k3: GroupKey = `industry|${industry}|direct-email`;
      pushTo(
        map,
        k3,
        () => ({
          segments: { industry, hasDirectEmail: true },
          signature: `${industry} · direct email reachable`,
          rows: [],
        }),
        row,
      );
    }
  }

  const out: OpportunityPattern[] = [];
  for (const bucket of map.values()) {
    if (bucket.rows.length < MIN_SAMPLE) continue;
    const positive = bucket.rows.filter((r) => POSITIVE.has(r.review_type)).length;
    const strong = bucket.rows.filter(
      (r) => r.review_type === 'strong_opportunity',
    ).length;
    const fp = bucket.rows.filter((r) => r.review_type === 'false_positive').length;
    const precision = positive / bucket.rows.length;
    const avgOpp =
      bucket.rows.reduce((acc, r) => acc + (r.opportunity_score ?? 0), 0) /
      bucket.rows.length;
    out.push({
      signature: bucket.signature,
      segments: bucket.segments,
      count: bucket.rows.length,
      positiveCount: positive,
      strongCount: strong,
      falsePositiveCount: fp,
      precision,
      avgOpportunityScore: Math.round(avgOpp),
      sampleCompanies: bucket.rows.slice(0, 5).map((r) => r.company_name),
    });
  }

  // Sort by precision × volume so the "rare-but-perfect" and "common-and-
  // reliable" patterns both surface.
  out.sort(
    (a, b) => b.precision * b.count - a.precision * a.count,
  );
  return out;
}

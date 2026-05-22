// Trust-barrier patterns — shapes the SYSTEM thought were good but the
// operator marked false_positive, or where trust_barrier_score was high
// AND the operator agreed (REJECT-routed leads). Pure analyser.

import type { Campaign } from '../scoring/campaignTypes';
import type { CalibrationLeadRow } from '../db/repository';
import {
  sizeBandFor,
  type SizeBand,
  type TrustBarrierPattern,
} from './calibrationTypes';

const MIN_SAMPLE = 2;
const TRUST_BARRIER_THRESHOLD = 35; // rows with score ≥ this enter the analysis

// Small set of "barrier-y" industry tokens. Same as scoreTrustBarrier
// uses internally — kept in sync by code review, not import (these
// modules stay decoupled).
const TECHNICAL_KEYWORDS = [
  'software',
  'saas',
  'platform',
  'ai',
  'cloud',
  'data',
  'engineering',
  'cybersecurity',
];

function industryKeywordFor(industry: string | null): string | null {
  if (!industry) return null;
  const lower = industry.toLowerCase();
  for (const k of TECHNICAL_KEYWORDS) {
    if (lower.includes(k)) return k;
  }
  return null;
}

interface Bucket {
  segments: TrustBarrierPattern['segments'];
  signature: string;
  rows: CalibrationLeadRow[];
}

export function detectTrustBarrierPatterns(
  rows: CalibrationLeadRow[],
): TrustBarrierPattern[] {
  const map = new Map<string, Bucket>();

  for (const row of rows) {
    const barrier = row.trust_barrier_score ?? 0;
    const isFalsePositive = row.review_type === 'false_positive';
    // Only include rows that the operator actively pushed back on OR
    // that had a high system-trust-barrier score (so we can confirm
    // the system was right to flag them).
    if (!isFalsePositive && barrier < TRUST_BARRIER_THRESHOLD) continue;

    const sizeBand: SizeBand = sizeBandFor(row.size_estimate);
    const techKeyword = industryKeywordFor(row.industry);

    // Lens 1: technical-industry keyword × size band
    if (techKeyword) {
      const key = `tech|${techKeyword}|size|${sizeBand}`;
      let bucket = map.get(key);
      if (!bucket) {
        bucket = {
          segments: { industryKeyword: techKeyword, sizeBand },
          signature: `${techKeyword} · ${sizeBand}`,
          rows: [],
        };
        map.set(key, bucket);
      }
      bucket.rows.push(row);
    }

    // Lens 2: campaign × size band (catches "AI_AUTOMATION on enterprise
    // headcount" type patterns)
    if (row.previous_campaign) {
      const campaign = row.previous_campaign as Campaign;
      const key = `campaign|${campaign}|size|${sizeBand}`;
      let bucket = map.get(key);
      if (!bucket) {
        bucket = {
          segments: { campaign, sizeBand },
          signature: `${campaign.toLowerCase().replace(/_/g, ' ')} · ${sizeBand}`,
          rows: [],
        };
        map.set(key, bucket);
      }
      bucket.rows.push(row);
    }
  }

  const out: TrustBarrierPattern[] = [];
  for (const bucket of map.values()) {
    if (bucket.rows.length < MIN_SAMPLE) continue;
    const avgBarrier =
      bucket.rows.reduce((acc, r) => acc + (r.trust_barrier_score ?? 0), 0) /
      bucket.rows.length;
    const rejectCount = bucket.rows.filter(
      (r) => r.previous_campaign === 'REJECT',
    ).length;
    const fpCount = bucket.rows.filter(
      (r) => r.review_type === 'false_positive',
    ).length;
    out.push({
      signature: bucket.signature,
      segments: bucket.segments,
      count: bucket.rows.length,
      avgTrustBarrierScore: Math.round(avgBarrier),
      rejectCount,
      falsePositiveCount: fpCount,
      sampleCompanies: bucket.rows.slice(0, 5).map((r) => r.company_name),
    });
  }
  // Sort by FP-rate × count — the operator wants high-volume mistake
  // patterns first.
  out.sort(
    (a, b) =>
      b.falsePositiveCount * b.count - a.falsePositiveCount * a.count,
  );
  return out;
}

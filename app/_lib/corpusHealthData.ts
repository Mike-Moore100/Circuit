// Data loader for the Corpus Health dashboard section. Pulls the shape
// of the corpus from the DB and runs the pure corpusHealth aggregator.

import { getDb } from '../../src/db/client';
import { visibleOrigins } from '../../src/db/dataMode';
import {
  computeCorpusHealth,
  type CorpusCompany,
  type CorpusHealthReport,
} from '../../src/discovery/corpusHealth';

// Industries we always want to know about even with a small corpus.
// Pulled from the Phase 1 Discovery Diversity brief.
const ALWAYS_FLAG_MISSING = [
  'accountants',
  'recruitment agency',
  'legal firm',
  'estate agents',
];

export function getCorpusHealthReport(): CorpusHealthReport {
  const db = getDb();
  const origins = visibleOrigins();
  const placeholders = origins.map(() => '?').join(',');

  const rows = db
    .prepare(
      `SELECT
         c.industry        AS industry,
         c.source          AS source,
         c.size_estimate   AS size_estimate,
         ls.primary_campaign AS primary_campaign,
         oi.opportunity_score AS opportunity_score
       FROM companies c
       LEFT JOIN (
         SELECT company_id, primary_campaign,
                ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY created_at DESC) AS rn
           FROM lead_scores
       ) ls ON ls.company_id = c.id AND ls.rn = 1
       LEFT JOIN opportunity_intelligence oi ON oi.company_id = c.id
       WHERE c.data_origin IN (${placeholders})`,
    )
    .all(...origins) as Array<{
    industry: string | null;
    source: string;
    size_estimate: number | null;
    primary_campaign: string | null;
    opportunity_score: number | null;
  }>;

  const companies: CorpusCompany[] = rows.map((r) => ({
    industry: r.industry,
    source: r.source,
    primaryCampaign: r.primary_campaign,
    sizeEstimate: r.size_estimate,
    opportunityScore: r.opportunity_score,
  }));

  return computeCorpusHealth(companies, {
    alwaysFlagMissing: ALWAYS_FLAG_MISSING,
  });
}

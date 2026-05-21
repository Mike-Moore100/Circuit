import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { SCHEMA_SQL } from '../src/db/schema';
import {
  insertLeadReview,
  insertReviewMetric,
  countReviewsByType,
  getLatestReviewByCompany,
} from '../src/db/repository';
import {
  computeCampaignMetrics,
  computeReviewTotals,
  computeSourceQuality,
  computeTopReasons,
} from '../src/validation/metrics';
import { detectCandidateFalseRejects } from '../src/validation/falseRejectDetector';
import type { ReviewQueueRow } from '../src/types';
import type { Campaign } from '../src/scoring/campaignTypes';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  // Run the same migrations as production code would.
  for (const col of [
    'primary_campaign TEXT',
    'campaign_scores_json TEXT',
    'campaign_reasons_json TEXT',
    'primary_reason TEXT',
    'suggested_investigation TEXT',
  ]) {
    try {
      db.exec(`ALTER TABLE lead_scores ADD COLUMN ${col}`);
    } catch {
      /* duplicate column */
    }
  }
  return db;
}

function seedCompany(db: Database.Database, name: string, source = 'google_maps'): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO companies
       (id, name, domain, website_url, industry, location, size_estimate,
        source, source_url, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'accounting', 'London', 10, ?, NULL, 'review',
             datetime('now'), datetime('now'))`,
  ).run(id, name, `${name.replace(/\s+/g, '-').toLowerCase()}.example`, `https://${name.replace(/\s+/g, '-').toLowerCase()}.example`, source);
  return id;
}

function seedScore(
  db: Database.Database,
  companyId: string,
  finalScore: number,
  campaign: Campaign,
  reasonsByCampaign: Partial<Record<Campaign, Array<{ code: string; label: string; delta: number }>>> = {},
  trueRejectionReasons: Array<{ code: string; label: string; delta: number }> = [],
) {
  db.prepare(
    `INSERT INTO lead_scores
       (id, company_id, rule_score, intent_score, final_score, priority,
        reasons_json, primary_campaign, campaign_scores_json,
        campaign_reasons_json, primary_reason, suggested_investigation,
        created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    randomUUID(),
    companyId,
    finalScore,
    finalScore,
    finalScore,
    campaign === 'REJECT' ? 'Reject' : 'B',
    JSON.stringify({ rule: { reasons: [], rejectionReasons: [] }, intent: { reasons: [] } }),
    campaign,
    JSON.stringify({}),
    JSON.stringify({ reasons: reasonsByCampaign, trueRejectionReasons }),
    'test reason',
    'test next step',
  );
}

function makeRow(overrides: Partial<ReviewQueueRow>): ReviewQueueRow {
  return {
    companyId: 'cid',
    company: 'Test Co',
    website: 'https://test.example',
    industry: 'accounting',
    location: 'London',
    sizeEstimate: 12,
    source: 'google_maps',
    ruleScore: 70,
    intentScore: 60,
    finalScore: 65,
    priority: 'B',
    status: 'queued',
    reasons: [],
    rejectionReasons: [],
    likelyPainPoints: [],
    suggestedNextStep: '',
    updatedAt: new Date().toISOString(),
    primaryCampaign: 'AI_AUTOMATION',
    campaignScores: {
      AI_AUTOMATION: 70,
      WEB_REBUILD: 10,
      FUNNEL_OPTIMIZATION: 5,
      LOCAL_DIGITAL_UPGRADE: 0,
      LOW_PRIORITY_NURTURE: 28,
      REJECT: 0,
    },
    primaryReason: '',
    ...overrides,
  };
}

describe('lead_reviews persistence', () => {
  it('stores a review and surfaces it via getLatestReviewByCompany', () => {
    const db = makeDb();
    const id = seedCompany(db, 'Acme');
    insertLeadReview(
      {
        companyId: id,
        reviewType: 'strong_opportunity',
        previousCampaign: 'AI_AUTOMATION',
        reviewerNotes: 'great fit',
      },
      db,
    );
    const map = getLatestReviewByCompany(db);
    expect(map.size).toBe(1);
    expect(map.get(id)?.review_type).toBe('strong_opportunity');
  });

  it('only returns the most recent review per company', () => {
    const db = makeDb();
    const id = seedCompany(db, 'Acme');
    insertLeadReview({ companyId: id, reviewType: 'weak_opportunity' }, db);
    insertLeadReview({ companyId: id, reviewType: 'strong_opportunity' }, db);
    const map = getLatestReviewByCompany(db);
    expect(map.get(id)?.review_type).toBe('strong_opportunity');
  });

  it('counts reviews by type', () => {
    const db = makeDb();
    const a = seedCompany(db, 'A');
    const b = seedCompany(db, 'B');
    insertLeadReview({ companyId: a, reviewType: 'correct_campaign' }, db);
    insertLeadReview({ companyId: b, reviewType: 'false_reject' }, db);
    const counts = countReviewsByType(db);
    expect(counts.correct_campaign).toBe(1);
    expect(counts.false_reject).toBe(1);
  });
});

describe('review_metrics persistence', () => {
  it('inserts metric snapshots', () => {
    const db = makeDb();
    insertReviewMetric({ metricType: 'lead.total', value: 42 }, db);
    insertReviewMetric({ metricType: 'lead.total', value: 50, source: 'validate:sample' }, db);
    const rows = db.prepare('SELECT * FROM review_metrics').all() as Array<{ value: number }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.value).sort()).toEqual([42, 50]);
  });
});

describe('computeCampaignMetrics', () => {
  it('aggregates totals + avg score + reviewer feedback per campaign', () => {
    const db = makeDb();
    const lumen = seedCompany(db, 'Lumen Marketing');
    const acme = seedCompany(db, 'Acme Bookkeeping');
    const broken = seedCompany(db, 'Broken Salon');
    seedScore(db, lumen, 90, 'AI_AUTOMATION');
    seedScore(db, acme, 80, 'AI_AUTOMATION');
    seedScore(db, broken, 60, 'WEB_REBUILD');

    insertLeadReview({ companyId: lumen, reviewType: 'strong_opportunity' }, db);
    insertLeadReview({ companyId: acme, reviewType: 'false_positive' }, db);

    const metrics = computeCampaignMetrics(db);
    const ai = metrics.find((m) => m.campaign === 'AI_AUTOMATION')!;
    expect(ai.total).toBe(2);
    expect(ai.avgFinalScore).toBe(85);
    expect(ai.reviewedTotal).toBe(2);
    expect(ai.reviewCounts.strong_opportunity).toBe(1);
    expect(ai.reviewCounts.false_positive).toBe(1);
    expect(ai.falsePositiveRate).toBeCloseTo(0.5, 5);
    expect(ai.correctRate).toBe(0);

    const web = metrics.find((m) => m.campaign === 'WEB_REBUILD')!;
    expect(web.total).toBe(1);
    expect(web.falseRejectRate).toBeNull(); // no reviews yet
  });
});

describe('computeSourceQuality', () => {
  it('groups leads by source and reports campaign mix + avg score', () => {
    const db = makeDb();
    const a = seedCompany(db, 'A', 'google_maps');
    const b = seedCompany(db, 'B', 'google_maps');
    const c = seedCompany(db, 'C', 'mock');
    seedScore(db, a, 80, 'AI_AUTOMATION');
    seedScore(db, b, 60, 'WEB_REBUILD');
    seedScore(db, c, 50, 'LOW_PRIORITY_NURTURE');
    const sq = computeSourceQuality(db);
    expect(sq.find((s) => s.source === 'google_maps')?.totalLeads).toBe(2);
    expect(sq.find((s) => s.source === 'google_maps')?.avgFinalScore).toBe(70);
    expect(sq.find((s) => s.source === 'google_maps')?.byCampaign.AI_AUTOMATION).toBe(1);
    expect(sq.find((s) => s.source === 'mock')?.totalLeads).toBe(1);
  });
});

describe('computeTopReasons', () => {
  it('aggregates positive reasons per primary campaign', () => {
    const db = makeDb();
    const a = seedCompany(db, 'A');
    const b = seedCompany(db, 'B');
    seedScore(db, a, 80, 'AI_AUTOMATION', {
      AI_AUTOMATION: [
        { code: 'ai_target_industry', label: 'Target industry', delta: 22 },
      ],
    });
    seedScore(db, b, 75, 'AI_AUTOMATION', {
      AI_AUTOMATION: [
        { code: 'ai_target_industry', label: 'Target industry', delta: 22 },
        { code: 'ai_founder_reachable', label: 'Founder reachable', delta: 8 },
      ],
    });
    const reasons = computeTopReasons(db);
    const ai = reasons.byCampaign.AI_AUTOMATION;
    expect(ai[0].code).toBe('ai_target_industry');
    expect(ai[0].count).toBe(2);
  });

  it('aggregates true-rejection reasons across the dataset', () => {
    const db = makeDb();
    const a = seedCompany(db, 'A');
    const b = seedCompany(db, 'B');
    seedScore(db, a, 5, 'REJECT', {}, [
      { code: 'enterprise', label: 'Enterprise scale — out of ICP', delta: 0 },
    ]);
    seedScore(db, b, 5, 'REJECT', {}, [
      { code: 'enterprise', label: 'Enterprise scale — out of ICP', delta: 0 },
      { code: 'internal_automation_team', label: 'Internal team', delta: 0 },
    ]);
    const reasons = computeTopReasons(db);
    expect(reasons.trueRejections.find((r) => r.code === 'enterprise')?.count).toBe(2);
  });
});

describe('detectCandidateFalseRejects', () => {
  it('flags a REJECT lead that still has SMB shape', () => {
    const candidates = detectCandidateFalseRejects([
      makeRow({
        primaryCampaign: 'REJECT',
        company: 'Suspicious Co',
        finalScore: 15,
        reasons: [
          { code: 'size_good', label: 'Good SMB headcount', delta: 10 },
          { code: 'founder_reachable', label: 'Founder reachable', delta: 10 },
        ],
      }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].company).toBe('Suspicious Co');
  });

  it('flags a LOW_PRIORITY_NURTURE lead with a strong competing campaign score', () => {
    const candidates = detectCandidateFalseRejects([
      makeRow({
        primaryCampaign: 'LOW_PRIORITY_NURTURE',
        company: 'Edge Case Co',
        campaignScores: {
          AI_AUTOMATION: 60, // strong competing alternative
          WEB_REBUILD: 0,
          FUNNEL_OPTIMIZATION: 0,
          LOCAL_DIGITAL_UPGRADE: 0,
          LOW_PRIORITY_NURTURE: 55,
          REJECT: 0,
        },
      }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].flagReason).toMatch(/AI_AUTOMATION/);
  });

  it('flags actionable-campaign leads with very low final scores', () => {
    const candidates = detectCandidateFalseRejects([
      makeRow({
        primaryCampaign: 'WEB_REBUILD',
        company: 'Thin Lead Co',
        finalScore: 30,
      }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].flagReason).toMatch(/score is very low/i);
  });

  it('does NOT flag a healthy AI_AUTOMATION lead', () => {
    const candidates = detectCandidateFalseRejects([
      makeRow({
        primaryCampaign: 'AI_AUTOMATION',
        company: 'Healthy Lead',
        finalScore: 80,
        reasons: [],
      }),
    ]);
    expect(candidates).toHaveLength(0);
  });
});

describe('Phase 6 invariants still hold (validation sprint reaffirms them)', () => {
  it('broken-website SMB routes to WEB_REBUILD, not REJECT', async () => {
    const { evaluateRules } = await import('../src/filters/ruleBasedFilter');
    const { evaluateIntent } = await import('../src/scoring/intentScoring');
    const { classifyCampaign } = await import('../src/scoring/campaignClassifier');
    const lead = {
      companyName: 'Riverwood Salon',
      websiteUrl: 'https://riverwood.example',
      industry: 'local services',
      location: 'Leeds',
      sizeEstimate: 9,
      source: 'mock',
      sourceUrl: null,
      contactName: 'Mia',
      contactRole: 'Owner',
      contactEmail: null,
      linkedinUrl: null,
      notes: null,
      signals: [
        { type: 'team', value: 'founder reachable', confidence: 95 },
        { type: 'verified.website_failed', value: 'fetch failed', confidence: 95 },
      ],
    };
    const result = classifyCampaign(lead, evaluateRules(lead), evaluateIntent(lead));
    expect(result.primary).toBe('WEB_REBUILD');
  });

  it('weak digital SMB is NOT auto-rejected', async () => {
    const { evaluateRules } = await import('../src/filters/ruleBasedFilter');
    const { evaluateIntent } = await import('../src/scoring/intentScoring');
    const { classifyCampaign } = await import('../src/scoring/campaignClassifier');
    const lead = {
      companyName: 'Northshore Plumbing',
      websiteUrl: null, // no website
      industry: 'local services',
      location: 'Brighton',
      sizeEstimate: 6,
      source: 'mock',
      sourceUrl: null,
      contactName: 'Pete',
      contactRole: 'Owner',
      contactEmail: null,
      linkedinUrl: null,
      notes: null,
      signals: [
        { type: 'team', value: 'founder reachable', confidence: 95 },
        { type: 'workflow', value: 'scheduling', confidence: 70 },
      ],
    };
    const result = classifyCampaign(lead, evaluateRules(lead), evaluateIntent(lead));
    expect(result.primary).not.toBe('REJECT');
    expect(result.primary).toBe('LOCAL_DIGITAL_UPGRADE');
  });
});

describe('computeReviewTotals', () => {
  it('returns zero counts when no reviews exist', () => {
    const db = makeDb();
    const totals = computeReviewTotals(db);
    expect(totals.correct_campaign).toBe(0);
    expect(totals.false_reject).toBe(0);
  });
  it('returns accurate counts after reviews are recorded', () => {
    const db = makeDb();
    const a = seedCompany(db, 'A');
    insertLeadReview({ companyId: a, reviewType: 'strong_opportunity' }, db);
    const totals = computeReviewTotals(db);
    expect(totals.strong_opportunity).toBe(1);
  });
});

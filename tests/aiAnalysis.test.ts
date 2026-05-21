import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { SCHEMA_SQL } from '../src/db/schema';
import {
  analyzeOneLead,
  analyzeTopLeads,
} from '../src/ai/aiAnalysisEngine';
import { PROMPT_VERSION, type AiProvider, type PromptInput } from '../src/ai/aiTypes';
import { hashPromptInput } from '../src/ai/aiCache';
import { checkBudgetForCost, getTodaySpendUsd } from '../src/ai/aiBudget';
import { estimateCostUsd, pricingFor } from '../src/ai/providers/types';
import { createMockAiProvider } from '../src/ai/providers/mockAiProvider';
import { persistAiAnalysis } from '../src/db/repository';
import { config } from '../src/config/index';

// Build an in-memory SQLite DB seeded with one company so the engine has
// somewhere to write rows.
function makeDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

function seedCompany(db: Database.Database, id = randomUUID()): string {
  const short = id.slice(0, 8);
  db.prepare(
    `INSERT INTO companies
       (id, name, domain, website_url, industry, location, size_estimate,
        source, source_url, status, created_at, updated_at)
     VALUES
       (?, ?, ?, ?, 'accounting',
        'London', 10, 'google_maps', NULL, 'review', datetime('now'), datetime('now'))`,
  ).run(id, `Acme ${short}`, `acme-${short}.example`, `https://acme-${short}.example`);
  return id;
}

const baseInput = (overrides: Partial<PromptInput> = {}): PromptInput => ({
  promptVersion: PROMPT_VERSION,
  company: {
    companyName: 'Acme Bookkeeping',
    industry: 'accounting',
    location: 'London',
    websiteUrl: 'https://acme.example',
    source: 'google_maps',
    sizeEstimate: 10,
  },
  scoring: {
    finalScore: 88,
    ruleScore: 92,
    intentScore: 82,
    priority: 'A',
    reasons: [{ label: 'Target industry match: accounting', delta: 14 }],
    rejectionReasons: [],
  },
  verifiedSignals: [
    { type: 'verified.has_contact_form', value: '/contact', confidence: 90 },
  ],
  homepageSnippet: 'We handle bookkeeping for small businesses.',
  contact: null,
  ...overrides,
});

describe('analyzeOneLead', () => {
  it('returns ok with a parsed result via the mock provider', async () => {
    const db = makeDb();
    const companyId = seedCompany(db);
    const provider = createMockAiProvider('mock-test');
    const outcome = await analyzeOneLead(companyId, baseInput(), { provider, db });
    expect(outcome.status).toBe('ok');
    expect(outcome.result?.summary).toBeTruthy();
    expect(outcome.result?.operationalPainPoints.length).toBeGreaterThan(0);
    expect(outcome.analysisId).toBeTruthy();
  });

  it('persists the row and hits cache on the second call', async () => {
    const db = makeDb();
    const companyId = seedCompany(db);
    const provider = createMockAiProvider('mock-test');

    const first = await analyzeOneLead(companyId, baseInput(), { provider, db });
    expect(first.status).toBe('ok');

    const second = await analyzeOneLead(companyId, baseInput(), { provider, db });
    expect(second.status).toBe('cache_hit');
    expect(second.fromCache).toBe(true);
    expect(second.analysisId).toBe(first.analysisId);
  });

  it('input hash changes when scoring evidence changes', async () => {
    const db = makeDb();
    const companyId = seedCompany(db);
    const provider = createMockAiProvider('mock-test');

    const first = await analyzeOneLead(companyId, baseInput(), { provider, db });

    const updated = baseInput({
      verifiedSignals: [
        { type: 'verified.has_booking_link', value: 'calendly', confidence: 80 },
      ],
    });
    const second = await analyzeOneLead(companyId, updated, { provider, db });
    expect(second.status).toBe('ok');
    expect(second.inputHash).not.toBe(first.inputHash);
  });

  it('returns failed when the provider response cannot be parsed', async () => {
    const db = makeDb();
    const companyId = seedCompany(db);
    const garbageProvider: AiProvider = {
      name: 'garbage',
      model: 'test',
      async generate() {
        return {
          rawJson: 'this is not json at all',
          usage: { inputTokens: 100, outputTokens: 20 },
          estimatedCostUsd: 0.0001,
          provider: 'garbage',
          model: 'test',
        };
      },
    };
    const outcome = await analyzeOneLead(companyId, baseInput(), {
      provider: garbageProvider,
      db,
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.errorMessage).toBeTruthy();
  });

  it('respects AI_ANALYSIS_ENABLED toggle', async () => {
    const db = makeDb();
    const companyId = seedCompany(db);
    const before = config.aiAnalysis.enabled;
    (config.aiAnalysis as { enabled: boolean }).enabled = false;
    try {
      const outcome = await analyzeOneLead(companyId, baseInput(), { db });
      expect(outcome.status).toBe('skipped_disabled');
    } finally {
      (config.aiAnalysis as { enabled: boolean }).enabled = before;
    }
  });
});

describe('budget enforcement', () => {
  it('refuses calls once daily spend reaches the limit', async () => {
    const db = makeDb();
    const companyId = seedCompany(db);
    const original = config.aiAnalysis.dailyCostLimitUsd;
    (config.aiAnalysis as { dailyCostLimitUsd: number }).dailyCostLimitUsd = 0.0005;
    try {
      // Pre-spend the budget by writing a high-cost row.
      persistAiAnalysis(
        {
          id: 'pre-spend',
          companyId,
          promptVersion: PROMPT_VERSION,
          inputHash: 'pre-existing',
          provider: 'mock',
          model: 'mock',
          summary: 'pre',
          confidence: 50,
          operationalPainPointsJson: '[]',
          automationOpportunitiesJson: '[]',
          estimatedBusinessImpactJson: '[]',
          likelyBuyerJson: '{}',
          urgencyJson: '{}',
          proofAnglesJson: '[]',
          risksJson: '[]',
          rawResponseJson: '{}',
          tokensInput: 1000,
          tokensCached: 0,
          tokensOutput: 200,
          estimatedCost: 1.0,
          status: 'ok',
          errorMessage: null,
        },
        db,
      );

      const provider = createMockAiProvider('mock-test');
      const outcome = await analyzeOneLead(companyId, baseInput(), { provider, db });
      expect(outcome.status).toBe('skipped_budget');
      expect(outcome.errorMessage).toMatch(/budget|cost ceiling/i);
    } finally {
      (config.aiAnalysis as { dailyCostLimitUsd: number }).dailyCostLimitUsd = original;
    }
  });

  it('checkBudgetForCost returns allowed=true when under the cap', () => {
    const db = makeDb();
    seedCompany(db);
    const check = checkBudgetForCost(0.0001, db);
    expect(check.allowed).toBe(true);
    expect(check.spentTodayUsd).toBe(0);
  });

  it('tracks today\'s spend as rows accumulate', () => {
    const db = makeDb();
    const companyId = seedCompany(db);
    expect(getTodaySpendUsd(db)).toBe(0);
    persistAiAnalysis(
      {
        id: 'row',
        companyId,
        promptVersion: PROMPT_VERSION,
        inputHash: 'h',
        provider: 'mock',
        model: 'mock',
        summary: null,
        confidence: null,
        operationalPainPointsJson: null,
        automationOpportunitiesJson: null,
        estimatedBusinessImpactJson: null,
        likelyBuyerJson: null,
        urgencyJson: null,
        proofAnglesJson: null,
        risksJson: null,
        rawResponseJson: null,
        tokensInput: 0,
        tokensCached: 0,
        tokensOutput: 0,
        estimatedCost: 0.05,
        status: 'ok',
        errorMessage: null,
      },
      db,
    );
    expect(getTodaySpendUsd(db)).toBeCloseTo(0.05, 6);
  });
});

describe('analyzeTopLeads', () => {
  it('respects the per-run cap and priority allow-list', async () => {
    const db = makeDb();
    const provider = createMockAiProvider('mock-test');
    const allowed = config.aiAnalysis.allowedPriorities;
    const cap = config.aiAnalysis.maxLeadsPerRun;

    (config.aiAnalysis as { allowedPriorities: Array<'A' | 'B' | 'C'> }).allowedPriorities = ['A'];
    (config.aiAnalysis as { maxLeadsPerRun: number }).maxLeadsPerRun = 2;
    try {
      const ids = [seedCompany(db), seedCompany(db), seedCompany(db)];
      const candidates = ids.map((id, i) => ({
        companyId: id,
        priority: (i === 2 ? 'B' : 'A') as 'A' | 'B',
        input: baseInput(),
      }));
      const summary = await analyzeTopLeads(candidates, { provider, db });
      // Only the two A-priority leads get analysed.
      expect(summary.attempted).toBe(2);
      expect(summary.ok).toBe(2);
    } finally {
      (config.aiAnalysis as { allowedPriorities: Array<'A' | 'B' | 'C'> }).allowedPriorities = allowed;
      (config.aiAnalysis as { maxLeadsPerRun: number }).maxLeadsPerRun = cap;
    }
  });
});

describe('pricing', () => {
  it('estimates cost from token usage', () => {
    const cost = estimateCostUsd('claude-haiku-4-5-20251001', {
      inputTokens: 1000,
      outputTokens: 500,
      cachedInputTokens: 0,
    });
    // 1000 in @ $1/M + 500 out @ $5/M = $0.001 + $0.0025 = $0.0035
    expect(cost).toBeCloseTo(0.0035, 6);
  });

  it('cached inputs cost ~10x less than fresh ones', () => {
    const fresh = estimateCostUsd('claude-haiku-4-5-20251001', {
      inputTokens: 10000,
      outputTokens: 0,
    });
    const cached = estimateCostUsd('claude-haiku-4-5-20251001', {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 10000,
    });
    expect(cached).toBeLessThan(fresh / 9);
  });

  it('falls back to a known pricing table for unknown models', () => {
    expect(pricingFor('unknown-model').input).toBeGreaterThan(0);
  });
});

describe('hashPromptInput', () => {
  it('returns a hex sha256 string', () => {
    const hash = hashPromptInput(baseInput());
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

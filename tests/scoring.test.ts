import { describe, it, expect } from 'vitest';
import { MOCK_LEADS } from '../src/sources/mockSourceConnector';
import { evaluateRules } from '../src/filters/ruleBasedFilter';
import {
  evaluateIntent,
  combineScores,
  priorityFor,
  scoreLead,
} from '../src/scoring/intentScoring';
import { dedupeLeads } from '../src/filters/dedupe';
import { PRIORITY_THRESHOLDS } from '../src/scoring/scoringConfig';
import type { RawLead } from '../src/types';

function bySource(name: string): RawLead {
  const lead = MOCK_LEADS.find((l) => l.companyName === name);
  if (!lead) throw new Error(`Missing fixture: ${name}`);
  return lead;
}

describe('rule filter', () => {
  it('penalises a restaurant heavily', () => {
    const result = evaluateRules(bySource('La Tavola Rossa'));
    expect(result.pass).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'industry_bad_fit')).toBe(true);
  });

  it('rejects enterprise leads', () => {
    const result = evaluateRules(bySource('Hyperion Cloud Systems'));
    expect(result.pass).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'enterprise')).toBe(true);
  });

  it('rejects hobby projects with no website', () => {
    const result = evaluateRules(bySource('pixeldoodle'));
    expect(result.pass).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'no_website')).toBe(true);
  });

  it('passes an ideal SMB recruitment agency', () => {
    const result = evaluateRules(bySource('Northbeam Talent'));
    expect(result.pass).toBe(true);
    expect(result.ruleScore).toBeGreaterThanOrEqual(75);
    expect(result.reasons.some((r) => r.code === 'size_ideal')).toBe(true);
    expect(result.reasons.some((r) => r.code === 'industry_target')).toBe(true);
    expect(result.reasons.some((r) => r.code === 'founder_reachable')).toBe(true);
  });

  it('produces 0–100 scores for every fixture', () => {
    for (const lead of MOCK_LEADS) {
      const result = evaluateRules(lead);
      expect(result.ruleScore).toBeGreaterThanOrEqual(0);
      expect(result.ruleScore).toBeLessThanOrEqual(100);
    }
  });
});

describe('intent scoring', () => {
  it('returns an explainable component breakdown', () => {
    const lead = bySource('Cedar & Quill Bookkeeping');
    const result = evaluateIntent(lead);
    expect(result.intentScore).toBeGreaterThan(0);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.components.manualWorkload).toBeGreaterThan(50);
    expect(result.components.decisionMakerAccess).toBeGreaterThan(50);
  });

  it('penalises trust barrier for big firms', () => {
    const result = evaluateIntent(bySource('Hyperion Cloud Systems'));
    expect(result.components.trustBarrierRisk).toBeLessThan(0);
  });
});

describe('priority bucketing', () => {
  it('uses the configured thresholds', () => {
    expect(priorityFor(PRIORITY_THRESHOLDS.A)).toBe('A');
    expect(priorityFor(PRIORITY_THRESHOLDS.B)).toBe('B');
    expect(priorityFor(PRIORITY_THRESHOLDS.C)).toBe('C');
    expect(priorityFor(PRIORITY_THRESHOLDS.C - 1)).toBe('Reject');
  });
});

describe('combined scoring — ranking sanity', () => {
  const ranked = [...MOCK_LEADS]
    .map((lead) => ({ lead, combined: scoreLead(lead) }))
    .sort((a, b) => b.combined.finalScore - a.combined.finalScore);

  const positionOf = (name: string) => ranked.findIndex((r) => r.lead.companyName === name);

  it('ranks good-fit SMBs above bad-fit fixtures', () => {
    const goodFits = [
      'Northbeam Talent',
      'Lumen & Co Marketing',
      'Cedar & Quill Bookkeeping',
      'Harborline Property Group',
      'Inkstream',
      'Boulder Bench Co',
    ];
    const badFits = ['La Tavola Rossa', 'Hyperion Cloud Systems', 'pixeldoodle'];
    for (const good of goodFits) {
      for (const bad of badFits) {
        expect(
          positionOf(good),
          `expected ${good} to rank above ${bad}`,
        ).toBeLessThan(positionOf(bad));
      }
    }
  });

  it('all good-fit fixtures clear the C threshold', () => {
    for (const name of [
      'Northbeam Talent',
      'Lumen & Co Marketing',
      'Cedar & Quill Bookkeeping',
      'Harborline Property Group',
      'Inkstream',
      'Boulder Bench Co',
    ]) {
      const entry = ranked.find((r) => r.lead.companyName === name)!;
      expect(entry.combined.finalScore).toBeGreaterThanOrEqual(PRIORITY_THRESHOLDS.C);
      expect(entry.combined.priority).not.toBe('Reject');
    }
  });

  it('true disqualifiers route to REJECT campaign', () => {
    // Phase 6: only hard disqualifiers (enterprise, hobby project, internal
    // automation team, big-corp industry) are true rejects. Restaurants and
    // other low-priority industries route to nurture instead.
    for (const name of ['Hyperion Cloud Systems', 'pixeldoodle']) {
      const entry = ranked.find((r) => r.lead.companyName === name)!;
      expect(entry.combined.campaign.primary).toBe('REJECT');
    }
  });

  it('restaurants are NOT rejected — they land in LOW_PRIORITY_NURTURE or a web campaign', () => {
    const tavola = ranked.find((r) => r.lead.companyName === 'La Tavola Rossa')!;
    expect(tavola.combined.campaign.primary).not.toBe('REJECT');
  });
});

describe('dedupe', () => {
  it('merges duplicate leads by domain', () => {
    const a = bySource('Northbeam Talent');
    const b: RawLead = { ...a, contactEmail: null, contactName: null };
    const { unique, dropped } = dedupeLeads([a, b]);
    expect(unique).toHaveLength(1);
    expect(dropped).toBe(1);
    expect(unique[0].contactEmail).toBe(a.contactEmail);
  });
});

describe('combineScores math', () => {
  it('respects FINAL_WEIGHTS bounds', () => {
    const lead = bySource('Lumen & Co Marketing');
    const rule = evaluateRules(lead);
    const intent = evaluateIntent(lead);
    const combined = combineScores(rule, intent, lead);
    expect(combined.finalScore).toBeGreaterThanOrEqual(0);
    expect(combined.finalScore).toBeLessThanOrEqual(100);
    expect(combined.finalScore).toBeLessThanOrEqual(Math.max(rule.ruleScore, intent.intentScore) + 1);
  });
});

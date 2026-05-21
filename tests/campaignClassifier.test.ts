import { describe, it, expect } from 'vitest';
import { classifyCampaign } from '../src/scoring/campaignClassifier';
import { evaluateRules } from '../src/filters/ruleBasedFilter';
import { evaluateIntent } from '../src/scoring/intentScoring';
import type { RawLead } from '../src/types';

function lead(overrides: Partial<RawLead> = {}): RawLead {
  return {
    companyName: 'Test Co',
    websiteUrl: 'https://test.example',
    industry: 'marketing agency',
    location: 'London, UK',
    sizeEstimate: 10,
    source: 'mock',
    sourceUrl: null,
    contactName: 'Sam Owner',
    contactRole: 'Owner',
    contactEmail: 'sam@test.example',
    linkedinUrl: null,
    notes: null,
    signals: [],
    ...overrides,
  };
}

function classify(l: RawLead) {
  const rule = evaluateRules(l);
  const intent = evaluateIntent(l);
  return classifyCampaign(l, rule, intent);
}

describe('campaign classifier — routing', () => {
  it('routes a failed-website SMB to WEB_REBUILD (not REJECT)', () => {
    const l = lead({
      companyName: 'Riverwood Hair Salon',
      websiteUrl: 'https://riverwood-hair.example',
      industry: 'local services',
      sizeEstimate: 9,
      signals: [
        { type: 'team', value: 'founder reachable', confidence: 90 },
        { type: 'verified.website_failed', value: 'fetch failed', confidence: 95 },
      ],
    });
    const result = classify(l);
    expect(result.primary).toBe('WEB_REBUILD');
    expect(result.trueRejectionReasons).toHaveLength(0);
  });

  it('routes a no-website real SMB to LOCAL_DIGITAL_UPGRADE', () => {
    const l = lead({
      companyName: 'Northshore Plumbing',
      websiteUrl: null,
      industry: 'local services',
      sizeEstimate: 6,
      signals: [
        { type: 'team', value: 'founder reachable', confidence: 95 },
        { type: 'workflow', value: 'scheduling', confidence: 70 },
      ],
    });
    const result = classify(l);
    expect(result.primary).toBe('LOCAL_DIGITAL_UPGRADE');
    expect(result.trueRejectionReasons).toHaveLength(0);
  });

  it('still REJECTs an enterprise lead', () => {
    const l = lead({
      companyName: 'Hyperion Cloud Systems',
      industry: 'enterprise software',
      sizeEstimate: 4200,
      signals: [
        { type: 'size', value: 'enterprise', confidence: 99 },
        { type: 'team', value: 'internal automation team', confidence: 95 },
      ],
    });
    const result = classify(l);
    expect(result.primary).toBe('REJECT');
    expect(result.trueRejectionReasons.length).toBeGreaterThan(0);
  });

  it('still REJECTs a hobby project (size 1, no commercial intent)', () => {
    const l = lead({
      companyName: 'pixeldoodle',
      websiteUrl: null,
      industry: null,
      sizeEstimate: 1,
      contactRole: 'Maintainer',
      signals: [
        { type: 'project', value: 'hobby project', confidence: 95 },
        { type: 'commercial', value: 'no commercial intent', confidence: 90 },
      ],
    });
    const result = classify(l);
    expect(result.primary).toBe('REJECT');
    expect(result.trueRejectionReasons.some((r) => r.code === 'hobby_project')).toBe(true);
  });

  it('rejects when the lead has its own internal automation team', () => {
    const l = lead({
      industry: 'marketing agency',
      sizeEstimate: 30,
      signals: [
        { type: 'team', value: 'internal automation team', confidence: 95 },
      ],
    });
    const result = classify(l);
    expect(result.primary).toBe('REJECT');
    expect(
      result.trueRejectionReasons.some((r) => r.code === 'internal_automation_team'),
    ).toBe(true);
  });

  it('routes an ICP service business with a working site + manual workflow language to AI_AUTOMATION', () => {
    const l = lead({
      companyName: 'Lumen & Co Marketing',
      industry: 'marketing agency',
      sizeEstimate: 18,
      signals: [
        { type: 'workflow', value: 'reporting cadence', confidence: 85 },
        { type: 'workflow', value: 'admin overhead', confidence: 70 },
        { type: 'workflow', value: 'manual data entry', confidence: 75 },
        { type: 'verified.website_loads', value: 'ok', confidence: 100 },
        { type: 'verified.has_contact_form', value: '/contact', confidence: 90 },
        { type: 'verified.has_services_page', value: '/services', confidence: 85 },
        { type: 'verified.has_manual_workflow_language', value: 'phrases', confidence: 80 },
        { type: 'verified.high_automation_fit', value: 'phrases', confidence: 80 },
        { type: 'team', value: 'founder reachable', confidence: 95 },
      ],
    });
    const result = classify(l);
    expect(result.primary).toBe('AI_AUTOMATION');
    expect(result.trueRejectionReasons).toHaveLength(0);
  });

  it('routes a restaurant to LOW_PRIORITY_NURTURE — NOT a hard reject', () => {
    const l = lead({
      companyName: 'La Tavola Rossa',
      industry: 'restaurant',
      sizeEstimate: 16,
      signals: [
        { type: 'industry', value: 'restaurant', confidence: 99 },
      ],
    });
    const result = classify(l);
    expect(result.primary).not.toBe('REJECT');
    // Without a web problem, restaurant lands in nurture.
    expect(result.primary).toBe('LOW_PRIORITY_NURTURE');
  });

  it('upgrades a restaurant with a broken website to WEB_REBUILD', () => {
    const l = lead({
      companyName: 'La Tavola Rossa',
      industry: 'restaurant',
      sizeEstimate: 16,
      signals: [
        { type: 'industry', value: 'restaurant', confidence: 99 },
        { type: 'verified.website_failed', value: 'fetch failed', confidence: 95 },
      ],
    });
    const result = classify(l);
    expect(result.primary).toBe('WEB_REBUILD');
  });

  it('every classification carries a primary reason and suggested investigation step', () => {
    const l = lead();
    const result = classify(l);
    expect(result.primaryReason.length).toBeGreaterThan(0);
    expect(result.suggestedInvestigation.length).toBeGreaterThan(0);
  });

  it('exposes a per-campaign score map summing the influences', () => {
    const l = lead({
      industry: 'accounting',
      signals: [
        { type: 'verified.website_loads', value: 'ok', confidence: 100 },
        { type: 'workflow', value: 'manual data entry', confidence: 90 },
      ],
    });
    const result = classify(l);
    expect(result.scores.AI_AUTOMATION).toBeGreaterThan(0);
    expect(result.scores.LOW_PRIORITY_NURTURE).toBeGreaterThan(0);
    expect(result.scores.REJECT).toBe(0);
  });
});

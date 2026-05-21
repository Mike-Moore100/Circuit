import { describe, it, expect } from 'vitest';
import { evaluateRules } from '../src/filters/ruleBasedFilter';
import { scoreLead } from '../src/scoring/intentScoring';
import type { RawLead, Signal } from '../src/types';

const baseLead: RawLead = {
  companyName: 'Acme Bookkeeping',
  websiteUrl: 'https://acme.example',
  industry: 'accounting',
  location: 'London',
  sizeEstimate: 10,
  source: 'google_maps',
  sourceUrl: 'https://maps.example/acme',
  contactName: 'Sam Owner',
  contactRole: 'Owner',
  contactEmail: 'sam@acme.example',
  linkedinUrl: null,
  notes: null,
  signals: [],
};

const verifiedHighFit: Signal[] = [
  { type: 'verified.website_loads', value: 'ok', confidence: 100 },
  { type: 'verified.has_contact_page', value: '/contact', confidence: 90 },
  { type: 'verified.has_contact_form', value: '/contact', confidence: 90 },
  { type: 'verified.has_booking_link', value: 'https://calendly.com/acme', confidence: 80 },
  { type: 'verified.has_services_page', value: '/services', confidence: 85 },
  { type: 'verified.has_multiple_service_pages', value: '3', confidence: 80 },
  { type: 'verified.has_manual_workflow_language', value: 'invoicing', confidence: 75 },
  { type: 'verified.high_automation_fit', value: 'phrases', confidence: 75 },
  { type: 'verified.likely_service_business', value: 'service signals', confidence: 80 },
];

describe('scoring with verified signals', () => {
  it('verified high-fit signals lift a borderline lead into A priority', () => {
    const before = scoreLead(baseLead);
    const after = scoreLead({ ...baseLead, signals: verifiedHighFit });
    expect(after.finalScore).toBeGreaterThan(before.finalScore);
    expect(after.priority === 'A' || after.priority === 'B').toBe(true);
  });

  it('verified.website_failed pulls a lead toward Reject', () => {
    const failed = scoreLead({
      ...baseLead,
      signals: [
        { type: 'verified.website_failed', value: 'ECONNREFUSED', confidence: 95 },
      ],
    });
    const baseline = scoreLead(baseLead);
    expect(failed.finalScore).toBeLessThan(baseline.finalScore);
  });

  it('verified.has_ai_automation_language causes a hard penalty (competitor)', () => {
    const competitor = scoreLead({
      ...baseLead,
      signals: [
        ...verifiedHighFit,
        {
          type: 'verified.has_ai_automation_language',
          value: 'we build ai',
          confidence: 90,
        },
      ],
    });
    const noisyButLegit = scoreLead({ ...baseLead, signals: verifiedHighFit });
    expect(competitor.finalScore).toBeLessThan(noisyButLegit.finalScore);
  });

  it('credits low digital maturity as a penalty', () => {
    const thin = scoreLead({
      ...baseLead,
      signals: [
        { type: 'verified.website_loads', value: 'ok', confidence: 100 },
        { type: 'verified.low_digital_maturity', value: '300b/2 links', confidence: 70 },
      ],
    });
    const richer = scoreLead({ ...baseLead, signals: verifiedHighFit });
    expect(thin.finalScore).toBeLessThan(richer.finalScore);
  });

  it('each verified signal contributes an explicit reason', () => {
    const result = evaluateRules({ ...baseLead, signals: verifiedHighFit });
    const codes = result.reasons.map((r) => r.code);
    expect(codes).toContain('verified_website_loads');
    expect(codes).toContain('verified_contact_form');
    expect(codes).toContain('verified_booking');
    expect(codes).toContain('verified_services_page');
    expect(codes).toContain('verified_manual_workflow');
    expect(codes).toContain('verified_automation_fit');
  });
});

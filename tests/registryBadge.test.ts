// Phase 1 — registry badge mapping tests. Pure-function coverage for
// the outcome → pill mapping so the card / filter logic can't drift.

import { describe, it, expect } from 'vitest';
import { registryBadgeFor } from '../app/_components/RegistryBadge';

describe('registryBadgeFor', () => {
  it('shows "Not checked" when no enrichment row exists', () => {
    const b = registryBadgeFor(null);
    expect(b.label).toBe('Not checked');
    expect(b.tone).toBe('idle');
    expect(b.filterKey).toBe('not_checked');
  });

  it('shows "Active · Ny" for an active enriched lead with age', () => {
    const b = registryBadgeFor({
      outcome: 'enriched',
      status: 'active',
      ageYears: 12.4,
      confidence: 'high',
    });
    expect(b.label).toBe('Active · 12.4y');
    expect(b.tone).toBe('ok');
    expect(b.filterKey).toBe('enriched');
  });

  it('shows "Active" without age suffix when age missing', () => {
    const b = registryBadgeFor({
      outcome: 'enriched',
      status: 'active',
      ageYears: null,
      confidence: 'medium',
    });
    expect(b.label).toBe('Active');
  });

  it('shows "Dissolved" with err tone for dissolved companies', () => {
    const b = registryBadgeFor({
      outcome: 'enriched',
      status: 'dissolved',
      ageYears: 20,
      confidence: 'low',
    });
    expect(b.label).toBe('Dissolved');
    expect(b.tone).toBe('err');
  });

  it('shows "Liquidation" with warn tone', () => {
    const b = registryBadgeFor({
      outcome: 'enriched',
      status: 'liquidation',
      ageYears: 8,
      confidence: 'low',
    });
    expect(b.label).toBe('Liquidation');
    expect(b.tone).toBe('warn');
  });

  it('shows "No match" for skipped_no_match', () => {
    const b = registryBadgeFor({
      outcome: 'skipped_no_match',
      status: null,
      ageYears: null,
      confidence: null,
    });
    expect(b.label).toBe('No match');
    expect(b.tone).toBe('warn');
    expect(b.filterKey).toBe('no_match');
  });

  it('shows "Non-UK" muted for skipped_non_uk', () => {
    const b = registryBadgeFor({
      outcome: 'skipped_non_uk',
      status: null,
      ageYears: null,
      confidence: null,
    });
    expect(b.label).toBe('Non-UK');
    expect(b.tone).toBe('muted');
    expect(b.filterKey).toBe('non_uk');
  });

  it('shows "Not configured" for missing key / disabled', () => {
    for (const outcome of ['skipped_no_key', 'skipped_disabled']) {
      const b = registryBadgeFor({
        outcome,
        status: null,
        ageYears: null,
        confidence: null,
      });
      expect(b.label).toBe('Not configured');
      expect(b.filterKey).toBe('not_configured');
    }
  });

  it('shows "Error" with err tone for any error outcome', () => {
    const b = registryBadgeFor({
      outcome: 'error',
      status: null,
      ageYears: null,
      confidence: null,
    });
    expect(b.label).toBe('Error');
    expect(b.tone).toBe('err');
    expect(b.filterKey).toBe('error');
  });

  it('treats skipped_cache_hit_fresh the same as enriched', () => {
    const b = registryBadgeFor({
      outcome: 'skipped_cache_hit_fresh',
      status: 'active',
      ageYears: 5,
      confidence: 'high',
    });
    expect(b.filterKey).toBe('enriched');
    expect(b.tone).toBe('ok');
  });
});

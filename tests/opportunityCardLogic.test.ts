// Phase 1 Command Center — pure-function coverage for the OpportunityCard
// + OpportunityList components. Testing the logic surface directly avoids
// pulling in jsdom + a React renderer for what are really data
// transformations. The components import the same functions, so what we
// pin down here is what ships.

import { describe, it, expect } from 'vitest';
import {
  contactabilityLabel,
  HOTKEY_ACTIONS,
  isCardExpanded,
  mapHotkey,
  moveCursor,
  selectCardFields,
  type CardInputs,
} from '../app/_components/opportunityCardLogic';
import type { IntelligenceRowSummary } from '../app/_lib/dashboardData';
import type { ReviewQueueRow } from '../src/types';

function makeRow(overrides: Partial<ReviewQueueRow> = {}): ReviewQueueRow {
  return {
    companyId: 'c1',
    company: 'Acme Marketing Ltd',
    website: 'https://acme.test',
    industry: 'marketing agency',
    location: 'London',
    sizeEstimate: 12,
    source: 'real_source',
    ruleScore: 70,
    intentScore: 60,
    finalScore: 65,
    priority: 'A',
    status: 'queued',
    reasons: [],
    rejectionReasons: [],
    likelyPainPoints: [],
    suggestedNextStep: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
    primaryCampaign: 'AI_AUTOMATION',
    campaignScores: {
      AI_AUTOMATION: 70,
      WEB_REBUILD: 0,
      FUNNEL_OPTIMIZATION: 0,
      LOCAL_DIGITAL_UPGRADE: 0,
      LOW_PRIORITY_NURTURE: 0,
      REJECT: 0,
    },
    primaryReason: 'workflows match playbook',
    ...overrides,
  };
}

function makeIntel(
  overrides: Partial<IntelligenceRowSummary> = {},
): IntelligenceRowSummary {
  return {
    opportunityScore: 72,
    humanAttentionPriority: 'HIGH',
    likelyProjectType: 'AI_AUTOMATION',
    estimatedCommercialPotential: 'MEDIUM',
    whyNow: [
      { kind: 'weak_conversion', label: 'Weak conversion', detail: '…', weight: 5 },
      { kind: 'hiring', label: 'Hiring', detail: '…', weight: 4 },
    ],
    operationalPain: 60,
    trustBarrier: 30,
    buyingReadiness: 65,
    accessibility: 55,
    topOpportunityReason: 'Manual workflow language detected',
    topRiskFactor: 'Trust friction visible',
    strongestEvidence: 'Multiple service pages + contact form',
    strongestPainSignal: 'Manual onboarding language',
    likelyBuyer: 'Founder · Jane Smith',
    ...overrides,
  };
}

function makeInputs(overrides: Partial<CardInputs> = {}): CardInputs {
  return {
    row: makeRow(),
    intel: makeIntel(),
    operatorTags: new Set<string>(),
    hasContact: true,
    hasPhone: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Card field rendering
// ---------------------------------------------------------------------------
describe('selectCardFields — card rendering', () => {
  it('exposes every field the brief requires for a 5–10s scan', () => {
    const f = selectCardFields(makeInputs());
    // The brief enumerates these. Pin each one down so the card can't
    // drift away from the spec without a failing test.
    expect(f.company).toBe('Acme Marketing Ltd');
    expect(f.campaignLabel).toBeTruthy(); // campaign
    expect(f.opportunityScore).toBe(72);
    expect(f.attentionPriority).toBe('HIGH');
    expect(f.strongestPain).toBe('Manual onboarding language');
    expect(f.strongestEvidence).toBe('Multiple service pages + contact form');
    expect(f.likelyBuyer).toBe('Founder · Jane Smith');
    expect(f.contactability).toBe('email + phone');
    expect(f.trustBarrier).toBe(30);
    expect(f.projectType).toBe('ai automation');
    expect(f.whyNowChips).toHaveLength(2);
    expect(f.strongestReason).toBe('Manual workflow language detected');
    expect(f.topRisk).toBe('Trust friction visible');
  });

  it('falls back to safe defaults when intelligence is missing', () => {
    const f = selectCardFields(makeInputs({ intel: undefined }));
    expect(f.attentionPriority).toBe('IGNORE');
    expect(f.opportunityScore).toBeNull();
    expect(f.projectType).toBeNull();
    expect(f.whyNowChips).toEqual([]);
    expect(f.strongestPain).toBeNull();
    expect(f.strongestEvidence).toBeNull();
    expect(f.likelyBuyer).toBeNull();
    expect(f.operationalPain).toBeNull();
  });

  it('only keeps known operator tags (drops calibration reviews silently)', () => {
    const f = selectCardFields(
      makeInputs({
        operatorTags: new Set([
          'ignore',
          'likely_high_value',
          'strong_opportunity', // calibration — not surfaced as an operator tag
        ]),
      }),
    );
    expect(f.appliedTags).toContain('ignore');
    expect(f.appliedTags).toContain('likely_high_value');
    expect(f.appliedTags).not.toContain('strong_opportunity');
  });

  it('parses the website host for the sub-line', () => {
    const f = selectCardFields(
      makeInputs({ row: makeRow({ website: 'https://www.acme.test/about' }) }),
    );
    expect(f.host).toBe('acme.test');
  });

  it('handles broken website strings without throwing', () => {
    const f = selectCardFields(
      makeInputs({ row: makeRow({ website: 'not-a-url' }) }),
    );
    expect(f.host).toBe('not-a-url');
  });
});

describe('contactabilityLabel', () => {
  it.each([
    [true, true, 'email + phone'],
    [true, false, 'email'],
    [false, true, 'phone only'],
    [false, false, 'no direct path'],
  ])('hasContact=%s hasPhone=%s → %s', (hasContact, hasPhone, expected) => {
    expect(contactabilityLabel(hasContact, hasPhone)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Keyboard workflow
// ---------------------------------------------------------------------------
describe('mapHotkey — keyboard workflow', () => {
  it('maps j and ArrowDown to move down', () => {
    expect(mapHotkey('j', 'j', false)).toEqual({ kind: 'move', delta: 1 });
    expect(mapHotkey('ArrowDown', 'ArrowDown', false)).toEqual({ kind: 'move', delta: 1 });
  });

  it('maps k and ArrowUp to move up', () => {
    expect(mapHotkey('k', 'k', false)).toEqual({ kind: 'move', delta: -1 });
    expect(mapHotkey('ArrowUp', 'ArrowUp', false)).toEqual({ kind: 'move', delta: -1 });
  });

  it('maps g / G to first / last', () => {
    expect(mapHotkey('g', 'g', false)).toEqual({ kind: 'jump', to: 'first' });
    expect(mapHotkey('g', 'g', true)).toEqual({ kind: 'jump', to: 'last' });
    expect(mapHotkey('G', 'G', true)).toEqual({ kind: 'jump', to: 'last' });
  });

  it('maps o and Enter to open the drawer', () => {
    expect(mapHotkey('o', 'o', false)).toEqual({ kind: 'open' });
    expect(mapHotkey('Enter', 'Enter', false)).toEqual({ kind: 'open' });
  });

  it('maps Escape to close', () => {
    expect(mapHotkey('Escape', 'Escape', false)).toEqual({ kind: 'close' });
  });

  it('maps e to expand and ? to help', () => {
    expect(mapHotkey('e', 'e', false)).toEqual({ kind: 'expand' });
    expect(mapHotkey('?', '?', false)).toEqual({ kind: 'help' });
  });

  it('maps every operator quick-action key to its tag', () => {
    const cases: Array<[string, string]> = [
      ['s', 'strong_opportunity'],
      ['i', 'ignore'],
      ['r', 'revisit_later'],
      ['v', 'likely_high_value'],
      ['f', 'likely_fast_close'],
      ['w', 'wrong_campaign'],
      ['t', 'high_trust_barrier'],
      ['m', 'needs_manual_investigation'],
    ];
    for (const [key, action] of cases) {
      expect(mapHotkey(key, key, false)).toEqual({ kind: 'action', action });
    }
  });

  it('returns null for unrecognised keys', () => {
    expect(mapHotkey('x', 'x', false)).toBeNull();
    expect(mapHotkey('1', '1', false)).toBeNull();
  });
});

describe('moveCursor — clamping', () => {
  it('does not move past the last item', () => {
    expect(moveCursor(4, { kind: 'move', delta: 1 }, 5)).toBe(4);
  });

  it('does not move before the first item', () => {
    expect(moveCursor(0, { kind: 'move', delta: -1 }, 5)).toBe(0);
  });

  it('jumps to first / last bounds', () => {
    expect(moveCursor(3, { kind: 'jump', to: 'first' }, 5)).toBe(0);
    expect(moveCursor(0, { kind: 'jump', to: 'last' }, 5)).toBe(4);
  });

  it('returns the current cursor for non-navigation intents', () => {
    expect(moveCursor(2, { kind: 'open' }, 5)).toBe(2);
    expect(moveCursor(2, null, 5)).toBe(2);
  });

  it('safely handles an empty list', () => {
    expect(moveCursor(0, { kind: 'move', delta: 1 }, 0)).toBe(0);
  });
});

// Sanity: ensure the static HOTKEY_ACTIONS map and the dynamic mapHotkey
// stay in sync — every key in the static map must dispatch to the same
// action through mapHotkey.
describe('HOTKEY_ACTIONS / mapHotkey consistency', () => {
  it('every static hotkey resolves through mapHotkey', () => {
    for (const [key, action] of Object.entries(HOTKEY_ACTIONS)) {
      expect(mapHotkey(key, key, false)).toEqual({ kind: 'action', action });
    }
  });
});

// ---------------------------------------------------------------------------
// Progressive disclosure — compact vs expanded state
// ---------------------------------------------------------------------------
describe('isCardExpanded — progressive disclosure', () => {
  it('is compact by default (showSecondary=false)', () => {
    expect(isCardExpanded({ showSecondary: false })).toBe(false);
  });

  it('flips to expanded when showSecondary toggles on', () => {
    expect(isCardExpanded({ showSecondary: true })).toBe(true);
  });
});

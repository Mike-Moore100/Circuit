// Pure-function core for the OpportunityCard + OpportunityList components.
// Lives outside the .tsx so it can be unit-tested without spinning up a
// DOM. Anything in here is deterministic and side-effect-free.

import type { ReviewQueueRow } from '../../src/types';
import type { IntelligenceRowSummary } from '../_lib/dashboardData';
import { CAMPAIGN_LABEL, type Campaign } from '../../src/scoring/campaignTypes';
import {
  OPERATOR_REVIEW_TYPES,
  type OperatorReviewType,
} from '../../src/validation/types';

// ---------------------------------------------------------------------------
// Hotkey → operator action mapping. Held here so the keyboard test can
// pin down what each key does without rendering anything.
// ---------------------------------------------------------------------------
export const HOTKEY_ACTIONS: Record<string, OperatorReviewType | 'strong_opportunity'> = {
  s: 'strong_opportunity', // calibration tag, not operator — exception by design
  i: 'ignore',
  r: 'revisit_later',
  v: 'likely_high_value',
  f: 'likely_fast_close',
  w: 'wrong_campaign',
  t: 'high_trust_barrier',
  m: 'needs_manual_investigation',
};

// Navigation key intents — what does this key do to the cursor?
export type NavIntent =
  | { kind: 'move'; delta: number }
  | { kind: 'jump'; to: 'first' | 'last' }
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'expand' }
  | { kind: 'help' }
  | { kind: 'action'; action: OperatorReviewType | 'strong_opportunity' }
  | null;

// Pure key → intent. The component just translates intents into DOM
// dispatches (click the right button), so this function is the test
// surface for the keyboard workflow.
export function mapHotkey(
  key: string,
  rawKey: string,
  isShift: boolean,
): NavIntent {
  const k = key.toLowerCase();
  if (k === 'j' || rawKey === 'ArrowDown') return { kind: 'move', delta: 1 };
  if (k === 'k' || rawKey === 'ArrowUp') return { kind: 'move', delta: -1 };
  if (k === 'g' && !isShift) return { kind: 'jump', to: 'first' };
  if (rawKey === 'G' || (k === 'g' && isShift)) return { kind: 'jump', to: 'last' };
  if (k === 'o' || rawKey === 'Enter') return { kind: 'open' };
  if (rawKey === 'Escape') return { kind: 'close' };
  if (k === 'e') return { kind: 'expand' };
  if (k === '?') return { kind: 'help' };
  const action = HOTKEY_ACTIONS[k];
  if (action) return { kind: 'action', action };
  return null;
}

// Clamp the cursor inside the list bounds — used on every navigation.
export function moveCursor(
  current: number,
  intent: NavIntent,
  listLength: number,
): number {
  if (!intent || listLength === 0) return current;
  const max = listLength - 1;
  if (intent.kind === 'move') {
    return Math.min(max, Math.max(0, current + intent.delta));
  }
  if (intent.kind === 'jump') {
    return intent.to === 'first' ? 0 : max;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Card-field derivation — what does each card slot display, given the
// data we have? Returning a flat shape makes the rendering test trivial
// and forces us to think about every field in one place.
// ---------------------------------------------------------------------------
export interface CardFields {
  company: string;
  host: string | null;
  campaignLabel: string;
  attentionPriority: string;
  opportunityScore: number | null;
  projectType: string | null;
  finalScore: number;
  contactability: string;
  strongestReason: string | null;
  strongestPain: string | null;
  strongestEvidence: string | null;
  likelyBuyer: string | null;
  topRisk: string | null;
  operationalPain: number | null;
  buyingReadiness: number | null;
  accessibility: number | null;
  trustBarrier: number | null;
  whyNowChips: Array<{ kind: string; label: string; detail: string }>;
  appliedTags: OperatorReviewType[];
}

export interface CardInputs {
  row: ReviewQueueRow;
  intel: IntelligenceRowSummary | undefined;
  operatorTags: Set<string>;
  hasContact: boolean;
  hasPhone: boolean;
}

function domain(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function contactabilityLabel(hasContact: boolean, hasPhone: boolean): string {
  if (hasContact && hasPhone) return 'email + phone';
  if (hasContact) return 'email';
  if (hasPhone) return 'phone only';
  return 'no direct path';
}

export function selectCardFields(inputs: CardInputs): CardFields {
  const { row, intel, operatorTags, hasContact, hasPhone } = inputs;
  const campaign = row.primaryCampaign as Campaign;
  return {
    company: row.company,
    host: domain(row.website),
    campaignLabel: CAMPAIGN_LABEL[campaign],
    attentionPriority: intel?.humanAttentionPriority ?? 'IGNORE',
    opportunityScore: intel?.opportunityScore ?? null,
    projectType: intel
      ? intel.likelyProjectType.replace(/_/g, ' ').toLowerCase()
      : null,
    finalScore: row.finalScore,
    contactability: contactabilityLabel(hasContact, hasPhone),
    strongestReason: intel?.topOpportunityReason ?? null,
    strongestPain: intel?.strongestPainSignal ?? null,
    strongestEvidence: intel?.strongestEvidence ?? null,
    likelyBuyer: intel?.likelyBuyer ?? null,
    topRisk: intel?.topRiskFactor ?? null,
    operationalPain: intel?.operationalPain ?? null,
    buyingReadiness: intel?.buyingReadiness ?? null,
    accessibility: intel?.accessibility ?? null,
    trustBarrier: intel?.trustBarrier ?? null,
    whyNowChips: intel?.whyNow ?? [],
    appliedTags: [...operatorTags].filter((t): t is OperatorReviewType =>
      (OPERATOR_REVIEW_TYPES as readonly string[]).includes(t),
    ),
  };
}

// "Is the card showing its detail / expanded shape?" — the test for
// progressive disclosure pins down that the secondary action row is
// only visible when `expanded` is true.
export function isCardExpanded(state: { showSecondary: boolean }): boolean {
  return state.showSecondary === true;
}

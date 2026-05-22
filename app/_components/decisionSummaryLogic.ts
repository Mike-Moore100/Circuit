// Pure derivation for the Layer 1 "Decision Summary" — answers
// "should I care about this lead?" without any DOM. The component
// shells (DecisionSummary + cards + drawer) read from this.

import type { ReviewQueueRow } from '../../src/types';
import type {
  IntelligenceRowSummary,
  LeadContactBundle,
  LeadEvidenceSummary,
  RegistryEnrichmentPanel,
} from '../_lib/dashboardData';

// ---------------------------------------------------------------------------
// Best contact route — single line summarising the easiest reach path.
// "Email: jane@…" beats "email + phone" because the operator wants
// the destination, not the channel taxonomy.
// ---------------------------------------------------------------------------
export interface BestContactSummary {
  // Short line for the decision summary ("Jane Smith · founder · jane@…").
  line: string;
  // Tone for the chip — green when we have a named decision-maker with
  // a personal email, amber when we only have generic info@, grey
  // when there's no path at all.
  tone: 'ok' | 'warn' | 'muted';
}

export function pickBestContact(
  contacts: LeadContactBundle,
  likelyBuyer: string | null,
  hasPhone: boolean,
): BestContactSummary {
  const namedDmWithEmail = contacts.contacts.find(
    (c) =>
      c.name &&
      c.email &&
      c.emailStatus !== 'guessed' &&
      /founder|director|partner|owner|managing|head\s+of|ceo|cto|cmo/i.test(c.role ?? ''),
  );
  if (namedDmWithEmail) {
    const role = namedDmWithEmail.role ? ` · ${namedDmWithEmail.role}` : '';
    return {
      line: `${namedDmWithEmail.name}${role} · ${namedDmWithEmail.email}`,
      tone: 'ok',
    };
  }
  const anyNamedEmail = contacts.contacts.find((c) => c.name && c.email);
  if (anyNamedEmail) {
    return {
      line: `${anyNamedEmail.name} · ${anyNamedEmail.email}`,
      tone: 'ok',
    };
  }
  const genericEmail = contacts.contacts.find((c) => c.email);
  if (genericEmail) {
    const buyer = likelyBuyer ? `${likelyBuyer} via ` : '';
    return {
      line: `${buyer}${genericEmail.email}${hasPhone ? ' + phone' : ''}`,
      tone: 'warn',
    };
  }
  if (hasPhone) {
    return { line: 'Phone only — no email captured', tone: 'warn' };
  }
  return { line: 'No direct contact path', tone: 'muted' };
}

// ---------------------------------------------------------------------------
// Recommended next action — one sentence, operator-facing. Drives the
// Layer 1 primary CTA so the operator doesn't have to interpret the
// score breakdown to know what to do next.
// ---------------------------------------------------------------------------
export interface RecommendedAction {
  // The CTA label.
  label: string;
  // One-sentence reasoning shown beneath.
  reasoning: string;
  // 'pursue' = positive; 'investigate' = needs more research;
  // 'skip' = step away. Drives chip tone.
  tone: 'pursue' | 'investigate' | 'skip';
}

export function recommendNextAction(
  lead: ReviewQueueRow,
  intel: IntelligenceRowSummary | undefined,
  contact: BestContactSummary,
  registry: RegistryEnrichmentPanel | null,
): RecommendedAction {
  // Hard skip — primary campaign is reject.
  if (lead.primaryCampaign === 'REJECT') {
    return {
      label: 'Skip',
      reasoning: lead.primaryReason || 'Fails rule or intent threshold.',
      tone: 'skip',
    };
  }
  // Registry-driven skip — dissolved/liquidation companies aren't worth pursuing.
  const regStatus = registry?.record?.status;
  if (regStatus === 'dissolved' || regStatus === 'liquidation' || regStatus === 'administration') {
    return {
      label: 'Skip — not trading',
      reasoning: `Companies House shows ${regStatus}.`,
      tone: 'skip',
    };
  }
  // Ignore-tier intelligence — opportunity score too low.
  const opp = intel?.opportunityScore ?? 0;
  if (intel?.humanAttentionPriority === 'IGNORE') {
    return {
      label: 'Park as nurture',
      reasoning: `Opportunity score ${opp}/100 — no near-term action.`,
      tone: 'skip',
    };
  }
  if (intel?.humanAttentionPriority === 'IMMEDIATE') {
    return {
      label: 'Contact today',
      reasoning: contact.tone === 'ok'
        ? `Strong fit + reachable decision-maker.`
        : `Strong fit — but tighten contact route first (${contact.line}).`,
      tone: 'pursue',
    };
  }
  if (intel?.humanAttentionPriority === 'HIGH') {
    return {
      label: 'Contact this week',
      reasoning: contact.tone === 'ok'
        ? 'High attention with a usable contact path.'
        : 'High attention — needs deeper contact research first.',
      tone: 'pursue',
    };
  }
  if (intel?.humanAttentionPriority === 'MEDIUM') {
    return {
      label: 'Investigate further',
      reasoning: 'Medium attention — confirm pain or buyer before committing time.',
      tone: 'investigate',
    };
  }
  return {
    label: 'Investigate further',
    reasoning: 'Not enough intelligence to recommend a stronger move yet.',
    tone: 'investigate',
  };
}

// ---------------------------------------------------------------------------
// Top risk — single line. Prefers risk factors from intelligence,
// then commercial weaknesses, then trust barrier as a last fallback.
// ---------------------------------------------------------------------------
export function pickTopRisk(intel: IntelligenceRowSummary | undefined): string | null {
  if (!intel) return null;
  if (intel.topRiskFactor) return intel.topRiskFactor;
  if (intel.commercialWeaknesses.length > 0) {
    return intel.commercialWeaknesses[0].detail;
  }
  if (intel.trustBarrier >= 50) return 'High trust barrier visible';
  return null;
}

// ---------------------------------------------------------------------------
// Strongest reason — single line for Layer 1. Top opportunity reason
// is the canonical source; if missing, fall back to the strongest
// why-now signal.
// ---------------------------------------------------------------------------
export function pickStrongestReason(
  intel: IntelligenceRowSummary | undefined,
): string | null {
  if (!intel) return null;
  if (intel.topOpportunityReason) return intel.topOpportunityReason;
  if (intel.whyNow.length > 0) return intel.whyNow[0].detail;
  return null;
}

// ---------------------------------------------------------------------------
// Strongest evidence — different from "reason". Reason is *why* this
// is a lead; evidence is *what we observed*. They can be the same line
// when we only have one signal, but typically they're separate.
// ---------------------------------------------------------------------------
export function pickStrongestEvidence(
  intel: IntelligenceRowSummary | undefined,
  evidence: LeadEvidenceSummary | null,
): string | null {
  if (intel?.strongestEvidence) return intel.strongestEvidence;
  if (evidence) {
    if (evidence.operationalClues.length > 0) {
      return evidence.operationalClues[0].label;
    }
    if (evidence.visualIssues.length > 0) {
      return evidence.visualIssues[0].label;
    }
  }
  return null;
}

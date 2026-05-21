// Evidence confidence — how much do we actually KNOW about this lead?
// A high opportunity score with low evidence confidence is suspicious —
// the orchestrator pulls the composite score toward the middle when this
// is low so the operator sees we're guessing.

import { clamp100, type IntelligenceInputs, type SubScore } from './intelligenceTypes';

export function scoreEvidenceConfidence(inputs: IntelligenceInputs): SubScore {
  const reasons: SubScore['reasons'] = [];
  const signals: string[] = [];
  let score = 0;

  // Inspection actually ran and the site responded
  if (inputs.inspectionOk) {
    score += 25;
    reasons.push({
      code: 'inspection_ok',
      label: 'Static website inspection succeeded',
      delta: 25,
    });
    signals.push('Inspection ok');
  } else if (inputs.inspectionAttempted) {
    score += 5;
    reasons.push({
      code: 'inspection_attempted',
      label: 'Inspection attempted but the site did not load',
      delta: 5,
    });
  } else {
    reasons.push({
      code: 'no_inspection',
      label: 'No website inspection has run',
      delta: 0,
    });
  }

  // Verified signals from the inspector — concrete, machine-checked facts
  if (inputs.verifiedSignals.length >= 3) {
    score += 15;
    reasons.push({
      code: 'verified_signals',
      label: `${inputs.verifiedSignals.length} verified inspection signals`,
      delta: 15,
    });
  } else if (inputs.verifiedSignals.length > 0) {
    score += 8;
    reasons.push({
      code: 'few_verified_signals',
      label: `${inputs.verifiedSignals.length} verified signals (light coverage)`,
      delta: 8,
    });
  }

  // Screenshots — visual proof, the strongest evidence-confidence signal
  if (inputs.hasDesktopScreenshot && inputs.hasMobileScreenshot) {
    score += 25;
    reasons.push({
      code: 'both_screenshots',
      label: 'Desktop + mobile screenshots captured',
      delta: 25,
    });
    signals.push('Desktop + mobile screenshots');
  } else if (inputs.hasDesktopScreenshot) {
    score += 12;
    reasons.push({
      code: 'desktop_screenshot',
      label: 'Desktop screenshot captured',
      delta: 12,
    });
  }

  // Issues + clues detected — proof that the system actually looked at the
  // page deeply enough to recognise things, not just say "200 OK".
  if (inputs.visualIssues.length + inputs.operationalClues.length >= 3) {
    score += 15;
    reasons.push({
      code: 'rich_evidence',
      label: `${inputs.visualIssues.length} visual issues + ${inputs.operationalClues.length} operational clues`,
      delta: 15,
    });
  } else if (inputs.visualIssues.length + inputs.operationalClues.length > 0) {
    score += 6;
    reasons.push({
      code: 'some_evidence',
      label: `${inputs.visualIssues.length} visual issues + ${inputs.operationalClues.length} operational clues`,
      delta: 6,
    });
  }

  // Real contacts vs nothing — having any non-source-feed contact means
  // we touched the site and pulled something out.
  const realContacts = inputs.contacts.filter(
    (c) => c.source && c.source !== 'inferred',
  );
  if (realContacts.length >= 2) {
    score += 10;
    reasons.push({
      code: 'multiple_contacts',
      label: `${realContacts.length} contacts discovered`,
      delta: 10,
    });
  } else if (realContacts.length === 1) {
    score += 5;
    reasons.push({
      code: 'single_contact',
      label: '1 contact discovered',
      delta: 5,
    });
  }

  // Penalise inference-heavy intelligence
  const inferredContacts = inputs.contacts.filter((c) => c.source === 'inferred');
  if (
    realContacts.length === 0 &&
    inferredContacts.length > 0
  ) {
    score -= 10;
    reasons.push({
      code: 'inferred_only',
      label: 'Only inferred contacts (e.g. hello@domain) — no real signals',
      delta: -10,
    });
  }

  reasons.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return {
    score: clamp100(score),
    reasons: reasons.slice(0, 8),
    signals,
  };
}

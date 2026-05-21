// Accessibility — how reachable is the right human? A perfect lead with
// no contact path scores low here; a small business with a clearly-named
// founder and a working email scores high.

import { clamp100, type IntelligenceInputs, type SubScore } from './intelligenceTypes';

const SENIOR_ROLES = new Set([
  'founder',
  'co_founder',
  'owner',
  'ceo',
  'managing_director',
  'principal',
  'partner',
]);

export function scoreAccessibility(inputs: IntelligenceInputs): SubScore {
  const reasons: SubScore['reasons'] = [];
  const signals: string[] = [];
  let score = 0;

  // The single strongest signal: a named decision-maker with a real email
  const namedDmExtracted = inputs.contacts.find(
    (c) =>
      c.name &&
      SENIOR_ROLES.has(c.detectedRole) &&
      c.email &&
      c.emailStatus === 'extracted',
  );
  const namedDmGuessed = inputs.contacts.find(
    (c) => c.name && SENIOR_ROLES.has(c.detectedRole) && c.email,
  );
  const namedDmNoEmail = inputs.contacts.find(
    (c) => c.name && SENIOR_ROLES.has(c.detectedRole),
  );
  const anyExtractedEmail = inputs.contacts.find(
    (c) => c.email && c.emailStatus === 'extracted',
  );

  if (namedDmExtracted) {
    score += 45;
    reasons.push({
      code: 'named_dm_extracted',
      label: `Direct email for ${namedDmExtracted.name} (${namedDmExtracted.role})`,
      delta: 45,
    });
    signals.push(`Direct email to ${namedDmExtracted.name}`);
  } else if (namedDmGuessed) {
    score += 22;
    reasons.push({
      code: 'named_dm_guessed_email',
      label: `Named decision-maker (${namedDmGuessed.name}); email is pattern-guessed`,
      delta: 22,
    });
    signals.push(`Named DM ${namedDmGuessed.name}`);
  } else if (namedDmNoEmail) {
    score += 14;
    reasons.push({
      code: 'named_dm_no_email',
      label: `Named decision-maker (${namedDmNoEmail.name}) — no email yet`,
      delta: 14,
    });
  } else if (anyExtractedEmail) {
    score += 18;
    reasons.push({
      code: 'general_email_extracted',
      label: `Extracted a general contact email (${anyExtractedEmail.email})`,
      delta: 18,
    });
  }

  // Phone — gives an alternative path even if email is poor
  if (inputs.hasPhone) {
    score += 14;
    reasons.push({
      code: 'has_phone',
      label: 'Phone number on the site',
      delta: 14,
    });
    signals.push('Phone listed');
  }

  // Contact form is a real reach path even without an email
  if (inputs.hasContactForm) {
    score += 10;
    reasons.push({
      code: 'has_form',
      label: 'Contact form is reachable on the site',
      delta: 10,
    });
  }

  // Booking link — operator can literally book a discovery call without
  // a sales motion. Massive accessibility bump.
  if (inputs.hasBookingLink) {
    score += 16;
    reasons.push({
      code: 'has_booking',
      label: 'Direct booking link available',
      delta: 16,
    });
    signals.push('Direct booking link');
  }

  // Smaller SMBs are typically less bureaucratic — easier to reach the
  // person who actually decides.
  const size = inputs.sizeEstimate ?? 0;
  if (size > 0 && size <= 25) {
    score += 8;
    reasons.push({
      code: 'low_bureaucracy',
      label: `Headcount ${size} — low procurement bureaucracy`,
      delta: 8,
    });
  } else if (size > 100) {
    score -= 10;
    reasons.push({
      code: 'enterprise_bureaucracy',
      label: `Headcount ${size} — procurement / RFP risk`,
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

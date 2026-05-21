import type {
  DiscoveredContact,
  DiscoveredRoute,
} from './contactTypes';
import { ROLE_PRIORITY } from './contactTypes';

// Per-contact: combine decision-maker priority + email status + email type.
// Output is 0–100. Pure function so it's easy to unit-test.
export function scoreContact(c: DiscoveredContact): number {
  let score = 0;
  // 40 points from role priority (founder/owner → 40, partner → 28, none → 0)
  score += (ROLE_PRIORITY[c.detectedRole] ?? 0) * 0.4;

  // 35 points from email availability + status
  if (c.email && c.emailStatus === 'extracted') score += 35;
  else if (c.email && c.emailStatus === 'verified') score += 40;
  else if (c.email && c.emailStatus === 'guessed') score += 10;

  // 15 points from email type quality
  if (c.emailType === 'personal') score += 15;
  else if (c.emailType === 'role_based') score += 6;
  else if (c.emailType === 'general' || c.emailType === 'info') score += 4;
  else if (c.emailType === 'sales' || c.emailType === 'support') score += 2;

  // 10 points from secondary signals
  if (c.linkedinUrl) score += 5;
  if (c.role && c.detectedRole !== 'unknown') score += 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// Per-company contactability score = max contact confidence, lightly boosted
// by alternative routes (phone / form / booking) so a company with no DM
// email but a working contact form still reads as reachable.
export function contactabilityForCompany(
  contacts: DiscoveredContact[],
  routes: DiscoveredRoute[],
): number {
  let best = 0;
  for (const c of contacts) {
    if (c.overallConfidence > best) best = c.overallConfidence;
  }
  const hasPhone = routes.some((r) => r.type === 'PHONE');
  const hasForm = routes.some((r) => r.type === 'CONTACT_FORM');
  const hasBooking = routes.some((r) => r.type === 'BOOKING_LINK');
  let bonus = 0;
  if (hasPhone) bonus += 4;
  if (hasForm) bonus += 4;
  if (hasBooking) bonus += 4;
  // If we have NO direct contact at all, the bonus is the only score
  if (best === 0) return Math.min(40, bonus * 2);
  return Math.min(100, best + bonus);
}

// Conservative phone extractor — picks up internationally-formatted numbers
// from page text without producing too much noise. We require 9–15 digits
// and at least one separator between groups (so we don't grab random
// long numbers like product IDs or postcodes).

const PHONE_REGEX =
  /(?:\+?\d{1,3}[\s.\-]?)?(?:\(\d{2,5}\)|\d{2,5})[\s.\-]?\d{2,4}[\s.\-]?\d{2,4}(?:[\s.\-]?\d{0,4})?/g;

export function extractPhonesFromText(text: string): string[] {
  const candidates = text.match(PHONE_REGEX) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of candidates) {
    const trimmed = raw.trim();
    const digits = trimmed.replace(/[^\d]/g, '');
    if (digits.length < 9 || digits.length > 15) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    out.push(trimmed);
  }
  return out;
}

import { describe, it, expect } from 'vitest';
import { parse } from 'node-html-parser';
import {
  classifyEmail,
  emailMatchesName,
  extractEmailsFromText,
} from '../src/contacts/emailExtractor';
import { extractPhonesFromText } from '../src/contacts/phoneExtractor';
import {
  fallbackRoleEmails,
  guessEmailsForName,
} from '../src/contacts/emailPatternGuesser';
import {
  detectDecisionMakers,
  detectDecisionMakersFromText,
} from '../src/contacts/decisionMakerDetector';

describe('extractEmailsFromText', () => {
  it('extracts visible emails and de-duplicates', () => {
    const out = extractEmailsFromText(`
      Reach out to jane.smith@acme.com or info@acme.com.
      Also jane.smith@acme.com again.
    `);
    expect(out.map((e) => e.email).sort()).toEqual(['info@acme.com', 'jane.smith@acme.com']);
  });

  it('skips obvious placeholder domains', () => {
    const out = extractEmailsFromText('contact me at you@example.com');
    expect(out).toHaveLength(0);
  });

  it('classifies common role-based locals correctly', () => {
    expect(classifyEmail('info')).toBe('info');
    expect(classifyEmail('hello')).toBe('info');
    expect(classifyEmail('support')).toBe('support');
    expect(classifyEmail('sales')).toBe('sales');
    expect(classifyEmail('team')).toBe('general');
  });

  it('classifies plausible name locals as personal', () => {
    expect(classifyEmail('jane.smith')).toBe('personal');
    expect(classifyEmail('jane')).toBe('personal');
  });

  it('classifies unknown locals as role_based', () => {
    expect(classifyEmail('a2b9c0d1')).toBe('role_based');
    expect(classifyEmail('newsletter')).toBe('role_based');
  });

  it('emailMatchesName matches common name patterns', () => {
    expect(emailMatchesName('jane', 'Jane Smith')).toBe(true);
    expect(emailMatchesName('jane.smith', 'Jane Smith')).toBe(true);
    expect(emailMatchesName('jsmith', 'Jane Smith')).toBe(true);
    expect(emailMatchesName('janesmith', 'Jane Smith')).toBe(true);
    expect(emailMatchesName('bob', 'Jane Smith')).toBe(false);
  });
});

describe('extractPhonesFromText', () => {
  it('captures UK / US style phone numbers', () => {
    const out = extractPhonesFromText(`
      Call us on +44 20 7946 0958 or (415) 555-2671.
      Office hours 9-5.
    `);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.some((p) => /44.*20.*7946.*0958/.test(p))).toBe(true);
  });

  it('rejects short digit runs (would-be postcodes / IDs)', () => {
    const out = extractPhonesFromText('Order 12345 confirmed at 14:30.');
    expect(out).toHaveLength(0);
  });
});

describe('guessEmailsForName + fallbackRoleEmails', () => {
  it('produces multiple plausible patterns', () => {
    const out = guessEmailsForName('Jane Smith', 'acme.com');
    const emails = out.map((g) => g.email);
    expect(emails).toContain('jane@acme.com');
    expect(emails).toContain('jane.smith@acme.com');
    expect(emails).toContain('jsmith@acme.com');
  });

  it('handles single-name inputs without crashing', () => {
    const out = guessEmailsForName('Madonna', 'icon.example');
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].email).toBe('madonna@icon.example');
  });

  it('strips www. and protocol from domain', () => {
    const out = guessEmailsForName('Jane Smith', 'https://www.ACME.com');
    expect(out[0].email.endsWith('@acme.com')).toBe(true);
  });

  it('fallback role emails return hello / info / contact / enquiries', () => {
    const out = fallbackRoleEmails('acme.com');
    expect(out.map((g) => g.email)).toEqual([
      'hello@acme.com',
      'info@acme.com',
      'contact@acme.com',
      'enquiries@acme.com',
    ]);
  });
});

describe('decisionMakerDetector', () => {
  it('detects Name — Role lines in text', () => {
    const text = `
      Our team

      Jane Smith — Founder & CEO
      Tom Ainsworth — Managing Director
      Mia Chen — Operations Manager
      Office staff and other notes.
    `;
    const found = detectDecisionMakersFromText(text, 'https://acme.example/team');
    const names = found.map((p) => p.name).sort();
    expect(names).toEqual(['Jane Smith', 'Mia Chen', 'Tom Ainsworth']);
    const jane = found.find((p) => p.name === 'Jane Smith');
    expect(jane?.detectedRole).toBe('founder');
  });

  it('detects DOM team cards (heading name + sibling role text)', () => {
    const html = `
      <section>
        <div class="team-card">
          <h3>Jane Smith</h3>
          <p>Founder &amp; CEO</p>
        </div>
        <div class="team-card">
          <h3>Tom Ainsworth</h3>
          <p>Managing Director</p>
        </div>
      </section>
    `;
    const root = parse(html);
    const found = detectDecisionMakers(root, root.text, 'https://acme.example/about');
    const names = found.map((p) => p.name).sort();
    expect(names).toContain('Jane Smith');
    expect(names).toContain('Tom Ainsworth');
  });

  it('does not invent decision-makers from generic text', () => {
    const text = `
      We are a marketing agency. Our services are tailored to your needs.
      Contact us via the form below.
    `;
    const found = detectDecisionMakersFromText(text, 'https://acme.example');
    expect(found).toHaveLength(0);
  });
});

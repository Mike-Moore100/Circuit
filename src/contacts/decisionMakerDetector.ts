import type { HTMLElement } from 'node-html-parser';
import type { DecisionMakerRole } from './contactTypes';

// Pattern table — high-priority roles first so they shadow weaker ones.
const ROLE_PATTERNS: Array<{
  role: DecisionMakerRole;
  rx: RegExp;
  conf: number;
}> = [
  { role: 'co_founder', rx: /\bco[-\s]?founder\b/i, conf: 95 },
  { role: 'founder', rx: /\bfounder\b/i, conf: 95 },
  { role: 'ceo', rx: /\b(?:ceo|chief executive officer)\b/i, conf: 92 },
  { role: 'managing_director', rx: /\b(?:managing director|^md$|, md\b)\b/i, conf: 90 },
  { role: 'owner', rx: /\b(?:owner|proprietor)\b/i, conf: 88 },
  { role: 'principal', rx: /\bprincipal\b/i, conf: 80 },
  { role: 'operations_manager', rx: /\boperations manager\b/i, conf: 78 },
  { role: 'practice_manager', rx: /\bpractice manager\b/i, conf: 78 },
  { role: 'director', rx: /\bdirector\b/i, conf: 72 },
  { role: 'partner', rx: /\bpartner\b/i, conf: 68 },
];

export interface DetectedPerson {
  name: string;
  role: string;
  detectedRole: DecisionMakerRole;
  roleConfidence: number;
  sourceUrl: string;
}

function matchRole(
  text: string,
): { role: DecisionMakerRole; conf: number } | null {
  for (const p of ROLE_PATTERNS) {
    if (p.rx.test(text)) return { role: p.role, conf: p.conf };
  }
  return null;
}

const NAME_RX = /^[A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+)+$/;

function looksLikeName(s: string): boolean {
  if (!s || s.length > 40 || s.length < 5) return false;
  return NAME_RX.test(s.trim());
}

export function detectDecisionMakersFromText(
  text: string,
  sourceUrl: string,
): DetectedPerson[] {
  const out: DetectedPerson[] = [];
  // Pattern A: "Name — Role" / "Name – Role" / "Name, Role" / "Name | Role"
  const lines = text.split(/\n+/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.length > 200) continue;
    // Reversed form first: "Role: Name" or "Role — Name"
    const reversed = trimmed.match(
      /^([A-Za-z ,&-]+?)\s*[:—–\-|]\s*([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+)+)\s*$/,
    );
    if (reversed) {
      const role = reversed[1].trim();
      const name = reversed[2].trim();
      if (looksLikeName(name)) {
        const r = matchRole(role);
        if (r) {
          out.push({ name, role, detectedRole: r.role, roleConfidence: r.conf, sourceUrl });
          continue;
        }
      }
    }
    const m = trimmed.match(
      /^([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+)+)\s*[—–\-|,]\s*(.+)$/,
    );
    if (!m) continue;
    const name = m[1].trim();
    const role = m[2].trim();
    if (!looksLikeName(name)) continue;
    const r = matchRole(role);
    if (!r) continue;
    out.push({ name, role, detectedRole: r.role, roleConfidence: r.conf, sourceUrl });
  }
  return out;
}

export function detectDecisionMakersFromDom(
  root: HTMLElement,
  sourceUrl: string,
): DetectedPerson[] {
  const out: DetectedPerson[] = [];
  // Look for team-card-shaped structures: h2/h3/h4/strong holding a name,
  // with a sibling element carrying the role text.
  const headings = root.querySelectorAll('h2, h3, h4, h5, strong, .name, .team-name, .person-name');
  for (const h of headings) {
    const name = (h.text ?? '').trim();
    if (!looksLikeName(name)) continue;
    // Search nearby for a role string: the heading's parent's text minus
    // the heading itself, capped at 200 chars after the name.
    const parent = h.parentNode;
    if (!parent) continue;
    const surrounding = (parent.text ?? '').replace(name, '').trim().slice(0, 200);
    const r = matchRole(surrounding);
    if (!r) continue;
    // Extract the actual role substring for display
    const roleMatch = surrounding.match(/[A-Z][A-Za-z &/-]{3,40}/);
    const roleLabel = roleMatch ? roleMatch[0].trim() : r.role.replace(/_/g, ' ');
    out.push({ name, role: roleLabel, detectedRole: r.role, roleConfidence: r.conf, sourceUrl });
  }
  return out;
}

export function detectDecisionMakers(
  root: HTMLElement,
  text: string,
  sourceUrl: string,
): DetectedPerson[] {
  const text1 = detectDecisionMakersFromText(text, sourceUrl);
  const dom1 = detectDecisionMakersFromDom(root, sourceUrl);
  // Dedupe by name (case-insensitive). Prefer DOM-detected (richer role string).
  const out = new Map<string, DetectedPerson>();
  for (const p of [...dom1, ...text1]) {
    const key = p.name.toLowerCase();
    if (!out.has(key)) out.set(key, p);
  }
  return Array.from(out.values());
}

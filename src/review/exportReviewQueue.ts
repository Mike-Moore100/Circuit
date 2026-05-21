import fs from 'node:fs';
import path from 'node:path';
import type { ReviewQueueRow } from '../types/index';
import { config } from '../config/index';

function ensureOutputDir(): string {
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }
  return config.outputDir;
}

export function writeReviewQueueJson(rows: ReviewQueueRow[]): string {
  const dir = ensureOutputDir();
  const file = path.join(dir, 'review-queue.json');
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
  return file;
}

// Minimal CSV writer — only the headline columns. Reasons live in the JSON
// export to avoid quoting headaches with embedded commas / newlines.
function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function writeReviewQueueCsv(rows: ReviewQueueRow[]): string {
  const dir = ensureOutputDir();
  const file = path.join(dir, 'review-queue.csv');
  const header = [
    'company',
    'website',
    'industry',
    'location',
    'source',
    'rule_score',
    'intent_score',
    'final_score',
    'priority',
    'status',
    'top_reasons',
    'suggested_next_step',
  ].join(',');
  const lines = rows.map((r) =>
    [
      csvEscape(r.company),
      csvEscape(r.website),
      csvEscape(r.industry),
      csvEscape(r.location),
      csvEscape(r.source),
      csvEscape(r.ruleScore),
      csvEscape(r.intentScore),
      csvEscape(r.finalScore),
      csvEscape(r.priority),
      csvEscape(r.status),
      csvEscape(r.reasons.slice(0, 3).map((x) => x.label).join('; ')),
      csvEscape(r.suggestedNextStep),
    ].join(','),
  );
  fs.writeFileSync(file, [header, ...lines].join('\n') + '\n');
  return file;
}

export function exportReviewQueue(rows: ReviewQueueRow[]): { jsonPath: string; csvPath: string } {
  return {
    jsonPath: writeReviewQueueJson(rows),
    csvPath: writeReviewQueueCsv(rows),
  };
}

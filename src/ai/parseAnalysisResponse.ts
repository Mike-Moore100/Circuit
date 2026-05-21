import { AiAnalysisResultSchema, type AiAnalysisResult } from './aiTypes';

// Try to recover JSON from common framings: bare JSON, json fenced code,
// arbitrary fenced code, JSON wrapped with prose. Returns null if nothing
// JSON-like is found.
function extractJsonBlock(text: string): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced && fenced[1]) {
    const inner = fenced[1].trim();
    if (inner.startsWith('{')) return inner;
  }
  // Find the first '{' and the last '}' and try that span.
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return null;
}

export interface ParseSuccess {
  ok: true;
  result: AiAnalysisResult;
}

export interface ParseFailure {
  ok: false;
  error: string;
  rawJson: string | null;
}

export type ParseOutcome = ParseSuccess | ParseFailure;

export function parseAnalysisResponse(rawText: string): ParseOutcome {
  const candidate = extractJsonBlock(rawText);
  if (!candidate) {
    return { ok: false, error: 'No JSON block found in response.', rawJson: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    return {
      ok: false,
      error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      rawJson: candidate,
    };
  }

  const validated = AiAnalysisResultSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      error: `Schema validation failed: ${validated.error.message}`,
      rawJson: candidate,
    };
  }

  return { ok: true, result: validated.data };
}

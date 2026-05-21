// Service-layer contracts. Every reusable Circuit service follows the same
// shape so CLI scripts, API routes, dashboards, and future schedulers can
// all consume the same code paths.
//
// Architecture rule: services own orchestration + DB I/O + concurrency.
// They report progress through a structured callback, return a structured
// result, and never write directly to stdout. Presentation (console
// formatting, JSON serialisation, UI rendering) is the caller's job.

export type ProgressLevel = 'info' | 'success' | 'warn' | 'error';

export interface ProgressEvent {
  level: ProgressLevel;
  // Stable code (e.g. 'eligible.found', 'lead.ok', 'lead.failed', 'batch.done').
  // Lets API consumers translate to UI states without parsing the message.
  code: string;
  // Human-readable message. Safe to render verbatim.
  message: string;
  // Free-form structured payload — lead id, error message, counts, etc.
  // Typed as `object` so call sites can pass typed structs without
  // a manual Record<string, unknown> cast.
  data?: object;
}

export type ProgressCallback = (event: ProgressEvent) => void;

// Catch-all result envelope. Services that produce per-item results can
// embed them under `items`; services that produce summary stats embed
// them under `stats`. `ok` + `durationMs` are always present.
export interface ServiceResult<TItem = unknown, TStats = Record<string, unknown>> {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  items?: TItem[];
  stats?: TStats;
  errors: string[];
}

// Tiny helper for services that want to no-op when the caller doesn't
// supply a progress callback.
export const NOOP_PROGRESS: ProgressCallback = () => {};

// Boilerplate every service can reuse — converts a started-at instant
// + ok flag + items/stats into a complete envelope.
export function makeResult<TItem, TStats>(
  args: {
    ok: boolean;
    startedAt: Date;
    items?: TItem[];
    stats?: TStats;
    errors?: string[];
  },
): ServiceResult<TItem, TStats> {
  const finishedAt = new Date();
  return {
    ok: args.ok,
    startedAt: args.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - args.startedAt.getTime(),
    items: args.items,
    stats: args.stats,
    errors: args.errors ?? [],
  };
}

'use client';

// Phase 1 Live Validation — outcome tracker in the lead drawer. Lets the
// operator record what happened with this lead (CONTACTED, REPLIED,
// INTERESTED, BAD_FIT, etc.) and shows the timeline of past outcomes.
//
// This is NOT outreach automation. It's a tracking log. Nothing in this
// component sends an email or makes a call.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  OUTCOME_HINT,
  OUTCOME_LABEL,
  OUTCOME_TONE,
  OUTCOME_TYPES,
  type OutcomeType,
} from '../../src/validation/outcomeTypes';

export interface OutcomeRow {
  id: string;
  outcomeType: string;
  notes: string | null;
  createdAt: string;
}

interface Props {
  companyId: string;
  outcomes: OutcomeRow[];
}

// Order shown in the action grid. The most common operational signals
// (CONTACTED → REPLIED → INTERESTED / MEETING_BOOKED) sit first, then
// the negative resolutions, then the post-contact qualification flags.
const GRID_ORDER: OutcomeType[] = [
  'CONTACTED',
  'REPLIED',
  'INTERESTED',
  'MEETING_BOOKED',
  'NO_RESPONSE',
  'NOT_INTERESTED',
  'BAD_FIT',
  'STRONG_OPPORTUNITY',
  'WEAK_OPPORTUNITY',
];

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function OutcomeTracker({ companyId, outcomes }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<OutcomeType | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function record(outcomeType: OutcomeType) {
    setError(null);
    setBusy(outcomeType);
    try {
      const res = await fetch('/api/lead-outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          outcomeType,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Request failed (${res.status})`);
        return;
      }
      setNotes('');
    } finally {
      setBusy(null);
    }
    startTransition(() => router.refresh());
  }

  async function undo(id: string) {
    setError(null);
    try {
      const res = await fetch('/api/lead-outcome', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Request failed (${res.status})`);
        return;
      }
    } catch {
      setError('Could not remove outcome.');
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="outcome-tracker">
      <div className="outcome-actions" role="group" aria-label="Record outcome">
        {GRID_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            className={`btn btn-sm outcome-btn outcome-btn-${OUTCOME_TONE[t]}`}
            onClick={() => record(t)}
            disabled={pending || busy === t}
            title={OUTCOME_HINT[t]}
            data-outcome-action={t}
          >
            {OUTCOME_LABEL[t]}
          </button>
        ))}
      </div>
      <textarea
        className="outcome-notes"
        placeholder="Optional note about this outcome…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={2000}
        rows={2}
      />
      {error && <div className="action-error">{error}</div>}

      {outcomes.length > 0 && (
        <ol className="outcome-timeline" aria-label="Outcome timeline">
          {outcomes.map((o) => {
            const tone = (OUTCOME_TONE as Record<string, string>)[o.outcomeType] ?? 'neutral';
            return (
              <li key={o.id} className={`outcome-row outcome-row-${tone}`}>
                <span className="outcome-when">{fmtRelative(o.createdAt)}</span>
                <span className="outcome-type">
                  {(OUTCOME_LABEL as Record<string, string>)[o.outcomeType] ??
                    o.outcomeType.replace(/_/g, ' ').toLowerCase()}
                </span>
                {o.notes && <span className="outcome-note">{o.notes}</span>}
                <button
                  type="button"
                  className="outcome-undo"
                  onClick={() => undo(o.id)}
                  disabled={pending}
                  aria-label="Remove outcome"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Action = 'accept' | 'reject' | 'contacted' | 'requeue';
type Status = 'queued' | 'investigating' | 'contacted' | 'rejected';

interface Props {
  companyId: string;
  status: Status;
}

const LABELS: Record<Action, string> = {
  accept: 'Accept',
  reject: 'Reject',
  contacted: 'Mark contacted',
  requeue: 'Re-queue',
};

// Hick's law: only show the next-step actions that make sense for the
// current status. Primary action is the most likely next move.
function actionsFor(status: Status): { primary: Action | null; secondary: Action[] } {
  switch (status) {
    case 'queued':
      return { primary: 'accept', secondary: ['reject'] };
    case 'investigating':
      return { primary: 'contacted', secondary: ['reject', 'requeue'] };
    case 'contacted':
      return { primary: 'requeue', secondary: ['reject'] };
    case 'rejected':
      return { primary: 'requeue', secondary: [] };
    default:
      return { primary: null, secondary: [] };
  }
}

function btnClassFor(action: Action, isPrimary: boolean): string {
  if (action === 'accept' && isPrimary) return 'btn btn-success';
  if (action === 'reject') return 'btn btn-danger';
  if (isPrimary) return 'btn btn-primary';
  return 'btn btn-ghost';
}

export function ReviewActions({ companyId, status }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { primary, secondary } = actionsFor(status);

  async function send(action: Action) {
    setError(null);
    const res = await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId, action }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? `Request failed (${res.status})`);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="action-row row-actions">
      {primary && (
        <button
          type="button"
          onClick={() => send(primary)}
          disabled={isPending}
          className={`${btnClassFor(primary, true)} btn-sm`}
        >
          {LABELS[primary]}
        </button>
      )}
      {secondary.map((action) => (
        <button
          key={action}
          type="button"
          onClick={() => send(action)}
          disabled={isPending}
          className={`${btnClassFor(action, false)} btn-sm`}
        >
          {LABELS[action]}
        </button>
      ))}
      {error && <span className="action-error">{error}</span>}
    </div>
  );
}

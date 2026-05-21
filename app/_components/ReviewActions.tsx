'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Action = 'accept' | 'reject' | 'contacted' | 'requeue';
type Status = 'queued' | 'investigating' | 'contacted' | 'rejected';

interface Props {
  companyId: string;
  status: Status;
}

const NEXT_LABEL: Record<Action, string> = {
  accept: 'Accept',
  reject: 'Reject',
  contacted: 'Contacted',
  requeue: 'Re-queue',
};

export function ReviewActions({ companyId, status }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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

  const visible: Action[] =
    status === 'queued'
      ? ['accept', 'reject']
      : status === 'investigating'
      ? ['contacted', 'reject', 'requeue']
      : status === 'contacted'
      ? ['reject', 'requeue']
      : ['requeue'];

  return (
    <div className="review-actions">
      <span className={`status-tag status-${status}`}>{status}</span>
      <div className="action-row">
        {visible.map((action) => (
          <button
            key={action}
            onClick={() => send(action)}
            disabled={isPending}
            className={`action-btn action-${action}`}
            type="button"
          >
            {NEXT_LABEL[action]}
          </button>
        ))}
      </div>
      {error && <div className="action-error">{error}</div>}
    </div>
  );
}

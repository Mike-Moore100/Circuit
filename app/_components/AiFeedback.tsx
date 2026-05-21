'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Feedback =
  | 'useful'
  | 'not_useful'
  | 'hallucination'
  | 'approved'
  | 'rejected'
  | 'pending';

interface Props {
  analysisId: string;
  current: string;
}

const ACTIONS: Array<{ key: Feedback; label: string; tone: string }> = [
  { key: 'approved', label: 'Approve', tone: 'btn-success' },
  { key: 'useful', label: 'Useful', tone: 'btn' },
  { key: 'not_useful', label: 'Not useful', tone: 'btn-ghost' },
  { key: 'hallucination', label: 'Flag hallucination', tone: 'btn-danger' },
];

export function AiFeedback({ analysisId, current }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function send(feedback: Feedback) {
    setError(null);
    const res = await fetch('/api/ai-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysisId, feedback }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? `Request failed (${res.status})`);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="ai-feedback">
      <span className={`status-pill ${tagClass(current)}`}>{current}</span>
      <div className="action-row">
        {ACTIONS.map((a) => (
          <button
            key={a.key}
            type="button"
            className={`btn ${a.tone}`}
            onClick={() => send(a.key)}
            disabled={pending}
          >
            {a.label}
          </button>
        ))}
      </div>
      {error && <div className="action-error">{error}</div>}
    </div>
  );
}

function tagClass(status: string): string {
  if (status === 'approved' || status === 'useful') return 'completed';
  if (status === 'not_useful' || status === 'rejected') return 'failed';
  if (status === 'hallucination') return 'rejected';
  return 'queued';
}

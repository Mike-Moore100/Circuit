'use client';

// Operator-throughput shell around the OpportunityCard list. Handles:
//   - keyboard navigation (j/k or ↓/↑ to move between cards)
//   - opening the drawer (o or Enter on the highlighted card)
//   - quick reviews via the cards' own quick-action buttons (triggered
//     here by hotkey: s=strong, i=ignore, r=revisit, v=high value,
//     f=fast close, w=wrong campaign)
//   - scrolling the highlighted card into view as the operator moves
//
// We deliberately make this thin: the card owns its own action wiring
// (one API call per click); this shell just dispatches a synthetic
// click on the matching button so we have exactly one persistence path.
// That keeps the "active card" highlight in sync with the operator's
// intent — if the click fails for some reason, the card itself surfaces
// the error.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OpportunityCard } from './OpportunityCard';
import type { ReviewQueueRow } from '../../src/types';
import type { IntelligenceRowSummary } from '../_lib/dashboardData';

export interface OpportunityListItem {
  row: ReviewQueueRow;
  intel: IntelligenceRowSummary | undefined;
  hasContact: boolean;
  hasPhone: boolean;
  operatorTags: string[];
}

interface Props {
  items: OpportunityListItem[];
  selectedId: string | null;
  campaignFilter: string | null;
}

// Hotkey → quick-action button data attribute. We click rather than
// re-implement the action so the persistence path stays in one place.
const HOTKEYS: Record<string, string> = {
  s: 'strong_opportunity', // teach: this lead is strong
  i: 'ignore',
  r: 'revisit_later',
  v: 'likely_high_value',
  f: 'likely_fast_close',
  w: 'wrong_campaign',
  t: 'high_trust_barrier',
  m: 'needs_manual_investigation',
};

function buildDetailHref(companyId: string, campaignFilter: string | null): string {
  const params = new URLSearchParams({ lead: companyId });
  if (campaignFilter) params.set('campaign', campaignFilter);
  return `/opportunities?${params.toString()}`;
}

export function OpportunityList({ items, selectedId, campaignFilter }: Props) {
  const router = useRouter();
  // The keyboard cursor is the *active* card the operator is moving
  // through. It's distinct from `selectedId` (which is the drawer
  // selection), so an operator can preview-skim with j/k without
  // popping the drawer open on every move.
  const initialIdx = (() => {
    if (!selectedId) return 0;
    const i = items.findIndex((it) => it.row.companyId === selectedId);
    return i >= 0 ? i : 0;
  })();
  const [cursor, setCursor] = useState(initialIdx);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollPendingRef = useRef(false);

  // Reset cursor when the underlying list changes shape (e.g. campaign
  // filter switches). Otherwise we'd land on a stale row.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, items.length - 1)));
  }, [items.length]);

  // Keep the active card visible as the operator moves through. We
  // skip the first render so we don't trigger an unwanted scroll on
  // load.
  useEffect(() => {
    if (!scrollPendingRef.current) {
      scrollPendingRef.current = true;
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(
      `[data-card-index="${cursor}"]`,
    );
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [cursor]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Don't hijack the keyboard while the user is typing into a field.
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      if (target?.isContentEditable) return;

      const key = e.key.toLowerCase();
      const max = items.length - 1;
      if (max < 0) return;

      if (key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, max));
        return;
      }
      if (key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
        return;
      }
      if (key === 'g' && !e.shiftKey) {
        e.preventDefault();
        setCursor(0);
        return;
      }
      if (e.key === 'G' || (key === 'g' && e.shiftKey)) {
        e.preventDefault();
        setCursor(max);
        return;
      }

      const active = items[cursor];
      if (!active) return;

      if (key === 'o' || key === 'enter' || e.key === 'Enter') {
        e.preventDefault();
        router.push(buildDetailHref(active.row.companyId, campaignFilter), {
          scroll: false,
        });
        return;
      }
      if (key === 'escape' || e.key === 'Escape') {
        if (selectedId) {
          e.preventDefault();
          router.push('/opportunities', { scroll: false });
        }
        return;
      }
      if (key === 'e') {
        // Expand toggle — fire the "More" button on the active card.
        e.preventDefault();
        const card = document.querySelector<HTMLElement>(
          `[data-card-id="${active.row.companyId}"]`,
        );
        const moreBtn = card?.querySelector<HTMLButtonElement>(
          'button[aria-expanded]',
        );
        moreBtn?.click();
        return;
      }
      if (key === '?') {
        e.preventDefault();
        // Toggle the help dialog by clicking the global trigger if present.
        document
          .querySelector<HTMLButtonElement>('[data-opp-help]')
          ?.click();
        return;
      }

      const action = HOTKEYS[key];
      if (action) {
        e.preventDefault();
        const card = document.querySelector<HTMLElement>(
          `[data-card-id="${active.row.companyId}"]`,
        );
        // Try primary actions first, then secondary (which may need to
        // expand). If the secondary row is collapsed, expand it first
        // so the button is in the DOM.
        let btn = card?.querySelector<HTMLButtonElement>(
          `[data-quick-action="${action}"]`,
        );
        if (!btn) {
          const more = card?.querySelector<HTMLButtonElement>(
            'button[aria-expanded="false"]',
          );
          more?.click();
          // Re-query after the expand re-render. We use rAF rather than
          // setTimeout to stay frame-aligned.
          requestAnimationFrame(() => {
            const retry = card?.querySelector<HTMLButtonElement>(
              `[data-quick-action="${action}"]`,
            );
            retry?.click();
          });
          return;
        }
        btn.click();
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [items, cursor, router, campaignFilter, selectedId]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="opp-card-list" ref={containerRef}>
      {items.map((it, idx) => (
        <OpportunityCard
          key={it.row.companyId}
          row={it.row}
          intel={it.intel}
          isSelected={idx === cursor}
          detailHref={buildDetailHref(it.row.companyId, campaignFilter)}
          operatorTags={new Set(it.operatorTags)}
          hasContact={it.hasContact}
          hasPhone={it.hasPhone}
          index={idx}
        />
      ))}
    </div>
  );
}

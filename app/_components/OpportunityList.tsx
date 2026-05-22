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
import { mapHotkey, moveCursor } from './opportunityCardLogic';
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
  topN: number | null;
}

function buildDetailHref(
  companyId: string,
  campaignFilter: string | null,
  topN: number | null,
): string {
  const params = new URLSearchParams({ lead: companyId });
  if (campaignFilter) params.set('campaign', campaignFilter);
  if (topN) params.set('top', String(topN));
  return `/opportunities?${params.toString()}`;
}

export function OpportunityList({ items, selectedId, campaignFilter, topN }: Props) {
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
      if (items.length === 0) return;

      const intent = mapHotkey(e.key, e.key, e.shiftKey);
      if (!intent) return;

      if (intent.kind === 'move' || intent.kind === 'jump') {
        e.preventDefault();
        setCursor((c) => moveCursor(c, intent, items.length));
        return;
      }

      const active = items[cursor];
      if (!active) return;

      if (intent.kind === 'open') {
        e.preventDefault();
        router.push(buildDetailHref(active.row.companyId, campaignFilter, topN), {
          scroll: false,
        });
        return;
      }
      if (intent.kind === 'close') {
        if (selectedId) {
          e.preventDefault();
          router.push('/opportunities', { scroll: false });
        }
        return;
      }
      if (intent.kind === 'expand') {
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
      if (intent.kind === 'help') {
        e.preventDefault();
        document
          .querySelector<HTMLButtonElement>('[data-opp-help]')
          ?.click();
        return;
      }
      if (intent.kind === 'action') {
        e.preventDefault();
        const card = document.querySelector<HTMLElement>(
          `[data-card-id="${active.row.companyId}"]`,
        );
        // Try primary actions first; secondary actions live behind
        // "More" so we expand and retry on the next frame if missing.
        const btn = card?.querySelector<HTMLButtonElement>(
          `[data-quick-action="${intent.action}"]`,
        );
        if (!btn) {
          const more = card?.querySelector<HTMLButtonElement>(
            'button[aria-expanded="false"]',
          );
          more?.click();
          requestAnimationFrame(() => {
            const retry = card?.querySelector<HTMLButtonElement>(
              `[data-quick-action="${intent.action}"]`,
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
  }, [items, cursor, router, campaignFilter, topN, selectedId]);

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
          detailHref={buildDetailHref(it.row.companyId, campaignFilter, topN)}
          operatorTags={new Set(it.operatorTags)}
          hasContact={it.hasContact}
          hasPhone={it.hasPhone}
          index={idx}
        />
      ))}
    </div>
  );
}

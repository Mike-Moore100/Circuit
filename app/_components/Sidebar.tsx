'use client';

// Persistent operations sidebar. Three top-level operator goals —
// Opportunities (commercial output), Pipeline (flow + sources),
// Intelligence (scoring + calibration). Settings sits as a low-key
// footer item, visually separated, never as part of the operator's
// daily navigation rhythm.
//
// Sub-navigation lives inside each group as horizontal tabs at the
// top of the page — see app/_components/SectionSubNav.tsx. The
// sidebar deliberately stays this minimal so the operator never has
// to mentally model the system's internal pages.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { currentGroup, NAV_GROUPS, type NavGroupKey } from '../_lib/navStructure';

const icons: Record<NavGroupKey | 'settings', React.ReactNode> = {
  opportunities: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9 12 2" />
    </svg>
  ),
  pipeline: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6h16" />
      <path d="M4 12h11" />
      <path d="M4 18h6" />
      <path d="M18 9l4 3-4 3" />
    </svg>
  ),
  intelligence: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2a4 4 0 0 0-4 4v1a4 4 0 0 0 0 8v1a4 4 0 0 0 8 0v-1a4 4 0 0 0 0-8V6a4 4 0 0 0-4-4z" />
    </svg>
  ),
  settings: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

interface SidebarBadges {
  reviewQueue?: number;
  qualificationPending?: number;
  discoveryToday?: number;
  dataMode?: 'REAL' | 'DEMO';
}

export function Sidebar() {
  const pathname = usePathname() ?? '/';
  const activeGroup = currentGroup(pathname);
  const [badges, setBadges] = useState<SidebarBadges>({});

  useEffect(() => {
    fetch('/api/sidebar-badges', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setBadges(data);
      })
      .catch(() => {});
  }, [pathname]);

  // Per-group counter — only the one that makes sense to surface at
  // the top level. Sub-tabs render the rest in their own strip.
  const groupBadge = (key: NavGroupKey): number | null => {
    if (key === 'opportunities') return badges.reviewQueue ?? null;
    if (key === 'pipeline') return badges.qualificationPending ?? null;
    return null;
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">C</div>
        <div className="sidebar-brand-name">Circuit</div>
        {badges.dataMode && (
          <span
            className={`data-mode-pill data-mode-${badges.dataMode.toLowerCase()}`}
            title={
              badges.dataMode === 'REAL'
                ? 'Real data only. DEMO leads are filtered out.'
                : 'DEMO mode — dashboard includes seed/mock data.'
            }
          >
            {badges.dataMode}
          </span>
        )}
      </div>

      <nav className="nav-stack nav-primary">
        {NAV_GROUPS.map((group) => {
          const active = activeGroup?.key === group.key;
          const count = groupBadge(group.key);
          return (
            <Link
              key={group.key}
              href={group.href}
              className={`nav-item nav-item-primary${active ? ' nav-item-active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <span className="nav-item-icon">{icons[group.key]}</span>
              <span className="nav-item-label">{group.label}</span>
              {typeof count === 'number' && count > 0 && (
                <span className="nav-badge">{count}</span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <Link
          href="/settings"
          className={`nav-item nav-item-footer${pathname.startsWith('/settings') ? ' nav-item-active' : ''}`}
          aria-current={pathname.startsWith('/settings') ? 'page' : undefined}
        >
          <span className="nav-item-icon">{icons.settings}</span>
          <span className="nav-item-label">Settings</span>
        </Link>
      </div>
    </aside>
  );
}

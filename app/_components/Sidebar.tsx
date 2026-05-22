'use client';

// Persistent operations sidebar. Client component so usePathname() can
// drive the active-state without server-rendering 9 different navs.
//
// Each link is a real Next.js route. The IA reflects the pipeline:
//
//   Overview        → cross-cutting summary
//   Discovery       → top of funnel
//   Qualification   → middle of funnel (inspection / contacts / evidence)
//   Opportunities   → ranked output
//   Campaigns       → per-campaign segments
//   Review          → operator feedback + calibration
//   Intelligence    → scoring debug + signal explorer
//   Sources         → connector health
//   Queue Monitor   → live queue depth + throughput

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

interface NavBadge {
  href: string;
  count: number;
}

interface NavItemDef {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const icons: Record<string, React.ReactNode> = {
  overview: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  discovery: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  qualification: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  opportunities: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9 12 2" />
    </svg>
  ),
  campaigns: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  review: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  ),
  intelligence: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2a4 4 0 0 0-4 4v1a4 4 0 0 0 0 8v1a4 4 0 0 0 8 0v-1a4 4 0 0 0 0-8V6a4 4 0 0 0-4-4z" />
    </svg>
  ),
  sources: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      <path d="M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6" />
    </svg>
  ),
  queue: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <line x1="8" y1="6" x2="8" y2="18" />
      <line x1="14" y1="6" x2="14" y2="18" />
    </svg>
  ),
};

const NAV: NavItemDef[] = [
  { href: '/', label: 'Overview', icon: icons.overview },
  { href: '/discovery', label: 'Discovery', icon: icons.discovery },
  { href: '/qualification', label: 'Qualification', icon: icons.qualification },
  { href: '/opportunities', label: 'Opportunities', icon: icons.opportunities },
  { href: '/campaigns', label: 'Campaigns', icon: icons.campaigns },
  { href: '/review', label: 'Review', icon: icons.review },
  // Phase 14 — calibration sits between Review (where feedback is captured)
  // and Intelligence (where per-lead scoring is debugged).
  { href: '/calibration', label: 'Calibration', icon: icons.intelligence },
  { href: '/intelligence', label: 'Intelligence', icon: icons.intelligence },
  { href: '/sources', label: 'Sources', icon: icons.sources },
  { href: '/queue', label: 'Queue', icon: icons.queue },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface SidebarBadges {
  reviewQueue?: number;
  qualificationPending?: number;
  discoveryToday?: number;
  dataMode?: 'REAL' | 'DEMO';
}

export function Sidebar() {
  const pathname = usePathname() ?? '/';
  // Badges are fetched once when the sidebar mounts — they're tiny counts
  // so a single fetch is cheaper than threading them through every page's
  // server component.
  const [badges, setBadges] = useState<SidebarBadges>({});
  useEffect(() => {
    fetch('/api/sidebar-badges', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setBadges(data);
      })
      .catch(() => {});
  }, [pathname]); // refresh when navigating so counts stay live

  const badge = (href: string): number | null => {
    if (href === '/discovery') return badges.discoveryToday ?? null;
    if (href === '/opportunities') return badges.reviewQueue ?? null;
    if (href === '/queue') return badges.qualificationPending ?? null;
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

      <nav className="nav-stack">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const count = badge(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${active ? ' nav-item-active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <span className="nav-item-icon">{item.icon}</span>
              <span className="nav-item-label">{item.label}</span>
              {typeof count === 'number' && count > 0 && (
                <span className="nav-badge">{count}</span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

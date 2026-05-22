'use client';

// Renders the horizontal tab strip at the top of every group page.
// Lives in the root layout, so individual pages don't need to know
// about it — it picks the right group based on the current pathname.

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  currentGroup,
  matchTab,
  type NavGroup,
  type NavTab,
} from '../_lib/navStructure';

export function SectionSubNav() {
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams() ?? new URLSearchParams();
  const group = currentGroup(pathname);
  if (!group) return null;
  const active = matchTab(group, pathname, searchParams);

  return (
    <div className="section-subnav" data-group={group.key}>
      <div className="section-subnav-meta">
        <span className="section-subnav-group-label">{group.label}</span>
        <span className="section-subnav-subtitle">{group.subtitle}</span>
      </div>
      <nav className="section-subnav-tabs" aria-label={`${group.label} sub-navigation`}>
        {group.tabs.map((tab) => (
          <TabLink
            key={tab.href}
            group={group}
            tab={tab}
            isActive={active?.href === tab.href}
          />
        ))}
      </nav>
    </div>
  );
}

function TabLink({
  tab,
  isActive,
}: {
  group: NavGroup;
  tab: NavTab;
  isActive: boolean;
}) {
  return (
    <Link
      href={tab.href}
      scroll={false}
      className={`section-subnav-tab${isActive ? ' section-subnav-tab-active' : ''}`}
      aria-current={isActive ? 'page' : undefined}
    >
      {tab.label}
    </Link>
  );
}

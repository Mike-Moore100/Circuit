'use client';

// Thin tab strip rendered at the top of every group page. The
// sidebar already tells the operator which section they're in
// (active highlight), and each page's own PageHeader carries the
// title + subtitle — so this strip is JUST the tabs. No group
// label, no group subtitle, no doubled-up heading.

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
    <nav
      className="section-subnav"
      data-group={group.key}
      aria-label={`${group.label} sub-navigation`}
    >
      {group.tabs.map((tab) => (
        <TabLink
          key={tab.href}
          group={group}
          tab={tab}
          isActive={active?.href === tab.href}
        />
      ))}
    </nav>
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

import {
  BarChart3,
  LayoutDashboard,
  Mic,
  Settings,
  SlidersHorizontal,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { Role } from '@/lib/types'

export interface NavItem {
  to: string
  labelKey: string
  icon: LucideIcon
  /** Roles allowed to see this item. */
  roles: Role[]
  /** Exact-path match, or prefix match when `section` is true. */
  exact?: boolean
  section?: boolean
  keywords?: string
}

/**
 * One nav definition drives the sidebar, the breadcrumb and the ⌘K palette,
 * so they cannot drift apart the way the old hardcoded arrays did.
 */
export const NAV: NavItem[] = [
  {
    to: '/',
    labelKey: 'nav.dashboard',
    icon: LayoutDashboard,
    roles: ['admin', 'manager', 'receptionist', 'yonalish'],
    exact: true,
    keywords: 'analytics overview stats dashboard',
  },
  {
    to: '/calls',
    labelKey: 'nav.calls',
    icon: Mic,
    roles: ['admin', 'manager', 'receptionist', 'yonalish'],
    keywords: 'recordings transcript score',
  },
  {
    to: '/clients',
    labelKey: 'nav.clients',
    icon: Users,
    roles: ['admin', 'manager', 'receptionist', 'yonalish'],
    keywords: 'customers contacts companies',
  },
  {
    to: '/managers/admin',
    labelKey: 'nav.submenu.admin',
    icon: UserCog,
    roles: ['admin'],
    keywords: 'administrators owners access',
  },
  {
    to: '/managers',
    labelKey: 'nav.submenu.managers',
    icon: BarChart3,
    roles: ['admin', 'yonalish'],
    // `exact` so the two sibling routes do not light this up as well.
    exact: true,
    keywords: 'performance rankings coaching',
  },
  {
    to: '/managers/directions',
    labelKey: 'nav.submenu.directions',
    icon: SlidersHorizontal,
    roles: ['admin', 'yonalish'],
    keywords: 'employees solved problems directions',
  },
  {
    to: '/users',
    labelKey: 'nav.team',
    icon: Users,
    roles: ['admin'],
    keywords: 'accounts roles invites',
  },
  {
    to: '/settings',
    labelKey: 'nav.settings',
    icon: Settings,
    roles: ['admin'],
    keywords: 'mode privacy stt gemini configuration',
  },
]

export function visibleNav(role: Role | undefined): NavItem[] {
  if (!role) return []
  return NAV.filter((item) => item.roles.includes(role))
}

export function isNavActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.to
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}

/** The managers submenu: every `/managers*` route shares one expandable group. */
export const MANAGERS_PREFIX = '/managers'

export function isManagersPath(pathname: string): boolean {
  return pathname === MANAGERS_PREFIX || pathname.startsWith(`${MANAGERS_PREFIX}/`)
}

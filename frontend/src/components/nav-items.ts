import {
  BarChart3,
  LayoutDashboard,
  ListTodo,
  MessageSquare,
  Mic,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { Role } from '@/lib/types'

export type NavGroupKey = 'workspace' | 'coaching' | 'company'

export interface NavItem {
  to: string
  labelKey: string
  icon: LucideIcon
  /** Roles allowed to see this item. */
  roles: Role[]
  group: NavGroupKey
  /** Exact-path match, or prefix match when `section` is true. */
  exact?: boolean
  section?: boolean
  keywords?: string
}

/**
 * One nav definition drives the sidebar, the breadcrumb and the ⌘K palette,
 * organized into Metasell-style functional groups per role.
 */
export const NAV: NavItem[] = [
  {
    to: '/',
    labelKey: 'nav.dashboard',
    icon: LayoutDashboard,
    roles: ['admin'],
    group: 'workspace',
    exact: true,
    keywords: 'analytics overview stats dashboard company',
  },
  {
    to: '/',
    labelKey: 'nav.coaching_desk',
    icon: Sparkles,
    roles: ['yonalish'],
    group: 'workspace',
    exact: true,
    keywords: 'coaching desk supervisor escalate review quality',
  },
  {
    to: '/',
    labelKey: 'nav.my_day',
    icon: Sun,
    roles: ['manager', 'receptionist'],
    group: 'workspace',
    exact: true,
    keywords: 'my day overview personal score rank coaching',
  },
  {
    to: '/calls',
    labelKey: 'nav.calls',
    icon: Mic,
    roles: ['admin', 'manager', 'receptionist', 'yonalish'],
    group: 'workspace',
    keywords: 'recordings transcript score upload',
  },
  {
    to: '/tasks',
    labelKey: 'nav.tasks',
    icon: ListTodo,
    roles: ['admin', 'manager', 'receptionist', 'yonalish'],
    group: 'workspace',
    keywords: 'tasks action items follow ups alerts todo',
  },
  {
    to: '/clients',
    labelKey: 'nav.clients',
    icon: Users,
    roles: ['admin', 'manager', 'receptionist', 'yonalish'],
    group: 'workspace',
    keywords: 'customers contacts companies',
  },
  {
    to: '/telegram',
    labelKey: 'nav.telegram',
    icon: MessageSquare,
    roles: ['admin', 'receptionist', 'yonalish'],
    group: 'workspace',
    keywords: 'telegram messages clients questions',
  },
  {
    to: '/managers',
    labelKey: 'nav.submenu.managers',
    icon: BarChart3,
    roles: ['admin', 'yonalish'],
    group: 'coaching',
    exact: true,
    keywords: 'performance rankings coaching',
  },
  {
    to: '/managers/directions',
    labelKey: 'nav.submenu.directions',
    icon: SlidersHorizontal,
    roles: ['admin', 'yonalish'],
    group: 'coaching',
    keywords: 'employees solved problems directions',
  },
  {
    to: '/users',
    labelKey: 'nav.team',
    icon: Users,
    roles: ['admin'],
    group: 'company',
    keywords: 'accounts roles invites team',
  },
  {
    to: '/managers/admin',
    labelKey: 'nav.submenu.admin',
    icon: UserCog,
    roles: ['admin'],
    group: 'company',
    keywords: 'administrators owners access',
  },
  {
    to: '/settings',
    labelKey: 'nav.settings',
    icon: Settings,
    roles: ['admin'],
    group: 'company',
    keywords: 'mode privacy stt gemini configuration zadarma',
  },
  {
    to: '/profile',
    labelKey: 'nav.profile',
    icon: ShieldCheck,
    roles: ['admin', 'manager', 'receptionist', 'yonalish'],
    group: 'company',
    keywords: 'profile password security sessions token account',
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

import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  BarChart3,
  ChevronDown,
  Cloud,
  Lock,
  LogOut,
  Menu,
  Mic,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CommandPalette, OPEN_EVENT } from '@/components/CommandPalette'
import { LanguageToggleIcon } from '@/i18n/LanguageToggle'
import { NotificationBell } from '@/components/NotificationBell'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/i18n/i18n'
import { useMode } from '@/lib/mode'
import { SPRING, fadeUp } from '@/lib/motion'
import { NAV, isManagersPath, isNavActive, visibleNav, type NavItem } from '@/components/nav-items'
import { cn } from '@/lib/utils'

/** Platform-correct modifier label for the command palette hint. */
function useIsMac(): boolean {
  const [isMac, setIsMac] = useState(
    () => typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  )
  useEffect(() => {
    setIsMac(/Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent))
  }, [])
  return isMac
}

/** True at the `lg` breakpoint and up, where the sidebar is always visible. */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 64rem)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 64rem)')
    const onChange = () => setIsDesktop(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const { t } = useI18n()
  const location = useLocation()
  const reduced = useReducedMotion()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [managersOpen, setManagersOpen] = useState(false)
  const isDesktop = useIsDesktop()
  const isMac = useIsMac()
  const { loading: modeLoading, sttUnavailable } = useMode()

  const items = visibleNav(user?.role)
  const managersGroup = items.filter((i) => isManagersPath(i.to))
  const topLevel = items.filter((i) => !isManagersPath(i.to))
  const managersActive = isManagersPath(location.pathname)

  useEffect(() => {
    setSidebarOpen(false)
    if (managersActive) setManagersOpen(true)
  }, [location.pathname, managersActive])

  // Escape closes the mobile drawer. There was no key handler at all: the only
  // ways out were the X button and clicking the scrim.
  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

  const breadcrumb = useBreadcrumb(location.pathname, t, items)

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-100 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:ring-1 focus:ring-border"
      >
        {t('a11y.skip_to_content')}
      </a>

      <div className="flex min-h-dvh">
        {/* AnimatePresence was missing here, so `exit` never ran: the scrim
            vanished the instant the state flipped while the drawer kept
            sliding for another 200ms with nothing to click. */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.button
              type="button"
              aria-label={t('common.close')}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 z-40 bg-neutral-1000/30 backdrop-blur-[2px] lg:hidden"
            />
          )}
        </AnimatePresence>

        {/* ---------------------------------------------------------------- */}
        {/* Sidebar                                                          */}
        {/* ---------------------------------------------------------------- */}
        <motion.aside
          aria-label={t('nav.sidebar')}
          // `-translate-x-full` only moves it off-screen; every nav link stayed
          // in the tab order, so keyboard users tabbed into an invisible
          // drawer. `inert` removes it from focus and the a11y tree, but only
          // while it is actually hidden — on desktop it is always visible
          // regardless of `sidebarOpen`.
          inert={!isDesktop && !sidebarOpen ? true : undefined}
          animate={{ x: 0 }}
          initial={false}
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-sidebar-border bg-sidebar',
            'transition-transform duration-200 ease-standard lg:translate-x-0',
            sidebarOpen ? 'translate-x-0 shadow-e4' : '-translate-x-full'
          )}
        >
          <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4">
            <Link
              to="/"
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Mic aria-hidden="true" className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold tracking-[-0.01em]">
                  {t('brand.name')}
                </span>
                <span className="block truncate text-2xs text-muted-foreground">
                  {t('brand.tagline')}
                </span>
              </span>
            </Link>
            <Button
              variant="ghost"
              size="icon-sm"
              className="lg:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-label={t('common.close')}
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>

          <nav className="flex-1 overflow-y-auto px-2.5 py-3" aria-label={t('nav.primary')}>
            <NavGroup items={topLevel} pathname={location.pathname} />

            {managersGroup.length > 0 && (
              <>
                <div className="my-3 h-px bg-sidebar-border" />
                <button
                  type="button"
                  onClick={() => setManagersOpen((o) => !o)}
                  aria-expanded={managersOpen}
                  aria-controls="managers-submenu"
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium outline-none',
                    'transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    managersActive
                      ? 'text-sidebar-accent-foreground'
                      : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
                  )}
                >
                  <BarChart3 aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">{t('nav.managers')}</span>
                  <motion.span
                    animate={{ rotate: managersOpen ? 180 : 0 }}
                    transition={SPRING.snappy}
                    className="shrink-0"
                  >
                    <ChevronDown aria-hidden="true" className="size-3.5" />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {managersOpen && (
                    <motion.ul
                      id="managers-submenu"
                      initial={reduced ? false : { height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                      transition={SPRING.standard}
                      className="overflow-hidden"
                    >
                      {/* A <ul> may only contain <li>: the wrapper used to be a
                          plain <div> holding bare links, so assistive tech saw
                          an empty list. */}
                      <li className="mt-0.5 space-y-0.5 border-l border-sidebar-border pl-2.5">
                        {managersGroup.map((item) => (
                          <NavLink key={item.to} item={item} pathname={location.pathname} nested />
                        ))}
                      </li>
                    </motion.ul>
                  )}
                </AnimatePresence>
              </>
            )}
          </nav>

          {/* Private-mode warning lives in the sidebar so it is impossible to
              miss, but it only appears when the local model is unusable. */}
          {sttUnavailable && (
            <div className="border-t border-sidebar-border px-3 py-2.5">
              <div className="flex items-start gap-2 rounded-md bg-warning-soft px-2.5 py-2 text-warning-soft-foreground">
                <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                <p className="text-2xs leading-relaxed">{t('mode.stt_unavailable_sidebar')}</p>
              </div>
            </div>
          )}

          {user && (
            <div className="border-t border-sidebar-border p-2.5">
              <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-foreground">
                  {user.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{user.name}</p>
                  <p className="truncate text-2xs text-muted-foreground">
                    {t(`nav.role.${user.role}`)}
                  </p>
                </div>
                <Button
                  variant="destructive-ghost"
                  size="icon-sm"
                  onClick={() => void logout()}
                  aria-label={t('nav.logout')}
                  title={t('nav.logout')}
                >
                  <LogOut aria-hidden="true" className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </motion.aside>

        {/* ---------------------------------------------------------------- */}
        {/* Main column                                                      */}
        {/* ---------------------------------------------------------------- */}
        <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
          <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
            <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
              <Button
                variant="ghost"
                size="icon-sm"
                className="lg:hidden"
                onClick={() => setSidebarOpen(true)}
                aria-label={t('nav.open_menu')}
              >
                <Menu aria-hidden="true" className="size-4" />
              </Button>

              <nav aria-label={t('nav.breadcrumb')} className="min-w-0 flex-1">
                <ol className="flex min-w-0 items-center gap-1.5 text-xs">
                  <li className="hidden shrink-0 text-muted-foreground sm:block">
                    {t('brand.name')}
                  </li>
                  {breadcrumb.map((crumb) => (
                    <li key={crumb.label} className="flex min-w-0 items-center gap-1.5">
                      <span aria-hidden="true" className="hidden text-muted-foreground/50 sm:block">
                        /
                      </span>
                      {crumb.to ? (
                        <Link
                          to={crumb.to}
                          className="truncate text-muted-foreground transition-colors hover:text-foreground hover:underline"
                        >
                          {crumb.label}
                        </Link>
                      ) : (
                        <span aria-current="page" className="truncate font-medium">
                          {crumb.label}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </nav>

              <ModeBadge />

              <Button
                variant="outline"
                size="sm"
                onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
                className="hidden text-muted-foreground sm:inline-flex"
              >
                <Search aria-hidden="true" className="size-3.5" />
                <span className="text-xs">{t('command.open')}</span>
                <kbd className="rounded-sm border border-border bg-surface-sunken px-1 font-mono text-2xs">
                  {/* CommandPalette accepts metaKey *or* ctrlKey; advertising only
                      ⌘ sent Linux and Windows users pressing a key that did
                      nothing. */}
                  {isMac ? '⌘K' : 'Ctrl K'}
                </kbd>
              </Button>

              {user && (
                <>
                  <NotificationBell />
                  <ThemeToggle />
                  <LanguageToggleIcon />
                </>
              )}
            </div>
          </header>

          <motion.main
            id="main"
            key={location.pathname}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 sm:py-8"
          >
            {children}
          </motion.main>
        </div>
      </div>

      {modeLoading && <div className="sr-only">{t('analytics.loading')}</div>}
      <CommandPalette />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function NavGroup({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.to}>
          <NavLink item={item} pathname={pathname} />
        </li>
      ))}
    </ul>
  )
}

function NavLink({ item, pathname, nested = false }: { item: NavItem; pathname: string; nested?: boolean }) {
  const { t } = useI18n()
  const active = isNavActive(pathname, item)
  const Icon = item.icon

  return (
    <Link
      to={item.to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group/nav relative flex items-center gap-2.5 rounded-md text-sm outline-none',
        'transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        nested ? 'px-2 py-1.5 text-xs' : 'px-2 py-1.5',
        active
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          transition={SPRING.snappy}
          className="absolute inset-y-1.5 -left-2.5 w-0.5 rounded-full bg-primary"
          aria-hidden="true"
        />
      )}
      <Icon aria-hidden="true" className={cn('shrink-0', nested ? 'size-3.5' : 'size-4')} />
      <span className="truncate">{t(item.labelKey)}</span>
    </Link>
  )
}

/** Top-bar processing-mode indicator. Reads the shared mode seam. */
function ModeBadge() {
  const { t } = useI18n()
  const { mode, modeKnown, loading, sttUnavailable } = useMode()

  if (loading) return <Skeleton className="h-5 w-24 rounded-full" />

  const Icon = mode === 'private' ? Lock : Cloud
  // Until the settings request has succeeded we genuinely do not know which
  // mode the server is in; a confident green "Online" here would be a claim we
  // cannot back up.
  const tone = !modeKnown
    ? 'bg-surface-sunken text-muted-foreground ring-border-subtle'
    : sttUnavailable
      ? 'bg-warning-soft text-warning-soft-foreground ring-warning/25'
      : mode === 'private'
        ? 'bg-surface-sunken text-muted-foreground ring-border-subtle'
        : 'bg-success-soft text-success-soft-foreground ring-success/25'

  return (
    <span
      title={sttUnavailable ? t('mode.stt_unavailable_sidebar') : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-medium ring-1 ring-inset',
        tone
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {modeKnown
        ? mode === 'private'
          ? t('settings.mode.private')
          : t('settings.mode.online')
        : t('settings.mode.unknown')}
      {sttUnavailable && <TriangleAlert aria-hidden="true" className="size-3" />}
    </span>
  )
}

function useBreadcrumb(
  pathname: string,
  t: (k: string) => string,
  items: NavItem[],
): { label: string; to: string | undefined }[] {
  return useMemo(() => {
    // Fall back to the full nav so a user deep-linking to a route they cannot
    // see in the sidebar still gets an accurate trail.
    const pool = items.length > 0 ? [...items, ...NAV] : NAV
    const longest = (list: NavItem[]) =>
      [...list].sort((a, b) => b.to.length - a.to.length)[0]

    // 1. The nav entry for this page itself, minus the current page (a
    //    breadcrumb must not link to where you already are).
    const self = longest(pool.filter((i) => isNavActive(pathname, i) && i.to !== pathname))
    if (self) return [{ label: t(self.labelKey), to: self.exact ? undefined : self.to }]

    // 2. Otherwise a strict ancestor: `/managers/admin` is `exact`, and its
    //    parent `/managers` is `exact` too, so nothing matched and the trail
    //    used to render bare. `exact` decides nav highlighting, not ancestry.
    if (pathname !== '/') {
      const ancestor = longest(
        pool.filter((i) => i.to !== pathname && pathname.startsWith(i.to + '/'))
      )
      if (ancestor) return [{ label: t(ancestor.labelKey), to: ancestor.to }]
    }
    return []
  }, [pathname, t, items])
}

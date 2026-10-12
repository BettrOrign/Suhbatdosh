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

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const { t } = useI18n()
  const location = useLocation()
  const reduced = useReducedMotion()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [managersOpen, setManagersOpen] = useState(false)
  const { loading: modeLoading, sttUnavailable } = useMode()

  const items = visibleNav(user?.role)
  const managersGroup = items.filter((i) => isManagersPath(i.to))
  const topLevel = items.filter((i) => !isManagersPath(i.to))
  const managersActive = isManagersPath(location.pathname)

  useEffect(() => {
    setSidebarOpen(false)
    if (managersActive) setManagersOpen(true)
  }, [location.pathname, managersActive])

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

        {/* ---------------------------------------------------------------- */}
        {/* Sidebar                                                          */}
        {/* ---------------------------------------------------------------- */}
        <motion.aside
          aria-label={t('nav.sidebar')}
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
                      <div className="mt-0.5 space-y-0.5 border-l border-sidebar-border pl-2.5">
                        {managersGroup.map((item) => (
                          <NavLink key={item.to} item={item} pathname={location.pathname} nested />
                        ))}
                      </div>
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
                  ⌘K
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
  const { mode, loading, sttUnavailable } = useMode()

  if (loading) return <Skeleton className="h-5 w-24 rounded-full" />

  const Icon = mode === 'private' ? Lock : Cloud
  return (
    <span
      title={sttUnavailable ? t('mode.stt_unavailable_sidebar') : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-medium ring-1 ring-inset',
        sttUnavailable
          ? 'bg-warning-soft text-warning-soft-foreground ring-warning/25'
          : mode === 'private'
            ? 'bg-surface-sunken text-muted-foreground ring-border-subtle'
            : 'bg-success-soft text-success-soft-foreground ring-success/25'
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {mode === 'private' ? t('settings.mode.private') : t('settings.mode.online')}
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
    const best = pool
      .filter((i) => isNavActive(pathname, i) && i.to !== '/managers/admin')
      .sort((a, b) => b.to.length - a.to.length)[0]
    if (!best) return []
    return [{ label: t(best.labelKey), to: best.exact ? undefined : best.to }]
  }, [pathname, t, items])
}

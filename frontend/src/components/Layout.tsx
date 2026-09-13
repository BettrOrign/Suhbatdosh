import { Link, useLocation } from 'react-router-dom'
import { LogOut, Mic, Users, BarChart3, Menu, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/i18n/i18n'
import { LanguageToggleIcon } from '@/i18n/LanguageToggle'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { NotificationBell } from '@/components/NotificationBell'

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const { t } = useI18n()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const links: { to: string; labelKey: string; icon: typeof Mic; show: boolean }[] = [
    { to: '/', labelKey: 'nav.calls', icon: Mic, show: true },
    { to: '/clients', labelKey: 'nav.clients', icon: Users, show: true },
    { to: '/managers', labelKey: 'nav.managers', icon: BarChart3, show: user?.role === 'admin' },
    { to: '/users', labelKey: 'nav.team', icon: Users, show: user?.role === 'admin' },
  ]

  return (
    <div className="min-h-screen flex">
      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Right sidebar */}
      <motion.aside
        className={`fixed right-0 top-0 z-50 h-screen w-64 overflow-y-auto bg-background border-l shadow-xl transform transition-transform duration-300 ease-smooth ${
          sidebarOpen ? 'translate-x-0' : 'translate-x-full'
        } lg:translate-x-0 lg:left-0 lg:right-auto lg:shadow-none lg:border-r lg:border-l-0`}
      >
        <div className="flex h-full flex-col">
          {/* Logo at top of sidebar */}
          <div className="flex items-center gap-3 px-5 py-5 border-b">
            <Link to="/" onClick={() => setSidebarOpen(false)} className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded-lg">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl gradient-bg shadow-lg shadow-indigo-500/25">
                <Mic className="size-5 text-white" />
              </div>
              <div className="min-w-0">
                <span className="text-lg font-bold tracking-tight gradient-text">{t('brand.name')}</span>
                <p className="text-xs text-muted-foreground">Call Analytics</p>
              </div>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden ml-auto shrink-0"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>

          {/* Section label */}
          <div className="px-5 pt-5 pb-2">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
              Menu
            </span>
          </div>

          {/* Nav links */}
          <nav className="flex flex-1 flex-col gap-0.5 px-3">
            {links
              .filter((l) => l.show)
              .map((l) => {
                const isActive = location.pathname === l.to
                return (
                  <Link
                    key={l.to}
                    to={l.to}
                    onClick={() => setSidebarOpen(false)}
                    className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                      isActive
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400 shadow-sm'
                        : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground cursor-pointer'
                    }`}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="sidebar-pill"
                        className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-indigo-500"
                        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                      />
                    )}
                    <l.icon className="size-4 shrink-0" />
                    {t(l.labelKey)}
                  </Link>
                )
              })}
          </nav>

          {/* Bottom section */}
          <div className="border-t px-3 py-4">
            <button
              onClick={logout}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 cursor-pointer transition-all"
            >
              <LogOut className="size-4" />
              {t('nav.logout')}
            </button>
          </div>

          {/* User info at bottom */}
          {user && (
            <div className="border-t px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300 font-semibold text-sm">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{user.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0 lg:ml-64">
        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b bg-background/70 backdrop-blur-xl">
          <div className="flex h-14 items-center justify-between px-6">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden"
              >
                <Menu className="size-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2.5">
              {user && (
                <>
                  <NotificationBell />
                  <ThemeToggle />
                  <LanguageToggleIcon />
                  <Button variant="ghost" size="sm" onClick={logout} className="hover:text-destructive hover:bg-destructive/10 cursor-pointer">
                    <LogOut className="size-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-8 w-full">{children}</main>
      </div>
    </div>
  )
}

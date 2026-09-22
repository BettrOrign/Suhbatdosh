import { Link, useLocation } from 'react-router-dom'
import { LogOut, Mic, Users, BarChart3, Menu, X, LayoutDashboard, ChevronDown } from 'lucide-react'
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
  const [managersOpen, setManagersOpen] = useState(false)

  const links: { to: string; labelKey: string; icon: any; show: boolean }[] = [
    { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, show: true },
    { to: '/calls', labelKey: 'nav.calls', icon: Mic, show: true },
    { to: '/clients', labelKey: 'nav.clients', icon: Users, show: true },
    { to: '/users', labelKey: 'nav.team', icon: Users, show: user?.role === 'admin' },
  ]

  const subItems = [
    { label: t('nav.submenu.admin'), to: '/managers/admin' },
    { label: t('nav.submenu.managers'), to: '/managers' },
    { label: t('nav.submenu.directions'), to: '/managers/directions' },
  ]

  return (
    <div className="min-h-screen flex">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <motion.aside
        className={`fixed left-0 top-0 z-50 h-screen w-64 overflow-y-auto bg-card border-r border-border/70 shadow-lg transform transition-transform duration-300 ease-smooth ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 lg:shadow-none`}
      >
        <div className="flex h-full flex-col">
          {/* Logo at top of sidebar */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border/60">
            <Link to="/" onClick={() => setSidebarOpen(false)} className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer focus:outline-none rounded-xl">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-700 text-white shadow-sm">
                <Mic className="size-4 text-white" />
              </div>
              <div className="min-w-0">
                <span className="text-base font-bold tracking-tight text-foreground">{t('brand.name')}</span>
                <p className="text-[11px] font-medium text-muted-foreground">Call Analytics AI</p>
              </div>
            </Link>
            <Button variant="ghost" size="icon" className="lg:hidden ml-auto shrink-0 size-8" onClick={() => setSidebarOpen(false)}>
              <X className="size-4" />
            </Button>
          </div>

          {/* Section label */}
          <div className="px-5 pt-5 pb-2">
            <span className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-widest">
              Navigation
            </span>
          </div>

          {/* Nav links */}
          <nav className="flex flex-1 flex-col gap-1 px-3">
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
                          ? 'bg-primary/10 text-primary font-semibold shadow-xs'
                          : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground cursor-pointer'
                      }`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="sidebar-pill"
                          className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary"
                          transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                        />
                      )}
                      <l.icon className={`size-4 shrink-0 transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`} />
                      {t(l.labelKey)}
                    </Link>
                  )
                })}

            {/* Managers dropdown */}
            {(user?.role === 'admin' || user?.role === 'yonalish') && (
              <div>
                <button
                  onClick={() => setManagersOpen(!managersOpen)}
                  className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                    location.pathname === '/managers' || location.pathname.startsWith('/managers/')
                      ? 'bg-primary/10 text-primary font-semibold shadow-xs'
                      : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground cursor-pointer'
                  }`}
                >
                  {location.pathname === '/managers' || location.pathname.startsWith('/managers/') ? (
                    <motion.div
                      layoutId="sidebar-pill"
                      className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    />
                  ) : null}
                  <BarChart3 className="size-4 shrink-0" />
                  {t('nav.managers')}
                  <ChevronDown className={`ml-auto size-4 transition-transform duration-200 ${managersOpen ? 'rotate-180' : ''}`} />
                </button>
                  <AnimatePresence>
                    {managersOpen && (
                      <motion.div
                        initial={{ opacity: 0, maxHeight: 0 }}
                        animate={{ opacity: 1, maxHeight: 300 }}
                        exit={{ opacity: 0, maxHeight: 0 }}
                        transition={{ duration: 0.2 }}
                        style={{ overflow: 'hidden' }}
                        className="flex flex-col gap-0.5 pl-8 pr-2 py-1"
                      >
                        {subItems.map((item) => {
                          const isActive = location.pathname === item.to
                          return (
                            <Link
                              key={item.to}
                              to={item.to}
                              onClick={() => setSidebarOpen(false)}
                              className={`rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                                isActive
                                  ? 'bg-primary/10 text-primary font-semibold'
                                  : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground cursor-pointer'
                              }`}
                            >
                              {item.label}
                            </Link>
                          )
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
              </div>
            )}
          </nav>

          {/* User info at bottom */}
          {user && (
            <div className="border-t border-border/60 p-3">
              <div className="flex items-center gap-3 rounded-xl p-2 bg-muted/40 border border-border/50">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary font-bold text-sm">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground truncate">{user.name}</p>
                  <p className="text-[11px] text-muted-foreground capitalize">{user.role}</p>
                </div>
                <button
                  onClick={logout}
                  title={t('nav.logout')}
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <LogOut className="size-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0 lg:ml-64">
        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-xl">
          <div className="flex h-14 items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)} className="lg:hidden size-8">
                <Menu className="size-4" />
              </Button>
              <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">ViaCall</span>
                <span>/</span>
                <span className="capitalize">
                  {location.pathname === '/' ? t('nav.dashboard') :
                   location.pathname.startsWith('/calls') ? t('nav.calls') :
                   location.pathname.startsWith('/clients') ? t('nav.clients') :
                   location.pathname.startsWith('/managers') ? t('nav.managers') :
                   location.pathname.startsWith('/users') ? t('nav.team') : ''}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden md:flex items-center gap-1.5 mr-2 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium border border-emerald-500/20">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Online</span>
              </div>
              {user && (
                <>
                  <NotificationBell />
                  <ThemeToggle />
                  <LanguageToggleIcon />
                </>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8 w-full">{children}</main>
      </div>
    </div>
  )
}

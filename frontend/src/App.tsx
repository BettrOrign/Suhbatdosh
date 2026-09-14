import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { AnimatePresence, motion } from 'framer-motion'
import { BrowserRouter, Route, Routes, useLocation, Navigate } from 'react-router-dom'
import { ThemeProvider } from 'next-themes'
import { I18nProvider } from '@/i18n/i18n'
import { AuthProvider, useAuth } from '@/lib/auth'
import { Layout } from '@/components/Layout'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Analytics } from '@/pages/Analytics'
import { Calls } from '@/pages/Calls'
import { CallDetail } from '@/pages/CallDetail'
import { Clients } from '@/pages/Clients'
import { ManagersPage } from '@/pages/Managers'
import { UsersPage } from '@/pages/Users'
import { Login } from '@/pages/Login'

function AnimatedRoutes() {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <Layout>
            <ErrorBoundary>
              <Routes location={location}>
                <Route path="/" element={<Analytics />} />
                <Route path="/calls" element={<Calls />} />
                <Route path="/calls/:id" element={<CallDetail />} />
                <Route path="/clients" element={<Clients />} />
                <Route path="/managers" element={<ManagersPage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ErrorBoundary>
        </Layout>
      </motion.div>
    </AnimatePresence>
  )
}

function Shell() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }
  if (!user) return <Login />
  return <AnimatedRoutes />
}

export default function App() {
  return (
    <TooltipProvider>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        <AuthProvider>
          <BrowserRouter>
            <I18nProvider>
              <Shell />
            </I18nProvider>
          </BrowserRouter>
        </AuthProvider>
        <Toaster position="top-right" />
      </ThemeProvider>
    </TooltipProvider>
  )
}
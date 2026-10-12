import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from 'next-themes'

import { Analytics } from '@/pages/Analytics'
import { CallDetail } from '@/pages/CallDetail'
import { Calls } from '@/pages/Calls'
import { Clients } from '@/pages/Clients'
import { Login } from '@/pages/Login'
import { ManagersAdminPage } from '@/pages/ManagersAdmin'
import { ManagersDirectionsPage } from '@/pages/ManagersDirections'
import { ManagersPage } from '@/pages/ManagersList'
import { SettingsPage } from '@/pages/Settings'
import { UsersPage } from '@/pages/Users'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Layout } from '@/components/Layout'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider, useI18n } from '@/i18n/i18n'
import { AuthProvider, useAuth } from '@/lib/auth'
import { ModeProvider } from '@/lib/mode'

function BootSkeleton() {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-background"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3">
        <Skeleton className="h-8 w-32 rounded-md" />
        <Skeleton className="h-3 w-48 rounded" />
      </div>
    </div>
  )
}

function AuthedShell() {
  const { user, loading } = useAuth()
  const { lang } = useI18n()

  if (loading) return <BootSkeleton />
  if (!user) return <Login />

  return (
    <ModeProvider>
      <Layout>
        <ErrorBoundary lang={lang}>
          <Routes>
            <Route path="/" element={<Analytics />} />
            <Route path="/calls" element={<Calls />} />
            <Route path="/calls/:id" element={<CallDetail />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/managers" element={<ManagersPage />} />
            <Route path="/managers/admin" element={<ManagersAdminPage />} />
            <Route path="/managers/directions" element={<ManagersDirectionsPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
      </Layout>
    </ModeProvider>
  )
}

export default function App() {
  return (
    <TooltipProvider delayDuration={200}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <BrowserRouter>
          <I18nProvider>
            <AuthProvider>
              <AuthedShell />
            </AuthProvider>
          </I18nProvider>
        </BrowserRouter>
        <Toaster position="bottom-right" closeButton richColors={false} />
      </ThemeProvider>
    </TooltipProvider>
  )
}

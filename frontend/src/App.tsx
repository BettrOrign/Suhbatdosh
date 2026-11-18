import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from 'next-themes'

import { AcceptInvite } from '@/pages/AcceptInvite'
import { Analytics } from '@/pages/Analytics'
import { CallDetail } from '@/pages/CallDetail'
import { Calls } from '@/pages/Calls'
import { Clients } from '@/pages/Clients'
import { EscalationsPage } from '@/pages/Escalations'
import { Login } from '@/pages/Login'
import { ManagersAdminPage } from '@/pages/ManagersAdmin'
import { ManagersDirectionsPage } from '@/pages/ManagersDirections'
import { ManagersPage } from '@/pages/ManagersList'
import { MyTasks } from '@/pages/MyTasks'
import { Profile } from '@/pages/Profile'
import { RubricsPage } from '@/pages/Rubrics'
import { SettingsPage } from '@/pages/Settings'
import { Signup } from '@/pages/Signup'
import TelegramPage from '@/pages/Telegram'
import { UsersPage } from '@/pages/Users'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Layout } from '@/components/Layout'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider, useI18n } from '@/i18n/i18n'
import { AuthProvider, useAuth } from '@/lib/auth'
import { ModeProvider } from '@/lib/mode'
import type { User } from '@/lib/types'

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

function RoleGuard({
  roles,
  children,
}: {
  roles: User['role'][]
  children: React.ReactNode
}) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

function AuthedShell() {
  const { user, loading } = useAuth()
  const { lang } = useI18n()

  if (loading) return <BootSkeleton />
  if (!user) {
    return (
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="/invite/:token" element={<AcceptInvite />} />
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }

  return (
    <ModeProvider>
      <Layout>
        <ErrorBoundary lang={lang}>
          <Routes>
            <Route path="/" element={<Analytics />} />
            <Route path="/my-day" element={<Navigate to="/" replace />} />
            <Route path="/tasks" element={<MyTasks />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/calls" element={<Calls />} />
            <Route path="/calls/:id" element={<CallDetail />} />
            <Route path="/clients" element={<Clients />} />
            <Route
              path="/managers"
              element={
                <RoleGuard roles={['admin', 'yonalish']}>
                  <ManagersPage />
                </RoleGuard>
              }
            />
            <Route
              path="/managers/admin"
              element={
                <RoleGuard roles={['admin']}>
                  <ManagersAdminPage />
                </RoleGuard>
              }
            />
            <Route
              path="/managers/directions"
              element={
                <RoleGuard roles={['admin', 'yonalish']}>
                  <ManagersDirectionsPage />
                </RoleGuard>
              }
            />
            <Route
              path="/escalations"
              element={
                <RoleGuard roles={['admin', 'yonalish']}>
                  <EscalationsPage />
                </RoleGuard>
              }
            />
            <Route
              path="/rubrics"
              element={
                <RoleGuard roles={['admin', 'yonalish']}>
                  <RubricsPage />
                </RoleGuard>
              }
            />
            <Route
              path="/users"
              element={
                <RoleGuard roles={['admin']}>
                  <UsersPage />
                </RoleGuard>
              }
            />
            <Route
              path="/settings"
              element={
                <RoleGuard roles={['admin']}>
                  <SettingsPage />
                </RoleGuard>
              }
            />
            <Route
              path="/telegram"
              element={
                <RoleGuard roles={['admin', 'receptionist', 'yonalish']}>
                  <TelegramPage />
                </RoleGuard>
              }
            />
            <Route path="/invite/:token" element={<AcceptInvite />} />
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

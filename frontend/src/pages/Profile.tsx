import { useCallback, useEffect, useState } from 'react'
import {
  Building2,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  Loader2,
  LogOut,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/EmptyState'
import { TokenControl } from '@/components/TokenControl'
import { roleBadgeVariant } from '@/components/people/PersonDialog'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDate } from '@/lib/format'
import { useI18n } from '@/i18n/i18n'
import type { UserSession } from '@/lib/types'

export function Profile() {
  const { user, refreshUser } = useAuth()
  const { t } = useI18n()

  const [name, setName] = useState(user?.name ?? '')
  const [savingProfile, setSavingProfile] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')

  const [sessions, setSessions] = useState<UserSession[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [revokingAll, setRevokingAll] = useState(false)

  useEffect(() => {
    if (user?.name) setName(user.name)
  }, [user?.name])

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await api.listSessions())
    } catch {
      /* ignore */
    } finally {
      setLoadingSessions(false)
    }
  }, [])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || savingProfile) return
    setSavingProfile(true)
    try {
      await api.updateProfile({ name: name.trim() })
      await refreshUser()
      toast.success(t('profile.saved'))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSavingProfile(false)
    }
  }

  const updatePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentPassword || !newPassword || savingPassword) return
    setPasswordError('')
    setSavingPassword(true)
    try {
      await api.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      })
      setCurrentPassword('')
      setNewPassword('')
      toast.success(t('profile.password_changed'))
      void loadSessions()
    } catch (err) {
      const msg = (err as Error).message
      setPasswordError(msg)
      toast.error(msg)
    } finally {
      setSavingPassword(false)
    }
  }

  const revokeSession = async (sessionId: number) => {
    try {
      await api.revokeSession(sessionId)
      toast.success(t('profile.session_revoked'))
      await loadSessions()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const logoutOtherDevices = async () => {
    if (revokingAll) return
    setRevokingAll(true)
    try {
      await api.logoutAllSessions()
      toast.success(t('profile.logged_out_all'))
      await loadSessions()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setRevokingAll(false)
    }
  }

  if (!user) return null

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <PageHeader
        eyebrow={t('profile.eyebrow')}
        title={t('profile.title')}
        description={t('profile.desc')}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Personal Info */}
        <section className="rounded-xl border border-border bg-surface p-5 shadow-e1">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UserRound className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">{t('profile.section_info')}</h2>
              <p className="text-xs text-muted-foreground">{t('profile.section_info_desc')}</p>
            </div>
          </div>

          <form className="mt-5 space-y-4" onSubmit={saveProfile}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border-subtle bg-surface-sunken px-3 py-2">
                <p className="text-2xs font-medium text-muted-foreground">{t('profile.org')}</p>
                <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                  <Building2 className="size-3.5 text-primary" />
                  <span className="truncate">{user.org_name ?? 'MBSI'}</span>
                </div>
              </div>
              <div className="rounded-lg border border-border-subtle bg-surface-sunken px-3 py-2">
                <p className="text-2xs font-medium text-muted-foreground">{t('profile.role')}</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant={roleBadgeVariant(user.role)}>{t(`nav.role.${user.role}`)}</Badge>
                  {user.sip_extension && (
                    <Badge variant="outline" className="font-mono text-2xs">
                      SIP {user.sip_extension}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-name">{t('users.name')}</Label>
              <Input
                id="profile-name"
                name="name"
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-email">{t('users.email')}</Label>
              <Input
                id="profile-email"
                type="email"
                value={user.email}
                readOnly
                disabled
                className="bg-surface-sunken"
              />
            </div>

            <Button
              type="submit"
              size="sm"
              disabled={savingProfile || !name.trim() || name.trim() === user.name}
            >
              {savingProfile && <Loader2 className="size-3.5 animate-spin" />}
              {t('profile.save_profile')}
            </Button>
          </form>
        </section>

        {/* Change Password */}
        <section className="rounded-xl border border-border bg-surface p-5 shadow-e1">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">{t('profile.section_password')}</h2>
              <p className="text-xs text-muted-foreground">{t('profile.section_password_desc')}</p>
            </div>
          </div>

          <form
            className="mt-5 space-y-4"
            onSubmit={updatePassword}
            aria-describedby={passwordError ? 'password-error' : undefined}
          >
            <div className="space-y-1.5">
              <Label htmlFor="current-password">{t('profile.current_password')}</Label>
              <Input
                id="current-password"
                name="current-password"
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={t('app.password_placeholder')}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-password">{t('profile.new_password')}</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  name="new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  minLength={10}
                  autoComplete="new-password"
                  aria-describedby="profile-password-hint"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('app.password_placeholder')}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((prev) => !prev)}
                  aria-label={showNewPassword ? t('auth.hide_password') : t('auth.show_password')}
                  aria-pressed={showNewPassword}
                  className="absolute top-1/2 right-2.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                >
                  {showNewPassword ? (
                    <EyeOff aria-hidden="true" className="size-4" />
                  ) : (
                    <Eye aria-hidden="true" className="size-4" />
                  )}
                </button>
              </div>
              <p id="profile-password-hint" className="text-2xs text-muted-foreground">
                {t('auth.password_hint')}
              </p>
            </div>

            {passwordError && (
              <p id="password-error" role="alert" className="text-xs text-destructive">
                {passwordError}
              </p>
            )}

            <Button
              type="submit"
              size="sm"
              disabled={savingPassword || !currentPassword || newPassword.length < 10}
            >
              {savingPassword && <Loader2 className="size-3.5 animate-spin" />}
              {savingPassword ? t('profile.updating_password') : t('profile.update_password')}
            </Button>
          </form>
        </section>
      </div>

      {/* Upload Key */}
      <section className="group/row rounded-xl border border-border bg-surface p-5 shadow-e1">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <KeyRound className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">{t('token.own_title')}</h2>
              <p className="text-xs text-muted-foreground">{t('token.own_desc')}</p>
            </div>
          </div>
          <div className="w-full sm:w-80">
            <TokenControl
              token={user.api_token ?? null}
              onRegenerate={async () => {
                const { api_token } = await api.regenerateToken()
                await refreshUser()
                return api_token
              }}
            />
          </div>
        </div>
      </section>

      {/* Active Sessions */}
      <section className="rounded-xl border border-border bg-surface p-5 shadow-e1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Laptop className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">{t('profile.section_sessions')}</h2>
              <p className="text-xs text-muted-foreground">{t('profile.section_sessions_desc')}</p>
            </div>
          </div>
          {sessions.length > 1 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={revokingAll}
              onClick={() => void logoutOtherDevices()}
            >
              <LogOut className="size-3.5" />
              {t('profile.logout_all')}
            </Button>
          )}
        </div>

        <div className="mt-4 divide-y divide-border-subtle rounded-lg border border-border-subtle">
          {loadingSessions ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">—</p>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">
                    {s.user_agent || 'Browser / API Session'}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-3 text-2xs text-muted-foreground">
                    {s.ip && <span>{t('profile.session_ip', { ip: s.ip })}</span>}
                    <span>{t('profile.session_last_seen', { date: formatDate(s.last_seen_at) })}</span>
                  </div>
                </div>
                {sessions.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void revokeSession(s.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                    {t('profile.revoke_session')}
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}

export default Profile

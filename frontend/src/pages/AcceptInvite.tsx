import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, Loader2, Mic, ShieldAlert, UserCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LanguageToggleIcon } from '@/i18n/LanguageToggle'
import { ThemeToggle } from '@/components/ThemeToggle'
import { roleBadgeVariant } from '@/components/people/PersonDialog'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/i18n/i18n'
import type { InviteInfo } from '@/lib/types'

export function AcceptInvite() {
  const { token } = useParams<{ token: string }>()
  const { acceptInvite } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()

  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) {
      setLoadError(true)
      setLoading(false)
      return
    }
    api
      .getInviteInfo(token)
      .then(setInfo)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [token])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || busy) return
    setError('')
    setBusy(true)
    try {
      await acceptInvite(token, { name: name.trim(), password })
      if (info) {
        toast.success(t('invite.welcome', { org: info.org_name }))
      }
      navigate('/', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center bg-background px-5 py-12">
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1">
        <ThemeToggle />
        <LanguageToggleIcon />
      </div>

      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="brand-mark size-9">
            <Mic aria-hidden="true" className="size-4" />
          </span>
          <span className="text-base font-semibold tracking-[-0.02em]">{t('brand.name')}</span>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-e2 sm:p-8">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Loader2 className="size-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">{t('invite.loading')}</p>
            </div>
          ) : loadError || !info ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="flex size-10 items-center justify-center rounded-lg bg-destructive-soft text-destructive">
                <ShieldAlert className="size-5" />
              </div>
              <h1 className="text-lg font-semibold">{t('invite.invalid_title')}</h1>
              <p className="text-xs text-muted-foreground">{t('invite.invalid_desc')}</p>
              <Button asChild variant="outline" size="sm" className="mt-2">
                <Link to="/login">{t('auth.sign_in_link')}</Link>
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-primary">
                  <UserCheck aria-hidden="true" className="size-4" />
                  <span className="font-mono text-2xs font-semibold uppercase">{info.org_name}</span>
                </div>
                <Badge variant={roleBadgeVariant(info.role)}>{t(`nav.role.${info.role}`)}</Badge>
              </div>

              <h1 className="mt-3 text-xl font-semibold tracking-[-0.025em]">
                {t('invite.title', { org: info.org_name })}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {t('invite.desc', { role: t(`nav.role.${info.role}`) })}
              </p>

              <form
                className="mt-6 space-y-4"
                onSubmit={submit}
                aria-describedby={error ? 'invite-error' : undefined}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="invite-email">{t('app.email')}</Label>
                  <Input
                    id="invite-email"
                    name="email"
                    type="email"
                    value={info.email}
                    readOnly
                    disabled
                    autoComplete="username"
                    className="h-10 bg-surface-sunken"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="invite-name">{t('signup.your_name')}</Label>
                  <Input
                    id="invite-name"
                    name="name"
                    type="text"
                    required
                    autoFocus
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('signup.name_placeholder')}
                    className="h-10"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="invite-password">{t('app.password')}</Label>
                  <div className="relative">
                    <Input
                      id="invite-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={10}
                      autoComplete="new-password"
                      aria-describedby="invite-password-hint"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('app.password_placeholder')}
                      className="h-10 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? t('auth.hide_password') : t('auth.show_password')}
                      aria-pressed={showPassword}
                      className="absolute top-1/2 right-2.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                    >
                      {showPassword ? (
                        <EyeOff aria-hidden="true" className="size-4" />
                      ) : (
                        <Eye aria-hidden="true" className="size-4" />
                      )}
                    </button>
                  </div>
                  <p id="invite-password-hint" className="text-2xs text-muted-foreground">
                    {t('auth.password_hint')}
                  </p>
                </div>

                {error && (
                  <p id="invite-error" role="alert" className="text-xs text-destructive">
                    {error}
                  </p>
                )}

                <Button type="submit" size="lg" disabled={busy} className="w-full">
                  {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                  {busy ? t('invite.accepting') : t('invite.accept_btn')}
                  {!busy && <ArrowRight aria-hidden="true" className="size-4" />}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default AcceptInvite

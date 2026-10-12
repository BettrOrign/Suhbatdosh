import { useState } from 'react'
import { Mic, Loader2 } from 'lucide-react'
import { motion } from 'framer-motion'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LanguageToggleIcon } from '@/i18n/LanguageToggle'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/i18n/i18n'
import { SPRING } from '@/lib/motion'

/**
 * The sign-in screen used to hardcode a dark slate palette that ignored the
 * theme system entirely, so it flashed white-then-dark on load. It now uses
 * the same surface tokens as the rest of the app and respects the theme.
 */
export function Login() {
  const { login } = useAuth()
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(email, password)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[-20%] left-1/2 size-[520px] -translate-x-1/2 rounded-full bg-primary/8 blur-[100px]"
      />

      <div className="absolute top-4 right-4 z-10">
        <LanguageToggleIcon />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING.standard}
        className="relative z-10 w-full max-w-sm"
      >
        <div className="mb-6 flex flex-col items-center gap-2.5 text-center">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-e2">
            <Mic aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-[-0.02em]">{t('brand.name')}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('brand.tagline')}</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('app.sign_in')}</CardTitle>
            <CardDescription>{t('app.sign_in_desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={submit}
              aria-describedby={error ? 'login-error' : undefined}
            >
              <div className="space-y-1.5">
                <Label htmlFor="email">{t('app.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('app.email_placeholder')}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">{t('app.password')}</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('app.password_placeholder')}
                  className="h-9"
                />
              </div>

              {error && (
                <p id="login-error" role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" disabled={busy} className="w-full">
                {busy ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : null}
                {busy ? t('app.signing_in') : t('app.sign_in')}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">{t('app.contact_admin')}</p>
      </motion.div>
    </div>
  )
}

export default Login

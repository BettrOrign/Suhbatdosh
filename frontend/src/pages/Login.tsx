import { useState } from 'react'
import { ArrowRight, Check, Loader2, Mic, Sparkles } from 'lucide-react'
import { motion } from 'framer-motion'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LanguageToggleIcon } from '@/i18n/LanguageToggle'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/i18n/i18n'
import { SPRING } from '@/lib/motion'

/**
 * Split sign-in screen: the brand story on the left, the form on the right.
 * Same tokens as the app — no hardcoded palette, no theme flash.
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
    <div className="relative min-h-dvh bg-background">
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1">
        <ThemeToggle />
        <LanguageToggleIcon />
      </div>

      <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
        {/* Brand story */}
        <div className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-14 xl:p-16">
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{ background: 'var(--accent-gradient)' }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-60"
            style={{
              background:
                'radial-gradient(680px 380px at 18% 4%, rgb(255 255 255 / 0.28), transparent 62%), radial-gradient(520px 320px at 92% 92%, rgb(52 214 226 / 0.45), transparent 60%)',
            }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-[0.16]"
            style={{
              backgroundImage:
                'linear-gradient(rgb(255 255 255 / 0.5) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.5) 1px, transparent 1px)',
              backgroundSize: '56px 56px',
              maskImage: 'radial-gradient(70% 60% at 30% 30%, black, transparent)',
            }}
          />

          <div className="relative flex items-center gap-3 text-white">
            <span className="flex size-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30 backdrop-blur">
              <Mic aria-hidden="true" className="size-5" />
            </span>
            <span className="text-lg font-semibold tracking-[-0.02em]">{t('brand.name')}</span>
          </div>

          <div className="relative max-w-xl text-white">
            <p className="font-mono text-2xs font-medium tracking-[0.18em] uppercase text-white/80">
              {t('login.hero_eyebrow')}
            </p>
            <h1 className="mt-5 text-[2.75rem] leading-[1.06] font-semibold tracking-[-0.04em] xl:text-[3.25rem]">
              {t('login.hero_title')}
            </h1>
            <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-white/85">
              {t('login.hero_sub')}
            </p>

            <ul className="mt-9 space-y-3.5">
              {['login.feature_1', 'login.feature_2', 'login.feature_3'].map((key) => (
                <li key={key} className="flex items-start gap-3 text-sm text-white/90">
                  <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/30">
                    <Check aria-hidden="true" className="size-3" />
                  </span>
                  {t(key)}
                </li>
              ))}
            </ul>
          </div>

          <p className="relative text-2xs text-white/65">
            © {new Date().getFullYear()} {t('brand.name')} · suhbatdosh.uz
          </p>
        </div>

        {/* Form */}
        <div className="relative flex items-center justify-center px-5 py-14 sm:px-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 lg:hidden"
            style={{
              background:
                'radial-gradient(620px 340px at 50% -6%, color-mix(in srgb, var(--accent-200) 55%, transparent), transparent 62%)',
            }}
          />

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING.soft}
            className="relative z-10 w-full max-w-[400px]"
          >
            <div className="mb-8 flex flex-col items-start gap-4 lg:hidden">
              <span className="brand-mark size-11">
                <Mic aria-hidden="true" className="size-5" />
              </span>
              <div>
                <p className="eyebrow">{t('login.hero_eyebrow')}</p>
                <h1 className="mt-2.5 text-2xl font-semibold tracking-[-0.03em]">
                  {t('brand.name')}
                </h1>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-surface p-6 shadow-e2 sm:p-8">
              <h2 className="text-xl font-semibold tracking-[-0.025em]">{t('app.sign_in')}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{t('app.sign_in_desc')}</p>

              <form
                className="mt-7 space-y-4"
                onSubmit={submit}
                aria-describedby={error ? 'login-error' : undefined}
              >
                <div className="space-y-2">
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
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">{t('app.password')}</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('app.password_placeholder')}
                    className="h-11"
                  />
                </div>

                {error && (
                  <p id="login-error" role="alert" className="text-xs text-destructive">
                    {error}
                  </p>
                )}

                <Button type="submit" size="lg" disabled={busy} className="w-full">
                  {busy ? (
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <Sparkles aria-hidden="true" className="size-4" />
                  )}
                  {busy ? t('app.signing_in') : t('app.sign_in')}
                  {!busy && <ArrowRight aria-hidden="true" className="size-4" />}
                </Button>
              </form>
            </div>

            <p className="mt-5 text-center text-xs text-muted-foreground">{t('app.contact_admin')}</p>
          </motion.div>
        </div>
      </div>
    </div>
  )
}

export default Login

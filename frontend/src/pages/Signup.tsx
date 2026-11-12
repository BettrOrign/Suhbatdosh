import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Building2, Check, Eye, EyeOff, Loader2, Mic } from 'lucide-react'
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
 * Self-serve multi-tenant company registration.
 * Creates an isolated organization workspace + the first Admin account.
 * Follows modern-web-guidance autofill-sign-up-form & forms best practices.
 */
export function Signup() {
  const { signup } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()

  const [orgName, setOrgName] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      await signup({
        org_name: orgName.trim(),
        name: name.trim(),
        email: email.trim(),
        password,
      })
      navigate('/', { replace: true })
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
            <h1 className="mt-5 text-[2.5rem] leading-[1.08] font-semibold tracking-[-0.04em] xl:text-[3rem]">
              {t('signup.title')}
            </h1>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-white/85">
              {t('signup.desc')}
            </p>

            <ul className="mt-8 space-y-3.5">
              {['signup.benefit_1', 'signup.benefit_2', 'signup.benefit_3'].map((key) => (
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
        <div className="relative flex items-center justify-center px-5 py-12 sm:px-8">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING.soft}
            className="relative z-10 w-full max-w-[420px]"
          >
            <div className="rounded-2xl border border-border bg-surface p-6 shadow-e2 sm:p-8">
              <div className="flex items-center gap-2.5 text-primary">
                <Building2 aria-hidden="true" className="size-5" />
                <span className="font-mono text-2xs font-semibold tracking-wider uppercase">
                  {t('brand.name')} SaaS
                </span>
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em]">{t('signup.title')}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{t('signup.desc')}</p>

              <form
                className="mt-6 space-y-4"
                onSubmit={submit}
                aria-describedby={error ? 'signup-error' : undefined}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="org_name">{t('signup.org_name')}</Label>
                  <Input
                    id="org_name"
                    name="organization"
                    type="text"
                    required
                    autoFocus
                    autoComplete="organization"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder={t('signup.org_placeholder')}
                    className="h-10"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="name">{t('signup.your_name')}</Label>
                  <Input
                    id="name"
                    name="name"
                    type="text"
                    required
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('signup.name_placeholder')}
                    className="h-10"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="signup-email">{t('signup.work_email')}</Label>
                  <Input
                    id="signup-email"
                    name="email"
                    type="email"
                    required
                    spellCheck={false}
                    autoCapitalize="none"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('app.email_placeholder')}
                    className="h-10"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="signup-password">{t('app.password')}</Label>
                  <div className="relative">
                    <Input
                      id="signup-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={10}
                      autoComplete="new-password"
                      aria-describedby="signup-password-hint"
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
                  <p id="signup-password-hint" className="text-2xs text-muted-foreground">
                    {t('auth.password_hint')}
                  </p>
                </div>

                {error && (
                  <p id="signup-error" role="alert" className="text-xs text-destructive">
                    {error}
                  </p>
                )}

                <Button type="submit" size="lg" disabled={busy} className="w-full">
                  {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                  {busy ? t('signup.creating') : t('signup.create_btn')}
                  {!busy && <ArrowRight aria-hidden="true" className="size-4" />}
                </Button>
              </form>
            </div>

            <div className="mt-5 text-center text-xs text-muted-foreground">
              {t('auth.have_account')}{' '}
              <Link to="/login" className="font-semibold text-primary hover:underline">
                {t('auth.sign_in_link')}
              </Link>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}

export default Signup

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Mic } from 'lucide-react'
import { motion } from 'framer-motion'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function Login() {
  const { login } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
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
      navigate('/')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative min-h-dvh flex items-center justify-center bg-[#090d16] px-4 overflow-hidden">
      {/* Ambient background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 size-[600px] rounded-full bg-primary/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 size-96 rounded-full bg-violet-600/10 blur-[100px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-sm relative z-10"
      >
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-700 shadow-xl shadow-indigo-500/30 ring-1 ring-white/20">
            <Mic className="size-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">{t('brand.name')}</h1>
            <p className="text-xs text-slate-400 mt-1">{t('brand.tagline')}</p>
          </div>
        </div>

        <Card className="border border-white/10 bg-slate-900/60 backdrop-blur-2xl shadow-2xl rounded-2xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-white text-lg font-bold">{t('app.sign_in')}</CardTitle>
            <CardDescription className="text-slate-400 text-xs">{t('app.sign_in_desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs text-slate-300">{t('app.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('app.email_placeholder')}
                  className="bg-white/5 border-white/15 text-white placeholder:text-slate-500 focus-visible:ring-primary focus-visible:border-primary rounded-xl h-10 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs text-slate-300">{t('app.password')}</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('app.password_placeholder')}
                  className="bg-white/5 border-white/15 text-white placeholder:text-slate-500 focus-visible:ring-primary focus-visible:border-primary rounded-xl h-10 text-sm"
                />
              </div>
              {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
              <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl h-10 shadow-sm transition-all" disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : t('app.sign_in')}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-slate-500">{t('app.contact_admin')}</p>
      </motion.div>
    </div>
  )
}

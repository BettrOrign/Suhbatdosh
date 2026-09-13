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
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-indigo-950 via-purple-950 to-pink-950 px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-sm"
      >
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-xl gradient-bg shadow-xl shadow-indigo-500/30">
            <Mic className="size-6 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">{t('brand.name')}</h1>
          <p className="text-sm text-white/60">{t('brand.tagline')}</p>
        </div>
        <Card className="border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
          <CardHeader>
            <CardTitle className="text-white">{t('app.sign_in')}</CardTitle>
            <CardDescription className="text-white/60">{t('app.sign_in_desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-white/80">{t('app.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('app.email_placeholder')}
                  className="bg-white/5 border-white/20 text-white placeholder:text-white/40 focus-visible:ring-indigo-500 focus-visible:border-indigo-500"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-white/80">{t('app.password')}</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('app.password_placeholder')}
                  className="bg-white/5 border-white/20 text-white placeholder:text-white/40 focus-visible:ring-indigo-500 focus-visible:border-indigo-500"
                />
              </div>
              {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
              <Button type="submit" className="w-full gradient-bg" disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : t('app.sign_in')}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-white/40">{t('app.contact_admin')}</p>
      </motion.div>
    </div>
  )
}

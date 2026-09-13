import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { motion, useReducedMotion } from 'framer-motion'
import {
  KeyRound,
  Plus,
  ShieldAlert,
  Trash2,
  UserRound,
  Clock,
  BarChart3,
  ExternalLink,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Stagger, fadeUp } from '@/lib/motion'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/i18n/i18n'
import { api } from '@/lib/api'
import { TokenControl } from '@/components/TokenControl'
import type { Call, Manager } from '@/lib/types'
import { formatDate, formatDuration, scoreColor, scoreLabel, statusVariant } from '@/lib/format'
import type { CallStatus } from '@/lib/types'

function pct(n: number | null): string {
  if (n == null) return '—'
  return `${Math.round(n * 100)}%`
}

function StatMini({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof BarChart3
  label: string
  value: string | number
}) {
  return (
    <Card className="h-full">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-3.5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-xl font-bold leading-tight tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function AddManagerDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const { t } = useI18n()

  const canSave = name.trim().length > 0 && email.trim().length > 0 && password.length > 0 && !saving

  const submit = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await api.createUser({ name: name.trim(), email: email.trim(), password, role: 'manager' })
      toast.success(t('managers.added'))
      onSaved()
      onClose()
    } catch (e) {
      toast.error(t('managers.add_failed', { error: (e as Error).message }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('managers.add')}</DialogTitle>
          <DialogDescription>{t('managers.add_desc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="mgr-name">{t('users.name')}</Label>
            <Input id="mgr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('users.name_placeholder')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mgr-email">{t('users.email')}</Label>
            <Input
              id="mgr-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('users.email_placeholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mgr-password">{t('users.password')}</Label>
            <Input
              id="mgr-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('app.password_placeholder')}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!canSave}>
            {saving ? t('managers.adding') : t('managers.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ManagerCard({
  mgr,
  onEdit,
  onDelete,
  onSelect,
  onChanged,
  selected,
}: {
  mgr: Manager
  selected: boolean
  onEdit: (m: Manager) => void
  onDelete: (m: Manager) => void
  onSelect: (m: Manager) => void
  onChanged: () => void
}) {
  const { t } = useI18n()
  return (
    <motion.div variants={fadeUp}>
      <Card className="h-full transition-all duration-200 ease-smooth hover:-translate-y-0.5 hover:shadow-lg hover:shadow-foreground/5">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <UserRound className="size-4" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base">{mgr.name}</CardTitle>
                <CardDescription className="mt-0.5 truncate text-xs">{mgr.email}</CardDescription>
              </div>
            </div>
            <Badge variant={mgr.active ? 'default' : 'secondary'} className="capitalize">
              {mgr.active ? t('users.active') : t('users.inactive')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <BarChart3 className="size-3.5 shrink-0" />
                <span className="truncate">{t('managers.calls_label')}</span>
              </p>
              <p className="mt-1 text-xl font-bold leading-tight tabular-nums">{mgr.total_calls}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Clock className="size-3.5 shrink-0" />
                <span className="truncate">{t('managers.avg_talk')}</span>
              </p>
              <p className="mt-1 text-xl font-bold leading-tight tabular-nums">{pct(mgr.avg_talk_ratio)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              {mgr.avg_score != null ? (
                <>
                  <span className={`font-bold ${scoreColor(mgr.avg_score)}`}>{mgr.avg_score}/100</span>
                  <span className="text-xs text-muted-foreground">({scoreLabel(mgr.avg_score)})</span>
                </>
              ) : (
                <span className="text-sm text-muted-foreground">{t('managers.no_scores')}</span>
              )}
            </div>
            {mgr.last_score != null && (
              <span className="text-xs text-muted-foreground">
                {t('managers.last')} <span className={scoreColor(mgr.last_score)}>{mgr.last_score}</span>
              </span>
            )}
          </div>
          {mgr.last_call_at && (
            <p className="text-xs text-muted-foreground">{t('managers.last_call', { date: formatDate(mgr.last_call_at) })}</p>
          )}
          <div className="flex items-center gap-2 border-t pt-3">
            <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
            <TokenControl
              token={mgr.api_token ?? null}
              onRegenerate={async () => {
                const { api_token } = await api.regenerateToken(mgr.id)
                onChanged()
                return api_token
              }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5 border-t pt-3">
            <Button
              variant={selected ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => onSelect(mgr)}
            >
              {selected ? t('managers.hide_calls') : t('managers.show_calls')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => onEdit(mgr)} aria-label={t('managers.edit_btn')}>
              {t('managers.edit')}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onDelete(mgr)}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              aria-label={t('managers.delete_btn')}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

export function ManagersPage() {
  const { user } = useAuth()
  const { t } = useI18n()
  const isAdmin = user?.role === 'admin'
  const reduceMotion = useReducedMotion()

  const [managers, setManagers] = useState<Manager[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [calls, setCalls] = useState<Call[]>([])
  const [callsLoading, setCallsLoading] = useState(false)

  const loadManagers = useCallback(async () => {
    try {
      setManagers(await api.listManagers())
    } catch (e) {
      toast.error(t('managers.load_failed', { error: (e as Error).message }))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadManagers()
  }, [loadManagers])

  const loadCalls = useCallback(async (id: number) => {
    setSelectedId(id)
    setCallsLoading(true)
    try {
      setCalls(await api.listManagerCalls(id))
    } catch (e) {
      toast.error(t('managers.calls_load_failed', { error: (e as Error).message }))
      setCalls([])
    } finally {
      setCallsLoading(false)
    }
  }, [t])

  const handleDelete = async (m: Manager) => {
    if (!window.confirm(t('managers.delete_confirm', { name: m.name }))) return
    try {
      await api.deleteUser(m.id)
      toast.success(t('managers.deleted'))
      if (selectedId === m.id) {
        setSelectedId(null)
        setCalls([])
      }
      loadManagers()
    } catch (e) {
       toast.error(t('managers.delete_failed', { error: (e as Error).message }))
    }
  }

  const selectedManager = selectedId ? managers.find((m) => m.id === selectedId) : null

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md pt-16">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
              <ShieldAlert className="size-6 text-muted-foreground" />
            </div>
            <p className="text-base font-semibold">{t('users.no_access')}</p>
            <p className="text-sm text-muted-foreground">{t('managers.no_access_desc')}</p>
            <Button variant="outline" asChild>
              <Link to="/">{t('users.back')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const totalCalls = managers.reduce((s, m) => s + m.total_calls, 0)
  const doneScores = managers
    .filter((m) => m.avg_score != null)
    .map((m) => m.avg_score!)
  const orgAvg = doneScores.length ? Math.round(doneScores.reduce((a, b) => a + b, 0) / doneScores.length) : null

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('managers.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('managers.desc')}
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus /> {t('managers.add')}
        </Button>
      </header>

      <AddManagerDialog open={addOpen} onClose={() => setAddOpen(false)} onSaved={loadManagers} />

      {loading ? (
        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : managers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
              <UserRound className="size-6 text-muted-foreground" />
            </div>
            <p className="text-base font-semibold">{t('managers.no_managers')}</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {t('managers.no_managers_desc')}
            </p>
            <Button onClick={() => setAddOpen(true)}>
              <Plus /> {t('managers.add_first')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <motion.div key="managers" variants={fadeUp}>
            <StatMini icon={UserRound} label={t('managers.title')} value={managers.length} />
          </motion.div>
          <motion.div key="calls" variants={fadeUp}>
            <StatMini icon={BarChart3} label={t('managers.calls_label')} value={totalCalls} />
          </motion.div>
          <motion.div key="avg" variants={fadeUp}>
            <StatMini icon={Clock} label={t('managers.org_avg')} value={orgAvg != null ? `${orgAvg}/100` : '—'} />
          </motion.div>
          <motion.div key="key" variants={fadeUp}>
            <StatMini icon={KeyRound} label={t('managers.api_access')} value={managers.filter((m) => m.api_token).length} />
          </motion.div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : reduceMotion ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {managers.map((m) => (
            <ManagerCard
              key={m.id}
              mgr={m}
              selected={selectedId === m.id}
              onEdit={() => toast.info(t('managers.edit_via_team'))}
              onDelete={() => handleDelete(m)}
              onChanged={loadManagers}
              onSelect={() => (selectedId === m.id ? setSelectedId(null) : loadCalls(m.id))}
            />
          ))}
        </div>
      ) : (
        <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {managers.map((m) => (
            <ManagerCard
              key={m.id}
              mgr={m}
              selected={selectedId === m.id}
              onEdit={() => toast.info(t('managers.edit_via_team'))}
              onDelete={() => handleDelete(m)}
              onChanged={loadManagers}
              onSelect={() => (selectedId === m.id ? setSelectedId(null) : loadCalls(m.id))}
            />
          ))}
        </Stagger>
      )}

      {selectedId && selectedManager && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">
            {t('managers.recent_for', { name: selectedManager.name })}
          </h2>
          {callsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-lg" />
              ))}
            </div>
          ) : calls.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {t('managers.no_calls')}
              </CardContent>
            </Card>
          ) : (
            <div className="divide-y rounded-lg border">
              {calls.map((c) => (
                <div key={c.id} className="flex items-center justify-between p-3 text-sm">
                  <div className="min-w-0">
                    <Link
                      to={`/calls/${c.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {c.name}
                    </Link>
                    {c.client_name && <span className="text-xs text-muted-foreground"> · {c.client_name}</span>}
                    <div className="text-xs text-muted-foreground">
                      {c.duration_sec != null && formatDuration(c.duration_sec)}
                      {c.created_at && ` · ${formatDate(c.created_at)}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={statusVariant(c.status as CallStatus)}>
                      {t(`status.${c.status}`)}
                    </Badge>
                    {c.status === 'done' && c.analysis.scorecard?.overall != null && (
                      <span className={scoreColor(c.analysis.scorecard.overall)}>
                        {c.analysis.scorecard.overall}/100
                      </span>
                    )}
                    <ExternalLink className="size-3.5 text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ManagersPage

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
  Trophy,
  Target,
  PhoneCall,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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

type Ranking = Awaited<ReturnType<typeof api.getManagerRankings>>[number]

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

function RankingChart({
  data,
  dataKey,
  label,
  icon: Icon,
  color,
  unit,
}: {
  data: { name: string; value: number }[]
  dataKey: string
  label: string
  icon: typeof BarChart3
  color: string
  unit?: string
}) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Icon className="size-4" style={{ color }} />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 4, bottom: 4, left: 0 }}
            >
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={80}
                tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: 'var(--color-muted)', opacity: 0.3 }}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-card)' }}
                formatter={(value) => [`${value}${unit ?? ''}`, label]}
              />
              <Bar dataKey={dataKey} radius={[0, 4, 4, 0]} maxBarSize={24}>
                {data.map((_, i) => (
                  <Cell key={i} fill={color} fillOpacity={0.85 - i * 0.08} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
            No data
          </div>
        )}
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
            <Input id="mgr-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('users.email_placeholder')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mgr-password">{t('users.password')}</Label>
            <Input id="mgr-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('app.password_placeholder')} />
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
}: {
  mgr: Manager
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
            <Button variant="outline" size="sm" onClick={() => onSelect(mgr)}>
              {t('managers.show_calls')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => onEdit(mgr)} aria-label={t('managers.edit_btn')}>
              {t('managers.edit')}
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => onDelete(mgr)} className="text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label={t('managers.delete_btn')}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

export function ManagersDirectionsPage() {
  const { user } = useAuth()
  const { t } = useI18n()
  const isAdmin = user?.role === 'admin' || user?.role === 'yonalish'
  const reduceMotion = useReducedMotion()

  const [managers, setManagers] = useState<Manager[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [callsDialogOpen, setCallsDialogOpen] = useState(false)
  const [selectedManager, setSelectedManager] = useState<Manager | null>(null)
  const [calls, setCalls] = useState<Call[]>([])
  const [callsLoading, setCallsLoading] = useState(false)
  const [rankings, setRankings] = useState<Ranking[]>([])

  const loadManagers = useCallback(async () => {
    try {
      const allUsers = await api.listUsers()
      const yonalishUsers = allUsers.filter((u) => u.role === 'yonalish')
      setManagers(yonalishUsers as Manager[])
      try {
        const ranks = await api.getManagerRankings()
        setRankings(ranks.filter((r) => yonalishUsers.some((u) => u.id === r.id)))
      } catch { setRankings([]) }
    } catch (e) {
      toast.error(t('managers.load_failed', { error: (e as Error).message }))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadManagers()
  }, [loadManagers])

  const loadCalls = useCallback(async (mgr: Manager) => {
    setSelectedManager(mgr)
    setCallsDialogOpen(true)
    setCallsLoading(true)
    try {
      setCalls(await api.listManagerCalls(mgr.id))
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
      loadManagers()
    } catch (e) {
      toast.error(t('managers.delete_failed', { error: (e as Error).message }))
    }
  }

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
  const doneScores = managers.filter((m) => m.avg_score != null).map((m) => m.avg_score!)
  const orgAvg = doneScores.length ? Math.round(doneScores.reduce((a, b) => a + b, 0) / doneScores.length) : null

  const chartColors = {
    calls: 'var(--color-chart-1)',
    score: 'var(--color-score-good)',
    talk: 'var(--color-chart-3)',
  }

  const mostCallsData = rankings.filter((r) => r.total_calls > 0).sort((a, b) => b.total_calls - a.total_calls).slice(0, 6).map((r) => ({ name: r.name.split(' ')[0], value: r.total_calls }))
  const mostSuccessfulData = rankings.filter((r) => r.avg_score != null).sort((a, b) => (b.avg_score ?? 0) - (a.avg_score ?? 0)).slice(0, 6).map((r) => ({ name: r.name.split(' ')[0], value: r.avg_score ?? 0 }))
  const mostEffectiveData = rankings.filter((r) => r.avg_talk_ratio != null).sort((a, b) => (b.avg_talk_ratio ?? 0) - (a.avg_talk_ratio ?? 0)).slice(0, 6).map((r) => ({ name: r.name.split(' ')[0], value: Math.round((r.avg_talk_ratio ?? 0) * 100) }))

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('managers.directions_section')}</h1>
          <p className="text-sm text-muted-foreground">{t('managers.directions_section_desc')}</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus /> {t('managers.add')}
        </Button>
      </header>

      <AddManagerDialog open={addOpen} onClose={() => setAddOpen(false)} onSaved={loadManagers} />

      {loading ? (
        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : managers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted"><UserRound className="size-6 text-muted-foreground" /></div>
            <p className="text-base font-semibold">{t('managers.no_managers')}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{t('managers.no_managers_desc')}</p>
            <Button onClick={() => setAddOpen(true)}><Plus /> {t('managers.add_first')}</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <motion.div key="managers" variants={fadeUp}><StatMini icon={UserRound} label={t('managers.title')} value={managers.length} /></motion.div>
            <motion.div key="calls" variants={fadeUp}><StatMini icon={BarChart3} label={t('managers.calls_label')} value={totalCalls} /></motion.div>
            <motion.div key="avg" variants={fadeUp}><StatMini icon={Clock} label={t('managers.org_avg')} value={orgAvg != null ? `${orgAvg}/100` : '—'} /></motion.div>
            <motion.div key="key" variants={fadeUp}><StatMini icon={KeyRound} label={t('managers.api_access')} value={managers.filter((m) => m.api_token).length} /></motion.div>
          </div>
          <div className="mb-6 grid gap-4 md:grid-cols-3">
            <RankingChart data={mostCallsData} dataKey="value" label={t('managers.most_calls')} icon={PhoneCall} color={chartColors.calls} />
            <RankingChart data={mostSuccessfulData} dataKey="value" label={t('managers.most_successful')} icon={Trophy} color={chartColors.score} unit="/100" />
            <RankingChart data={mostEffectiveData} dataKey="value" label={t('managers.most_effective')} icon={Target} color={chartColors.talk} unit="%" />
          </div>
        </>
      )}

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
      ) : reduceMotion ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {managers.map((m) => <ManagerCard key={m.id} mgr={m} onEdit={() => toast.info(t('managers.edit_via_team'))} onDelete={handleDelete} onChanged={loadManagers} onSelect={loadCalls} />)}
        </div>
      ) : (
        <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {managers.map((m) => <ManagerCard key={m.id} mgr={m} onEdit={() => toast.info(t('managers.edit_via_team'))} onDelete={handleDelete} onChanged={loadManagers} onSelect={loadCalls} />)}
        </Stagger>
      )}

      <Dialog open={callsDialogOpen} onOpenChange={setCallsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{selectedManager ? t('managers.recent_for', { name: selectedManager.name }) : ''}</DialogTitle>
            <DialogDescription>{calls.length} {t('managers.calls_label').toLowerCase()}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto -mx-6 px-6">
            {callsLoading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
            ) : calls.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">{t('managers.no_calls')}</div>
            ) : (
              <div className="divide-y rounded-lg border">
                {calls.map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-3 text-sm">
                    <div className="min-w-0">
                      <Link to={`/calls/${c.id}`} className="font-medium text-foreground hover:underline" onClick={() => setCallsDialogOpen(false)}>{c.name}</Link>
                      {c.client_name && <span className="text-xs text-muted-foreground"> · {c.client_name}</span>}
                      <div className="text-xs text-muted-foreground">
                        {c.duration_sec != null && formatDuration(c.duration_sec)}
                        {c.created_at && ` · ${formatDate(c.created_at)}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={statusVariant(c.status as CallStatus)}>{t(`status.${c.status}`)}</Badge>
                      {c.status === 'done' && c.analysis.scorecard?.overall != null && <span className={scoreColor(c.analysis.scorecard.overall)}>{c.analysis.scorecard.overall}/100</span>}
                      <ExternalLink className="size-3.5 text-muted-foreground" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default ManagersDirectionsPage
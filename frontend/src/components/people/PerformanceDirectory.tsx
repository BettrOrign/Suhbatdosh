import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, Clock, KeyRound, PhoneCall, Target, Trophy, UserRound } from 'lucide-react'
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

import { EmptyState, PageHeader } from '@/components/EmptyState'
import { PersonDialog } from './PersonDialog'
import { usePeopleDirectory } from './PersonDialog'
import { useI18n } from '@/i18n/i18n'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Stagger } from '@/lib/motion'
import { TokenControl } from '@/components/TokenControl'
import { ScoreChip } from '@/components/ScoreRing'
import {
  average,
  formatDate,
  formatDuration,
  matches,
  scoreColor,
  scoreLabel,
  statusVariant,
} from '@/lib/format'
import type { Call, ManagedUser, Role } from '@/lib/types'
import { overallScore, callTitle } from '@/lib/types'

/* ---------------------------------------------------------------------------
 * `ManagersList.tsx` and `ManagersDirections.tsx` were ~95% identical (~480
 * lines each) and differed only in which role they listed and which i18n key
 * prefix they used. `ManagersDirections` additionally cast `User[]` to
 * `Manager[]`, so every stat on it was NaN/undefined.
 *
 * The fix for both is the same: one component, and stats that come from
 * `/api/stats/manager-rankings` merged onto the real user rows by id, rather
 * than pretending a user row already carries them.
 * ------------------------------------------------------------------------- */

export interface PerformanceStats {
  total_calls: number
  avg_score: number | null
  avg_talk_ratio: number | null
  best_score: number | null
  calls_today: number
  trend: string
  solved_problems: number
  unsolved_problems: number
  last_call_at: string | null
}

const EMPTY_STATS: PerformanceStats = {
  total_calls: 0,
  avg_score: null,
  avg_talk_ratio: null,
  best_score: null,
  calls_today: 0,
  trend: 'flat',
  solved_problems: 0,
  unsolved_problems: 0,
  last_call_at: null,
}

export type PerformancePerson = ManagedUser & { stats: PerformanceStats }

export interface PerformanceConfig {
  role: Role
  titleKey: string
  descriptionKey: string
  failureKey: string
  /** Label of the "calls for this person" button. */
  browseLabelKey: string
  browseDialogTitleKey: string
  browseDialogCountKey: string
  browseEmptyKey: string
  /** First metric card label (calls vs solved problems). */
  primaryStatLabelKey: string
  /** Chart card titles — the two variants do not share key names. */
  chartLabelKeys: { volume: string; score: string; share: string }
}

const CHART_COLOR = {
  volume: 'var(--color-chart-1)',
  score: 'var(--color-score-good)',
  share: 'var(--color-chart-3)',
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
    <Card size="sm">
      <CardContent className="flex items-center gap-2.5 p-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-muted-foreground ring-1 ring-border-subtle">
          <Icon className="size-3.5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-2xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            {label}
          </p>
          <p className="data-value text-base leading-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function RankingChart({
  data,
  label,
  icon: Icon,
  color,
  unit,
  emptyLabel,
}: {
  data: { name: string; value: number }[]
  label: string
  icon: typeof BarChart3
  color: string
  unit?: string
  emptyLabel: string
}) {
  return (
    <Card size="sm" className="h-full">
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-1.5 text-xs">
          <Icon className="size-3.5" style={{ color }} />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height={168}>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 26, bottom: 0, left: 0 }}>
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={72}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: 'var(--color-surface-sunken)' }}
                contentStyle={{
                  fontSize: 11,
                  borderRadius: 6,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface-elevated)',
                }}
                formatter={(value) => [`${value ?? ''}${unit ?? ''}`, label]}
              />
              <Bar dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={10}>
                {data.map((d, i) => (
                  <Cell key={d.name} fill={color} fillOpacity={Math.max(0.3, 0.65 - i * 0.08)} />
                ))}
                <LabelList
                  dataKey="value"
                  position="right"
                  offset={6}
                  className="fill-muted-foreground"
                  fontSize={10}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-[168px] items-center justify-center text-xs text-muted-foreground">
            {emptyLabel}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CallsDialog({
  open,
  onOpenChange,
  person,
  config,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  person: PerformancePerson | null
  config: PerformanceConfig
}) {
  const { t } = useI18n()
  const [calls, setCalls] = useState<Call[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !person) return
    let cancelled = false
    setLoading(true)
    api
      .listManagerCalls(person.id)
      .then((data) => {
        if (!cancelled) setCalls(data)
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setCalls([])
          toast.error(t('managers.calls_load_failed', { error: e.message }))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, person, t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {person ? t(config.browseDialogTitleKey, { name: person.name }) : ''}
          </DialogTitle>
          <DialogDescription>{calls.length} {t(config.browseDialogCountKey)}</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-md" />
              ))}
            </div>
          ) : calls.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {t(config.browseEmptyKey)}
            </div>
          ) : (
            <div className="divide-y divide-border-subtle overflow-hidden rounded-md ring-1 ring-border">
              {calls.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-surface-hover">
                  <div className="min-w-0">
                    <Link
                      to={`/calls/${c.id}`}
                      onClick={() => onOpenChange(false)}
                      className="block truncate font-medium hover:text-primary hover:underline"
                    >
                      {callTitle(c)}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {c.client_name && <>{c.client_name} · </>}
                      {c.duration_sec != null && <>{formatDuration(c.duration_sec)} · </>}
                      {formatDate(c.created_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={statusVariant(c.status)}>{t(`status.${c.status}`)}</Badge>
                    {c.status === 'done' && <ScoreChip score={overallScore(c.analysis)} />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PersonCard({
  person,
  onBrowse,
  onChanged,
  config,
}: {
  person: PerformancePerson
  onBrowse: (p: PerformancePerson) => void
  onChanged: () => void
  config: PerformanceConfig
}) {
  const { t, lang } = useI18n()
  const { stats } = person

  return (
    <Card interactive size="sm" className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-muted-foreground ring-1 ring-border-subtle">
              <UserRound className="size-3.5" />
            </div>
            <div className="min-w-0">
              <CardTitle className="truncate text-sm">{person.name}</CardTitle>
              <p className="truncate text-xs text-muted-foreground">{person.email}</p>
            </div>
          </div>
          <Badge variant={person.active ? 'success' : 'secondary'}>
            {person.active ? t('users.active') : t('users.inactive')}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md bg-surface-sunken px-2.5 py-1.5 ring-1 ring-border-subtle ring-inset">
            <p className="eyebrow truncate">{t(config.primaryStatLabelKey)}</p>
            <p className="data-value mt-0.5 text-lg leading-none">{stats.total_calls}</p>
          </div>
          <div className="rounded-md bg-surface-sunken px-2.5 py-1.5 ring-1 ring-border-subtle ring-inset">
            <p className="eyebrow truncate">{t('managers.avg_talk')}</p>
            <p className="data-value mt-0.5 text-lg leading-none">
              {stats.avg_talk_ratio == null ? '—' : `${Math.round(stats.avg_talk_ratio * 100)}%`}
            </p>
          </div>
        </div>

        <div className="flex items-baseline justify-between gap-2">
          {stats.avg_score != null ? (
            <p className="flex items-baseline gap-1.5">
              <span className={`text-sm font-semibold tabular-nums ${scoreColor(stats.avg_score)}`}>
                {stats.avg_score}/100
              </span>
              <span className="text-xs text-muted-foreground">{scoreLabel(stats.avg_score, lang)}</span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{t('managers.no_scores')}</p>
          )}
          {stats.best_score != null && (
            <p className="text-2xs text-muted-foreground">
              {t('managers.best')} <span className={scoreColor(stats.best_score)}>{stats.best_score}</span>
            </p>
          )}
        </div>

        {stats.last_call_at && (
          <p className="text-xs text-muted-foreground">
            {t('managers.last_call', { date: formatDate(stats.last_call_at) })}
          </p>
        )}

        <div className="flex items-center gap-2 border-t border-border-subtle pt-2">
          <KeyRound aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
          <TokenControl
            token={person.api_token ?? null}
            onRegenerate={async () => {
              const { api_token } = await api.regenerateToken(person.id)
              onChanged()
              return api_token
            }}
          />
        </div>

        <div className="flex justify-end border-t border-border-subtle pt-2">
          <Button variant="outline" size="sm" onClick={() => onBrowse(person)}>
            {t(config.browseLabelKey)}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function PerformanceDirectory({ config }: { config: PerformanceConfig }) {
  const { user } = useAuth()
  const { t } = useI18n()
  const isAdmin = user?.role === 'admin'
  const allowed = user?.role === 'admin' || user?.role === 'yonalish'

  const { people, loading, refresh } = usePeopleDirectory(config.failureKey)
  const [rankings, setRankings] = useState<Awaited<ReturnType<typeof api.getManagerRankings>>>([])
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [browsing, setBrowsing] = useState<PerformancePerson | null>(null)

  useEffect(() => {
    if (!allowed) return
    api
      .getManagerRankings()
      .then(setRankings)
      .catch(() => setRankings([]))
  }, [allowed])

  /** Merge rankings onto the real user rows by id. No casts, no NaN. */
  const directory = useMemo<PerformancePerson[]>(() => {
    const byId = new Map(rankings.map((r) => [r.id, r]))
    return people
      .filter((p) => p.role === config.role)
      .map((p) => {
        const r = byId.get(p.id)
        return {
          ...p,
          stats: r
            ? {
                total_calls: r.total_calls,
                avg_score: r.avg_score,
                avg_talk_ratio: r.avg_talk_ratio,
                best_score: r.best_score,
                calls_today: r.calls_today,
                trend: r.trend,
                solved_problems: r.solved_problems ?? 0,
                unsolved_problems: r.unsolved_problems ?? 0,
                last_call_at: null,
              }
            : { ...EMPTY_STATS },
        }
      })
  }, [people, rankings, config.role])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return directory
    return directory.filter((p) => matches(p.name, q) || matches(p.email, q))
  }, [directory, search])

  const stats = useMemo(() => {
    const totalCalls = directory.reduce((s, p) => s + p.stats.total_calls, 0)
    const orgAvg = average(directory.map((p) => p.stats.avg_score))
    const apiTokens = directory.filter((p) => p.api_token).length
    return { totalCalls, orgAvg, apiTokens }
  }, [directory])

  const charts = useMemo(() => {
    const short = (n: string) => n.split(' ')[0]
    const top = (list: PerformancePerson[], pick: (p: PerformancePerson) => number | null) =>
      list
        .filter((p) => pick(p) != null)
        .sort((a, b) => (pick(b) ?? 0) - (pick(a) ?? 0))
        .slice(0, 6)
        .map((p) => ({ name: short(p.name), value: Math.round(pick(p) ?? 0) }))

    return {
      volume: top(
        directory.filter((p) => p.stats.total_calls > 0),
        (p) => p.stats.total_calls
      ),
      score: top(directory, (p) => p.stats.avg_score),
      share: top(
        directory.filter((p) => p.stats.avg_talk_ratio != null),
        (p) => (p.stats.avg_talk_ratio ?? 0) * 100
      ),
    }
  }, [directory])

  if (!allowed) {
    return <NoAccess />
  }

  return (
    <div>
      <PageHeader
        title={t(config.titleKey)}
        description={t(config.descriptionKey)}
        actions={
          <>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t('people.search_placeholder')}
              placeholder={t('people.search_placeholder')}
              className="w-48"
            />
            {isAdmin && <Button onClick={() => setAddOpen(true)}>{t('managers.add')}</Button>}
          </>
        }
      />

      {addOpen && (
        <PersonDialog
          mode="create"
          person={null}
          lockRoleTo={config.role}
          onClose={() => setAddOpen(false)}
          onSaved={refresh}
        />
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[
          { label: t(config.titleKey), value: directory.length, icon: UserRound },
          { label: t(config.primaryStatLabelKey), value: stats.totalCalls, icon: BarChart3 },
          {
            label: t('managers.org_avg'),
            value: stats.orgAvg != null ? `${stats.orgAvg}/100` : '—',
            icon: Clock,
          },
          { label: t('managers.api_access'), value: stats.apiTokens, icon: KeyRound },
        ].map((s) => (
          <div key={s.label} className="min-w-[140px] flex-1">
            <StatMini icon={s.icon} label={s.label} value={s.value} />
          </div>
        ))}
      </div>

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <RankingChart
          data={charts.volume}
          label={t(config.chartLabelKeys.volume)}
          icon={PhoneCall}
          color={CHART_COLOR.volume}
          emptyLabel={t('dashboard.chart.no_data')}
        />
        <RankingChart
          data={charts.score}
          label={t(config.chartLabelKeys.score)}
          icon={Trophy}
          color={CHART_COLOR.score}
          unit="/100"
          emptyLabel={t('dashboard.chart.no_data')}
        />
        <RankingChart
          data={charts.share}
          label={t(config.chartLabelKeys.share)}
          icon={Target}
          color={CHART_COLOR.share}
          unit="%"
          emptyLabel={t('dashboard.chart.no_data')}
        />
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title={search.trim() ? t('clients.no_match') : t('managers.no_managers')}
          description={search.trim() ? t('clients.no_match_desc') : t('managers.no_managers_desc')}
          action={
            isAdmin && !search.trim() ? (
              <Button size="sm" onClick={() => setAddOpen(true)}>
                {t('managers.add_first')}
              </Button>
            ) : null
          }
        />
      ) : (
        <Stagger className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <PersonCard
              key={p.id}
              person={p}
              config={config}
              onBrowse={setBrowsing}
              onChanged={refresh}
            />
          ))}
        </Stagger>
      )}

      <CallsDialog
        open={browsing !== null}
        onOpenChange={(v) => {
          if (!v) setBrowsing(null)
        }}
        person={browsing}
        config={config}
      />
    </div>
  )
}

function NoAccess() {
  const { t } = useI18n()
  return (
    <div className="mx-auto max-w-md pt-12">
      <EmptyState
        title={t('users.no_access')}
        description={t('managers.no_access_desc')}
        action={
          <Button size="sm" variant="outline" asChild>
            <Link to="/">{t('common.back_home')}</Link>
          </Button>
        }
      />
    </div>
  )
}

export { NoAccess }

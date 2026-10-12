import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDown, ArrowUp, Clock, Gauge, Minus, PhoneCall, UsersRound, Users } from 'lucide-react'
import { motion as m } from 'framer-motion'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'

import { DeltaChip, StatCard } from '@/components/StatCard'
import { ScoreChip } from '@/components/ScoreRing'
import { CallTypePieChart } from '@/components/CallTypePieChart'
import { ScoreDistributionChart } from '@/components/ScoreDistributionChart'
import { Stagger, fadeUp, SPRING } from '@/lib/motion'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useI18n } from '@/i18n/i18n'
import { formatDate, formatDuration, scoreColor } from '@/lib/format'
import { callTitle, overallScore, type Call } from '@/lib/types'
import { cn } from '@/lib/utils'

type OverviewStats = Awaited<ReturnType<typeof api.getOverviewStats>>
type DayOverDay = Awaited<ReturnType<typeof api.getDayOverDay>>
type WeeklyTrend = Awaited<ReturnType<typeof api.getWeeklyTrend>>
type Ranking = Awaited<ReturnType<typeof api.getManagerRankings>>[number]
type ProblemCall = Awaited<ReturnType<typeof api.getProblemCalls>>[number]

const CHART_TOOLTIP = {
  fontSize: 11,
  borderRadius: 6,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface-elevated)',
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'up') return <ArrowUp aria-hidden="true" className="size-3 text-success" />
  if (trend === 'down') return <ArrowDown aria-hidden="true" className="size-3 text-destructive" />
  return <Minus aria-hidden="true" className="size-3 text-muted-foreground" />
}

export function Analytics() {
  const { user } = useAuth()
  const { t } = useI18n()

  const [overview, setOverview] = useState<OverviewStats | null>(null)
  const [dod, setDod] = useState<DayOverDay | null>(null)
  const [weekly, setWeekly] = useState<WeeklyTrend>([])
  const [rankings, setRankings] = useState<Ranking[]>([])
  const [calls, setCalls] = useState<Call[]>([])
  const [sources, setSources] = useState<Record<string, number>>({})
  const [problems, setProblems] = useState<ProblemCall[]>([])
  const [selected, setSelected] = useState<{ id: number; name: string } | null>(null)
  const [selectedCalls, setSelectedCalls] = useState<Call[]>([])
  const [selectedLoading, setSelectedLoading] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.getOverviewStats(),
      api.getDayOverDay(),
      api.getWeeklyTrend(),
      api.getManagerRankings(),
      api.listCalls(),
      api.getSourceBreakdown().catch(() => ({}) as Record<string, number>),
      api.getProblemCalls().catch(() => [] as ProblemCall[]),
    ])
      .then(([ov, day, wt, mr, cl, src, pb]) => {
        if (cancelled) return
        setOverview(ov)
        setDod(day)
        setWeekly(wt)
        setRankings(mr)
        setCalls(cl)
        setSources(src)
        setProblems(pb)
      })
      .catch(() => {
        /* leave the skeletons up only until first settle; partial data renders */
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selected) {
      setSelectedCalls([])
      return
    }
    let cancelled = false
    setSelectedLoading(true)
    api
      .listManagerCalls(selected.id)
      .then((cl) => {
        if (!cancelled) setSelectedCalls(cl)
      })
      .catch(() => {
        if (!cancelled) setSelectedCalls([])
      })
      .finally(() => {
        if (!cancelled) setSelectedLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected])

  const weeklyData = useMemo(
    () =>
      weekly.map((d) => ({
        day: new Date(d.day).toLocaleDateString(undefined, { weekday: 'short' }),
        calls: d.total_calls,
      })),
    [weekly]
  )

  /* The leaderboard is the "xodimlar" concept: solved vs unsolved problems.
     Only `yonalish` rows participate; anything else is a different view. */
  const leaders = useMemo(() => rankings.filter((r) => r.role === 'yonalish'), [rankings])

  if (loading) return <DashboardSkeleton />

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-[-0.02em]">
          {user?.name ? t('dashboard.welcome', { name: user.name }) : t('analytics.title')}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">{t('dashboard.welcome_desc')}</p>
      </header>

      <Stagger className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <motion.div variants={fadeUp}>
          <StatCard icon={PhoneCall} label={t('analytics.total_calls')} value={overview?.total_calls ?? 0} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard
            icon={Gauge}
            label={t('analytics.avg_score')}
            value={overview?.avg_score ?? 0}
            valueClass={scoreColor(overview?.avg_score)}
            progress={overview?.avg_score ?? null}
          />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard icon={Clock} label={t('analytics.today_calls')} value={overview?.calls_today ?? 0} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard icon={Users} label={t('analytics.active_managers')} value={overview?.total_managers ?? 0} />
        </motion.div>
      </Stagger>

      {dod && (
        <section className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label={t('analytics.day_comparison')}>
          {[
            {
              key: 'calls',
              label: t('analytics.calls'),
              today: dod.today.calls,
              yesterday: dod.yesterday.calls,
              format: (v: number | null) => (v != null ? String(v) : '—'),
              delta: (a: number, b: number) => Math.round(a - b),
            },
            {
              key: 'score',
              label: t('analytics.score'),
              today: dod.today.avg_score,
              yesterday: dod.yesterday.avg_score,
              format: (v: number | null) => (v != null ? String(v) : '—'),
              score: true,
              delta: (a: number, b: number) => Math.round(a - b),
            },
            {
              key: 'duration',
              label: t('analytics.duration'),
              today: dod.today.avg_duration,
              yesterday: dod.yesterday.avg_duration,
              format: (v: number | null) => (v != null ? formatDuration(v) : '—'),
              delta: (a: number, b: number) => {
                const secs = Math.abs(a - b)
                return `${secs >= 60 ? `${Math.floor(secs / 60)}m` : Math.round(secs)}s`
              },
            },
            {
              key: 'talk',
              label: t('analytics.talk_ratio'),
              today: dod.today.avg_talk_ratio,
              yesterday: dod.yesterday.avg_talk_ratio,
              format: (v: number | null) => (v != null ? `${Math.round(v * 100)}%` : '—'),
              delta: (a: number, b: number) => `${Math.round((a - b) * 100)}pp`,
            },
          ].map((m) => {
            const today = typeof m.today === 'number' ? m.today : null
            const yesterday = typeof m.yesterday === 'number' ? m.yesterday : null
            const max = Math.max(today ?? 0, yesterday ?? 0, 1)
            return (
              <Card key={m.key} size="sm">
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="eyebrow truncate">{m.label}</p>
                    <DeltaChip
                      delta={today != null && yesterday != null ? m.delta(today, yesterday) : null}
                    />
                  </div>
                  <p
                    className={cn(
                      'text-2xl leading-none font-semibold tracking-[-0.02em] tabular-nums',
                      m.score ? scoreColor(today) : 'text-foreground'
                    )}
                  >
                    {m.format(today)}
                  </p>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                        <motion.div
                          className="h-full rounded-full bg-border-strong"
                          initial={{ width: 0 }}
                          animate={{ width: `${((yesterday ?? 0) / max) * 100}%` }}
                          transition={SPRING.gentle}
                        />
                      </div>
                      <span className="w-20 shrink-0 text-right text-2xs tabular-nums text-muted-foreground">
                        {t('analytics.yesterday')} {m.format(yesterday)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                        <motion.div
                          className="h-full rounded-full bg-primary"
                          initial={{ width: 0 }}
                          animate={{ width: `${((today ?? 0) / max) * 100}%` }}
                          transition={SPRING.gentle}
                        />
                      </div>
                      <span className="w-20 shrink-0 text-right text-2xs font-medium tabular-nums">
                        {t('analytics.today')} {m.format(today)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </section>
      )}

      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-1">
            <CardTitle>{t('analytics.weekly_trend')}</CardTitle>
          </CardHeader>
          <CardContent>
            {weeklyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={190}>
                <AreaChart data={weeklyData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="callsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" axisLine={false} tickLine={false} dy={4} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={32} />
                  <Tooltip cursor={{ stroke: 'var(--color-border-strong)', strokeDasharray: '3 3' }} contentStyle={CHART_TOOLTIP} />
                  <Area
                    type="monotone"
                    dataKey="calls"
                    stroke="var(--color-chart-1)"
                    strokeWidth={2}
                    fill="url(#callsFill)"
                    dot={{ r: 2.5, fill: 'var(--color-chart-1)', strokeWidth: 0 }}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface)' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[190px] items-center justify-center text-xs text-muted-foreground">
                {t('dashboard.chart.no_data')}
              </div>
            )}
          </CardContent>
        </Card>

        {/* These two components existed as dead files while Analytics
            re-implemented them inline. They are now the single source. */}
        <ScoreDistributionChart calls={calls} />
        <CallTypePieChart calls={calls} />
        <SourceBreakdown sources={sources} />
      </div>

      <Card>
        <Tabs defaultValue="employees">
          <CardHeader className="border-b border-border-subtle pb-2.5">
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{t('analytics.manager_rankings')}</CardTitle>
              <TabsList>
                <TabsTrigger value="employees">{t('analytics.tab_employees')}</TabsTrigger>
                <TabsTrigger value="problems">
                  {t('analytics.tab_problems')}
                  {problems.length > 0 && (
                    <span className="ml-1 rounded-full bg-destructive-soft px-1.5 text-2xs font-semibold tabular-nums text-destructive-soft-foreground">
                      {problems.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>
          </CardHeader>

          <CardContent className="pt-3">
            <TabsContent value="employees">
            <div className="grid gap-4 lg:grid-cols-12">
            <ol className="min-w-0 max-h-[26rem] space-y-1 overflow-y-auto pr-1 lg:col-span-7">
              {leaders.length === 0 ? (
                <li className="py-10 text-center text-xs text-muted-foreground">
                  {t('analytics.no_problems')}
                </li>
              ) : (
                leaders.map((r, i) => {
                  const isSelected = selected?.id === r.id
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setSelected({ id: r.id, name: r.name })}
                        aria-pressed={isSelected}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-150',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                          isSelected ? 'bg-primary-soft ring-1 ring-primary/25' : 'hover:bg-surface-hover'
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'flex size-6 shrink-0 items-center justify-center rounded-sm text-2xs font-semibold tabular-nums ring-1 ring-inset',
                            i === 0
                              ? 'bg-warning-soft text-warning-soft-foreground ring-warning/25'
                              : 'bg-surface-sunken text-muted-foreground ring-border-subtle'
                          )}
                        >
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium">{r.name}</span>
                            <TrendIcon trend={r.trend} />
                          </span>
                          <span className="mt-0.5 block text-2xs text-muted-foreground">
                            {r.total_calls} {t('analytics.calls').toLowerCase()}
                            {r.avg_score != null && (
                              <> · <span className={cn('font-semibold', scoreColor(r.avg_score))}>{r.avg_score}</span></>
                            )}
                            {(r.solved_problems ?? 0) > 0 && (
                              <span className="text-success"> · {r.solved_problems} {t('analytics.solved')}</span>
                            )}
                            {(r.unsolved_problems ?? 0) > 0 && (
                              <span className="text-destructive"> · {r.unsolved_problems} {t('analytics.unsolved')}</span>
                            )}
                          </span>
                        </span>
                        {r.best_score != null && (
                          <span className="shrink-0 text-right">
                            <span className="eyebrow block">{t('analytics.best')}</span>
                            <span className={cn('text-xs font-semibold tabular-nums', scoreColor(r.best_score))}>
                              {r.best_score}
                            </span>
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })
              )}
            </ol>

            <div className="lg:col-span-5 lg:min-h-[26rem]">
              <AnimatePresence mode="wait">
                {selected ? (
                  <motion.div
                    key={selected.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={SPRING.standard}
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-border-subtle pb-2">
                      <p className="truncate text-xs font-semibold">{selected.name}</p>
                      <Badge variant="secondary">
                        {selectedCalls.length} {t('analytics.calls').toLowerCase()}
                      </Badge>
                    </div>
                    {selectedLoading ? (
                      <div className="mt-2 space-y-1.5">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <Skeleton key={i} className="h-14 rounded-md" />
                        ))}
                      </div>
                    ) : selectedCalls.length === 0 ? (
                      <p className="py-10 text-center text-xs text-muted-foreground">
                        {t('analytics.no_calls_for', { name: selected.name })}
                      </p>
                    ) : (
                      <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
                        {selectedCalls.map((c) => {
                          const overall = overallScore(c.analysis)
                          const actionItem = Array.isArray(asActionItems(c))
                            ? asActionItems(c)[0]
                            : undefined
                          return (
                            <li key={c.id}>
                              <Link
                                to={`/calls/${c.id}`}
                                className="block rounded-md px-2.5 py-2 transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                              >
                                <span className="flex items-baseline justify-between gap-2">
                                  <span className="truncate text-xs font-medium">{callTitle(c)}</span>
                                  <ScoreChip score={overall} />
                                </span>
                                <span className="mt-0.5 block text-2xs text-muted-foreground">
                                  {[c.client_name, c.duration_sec != null ? formatDuration(c.duration_sec) : null]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                                {actionItem && (
                                  <span className="mt-1 block truncate rounded-sm bg-surface-sunken px-1.5 py-0.5 text-2xs text-muted-foreground">
                                    {actionItem}
                                  </span>
                                )}
                              </Link>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center gap-2 py-16 text-center"
                  >
                    <UsersRound aria-hidden="true" className="size-7 text-muted-foreground/40" />
                    <p className="max-w-[24ch] text-xs text-muted-foreground">{t('analytics.click_employee')}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            </div>
            </TabsContent>

            <TabsContent value="problems">
              {problems.length === 0 ? (
                <p className="py-12 text-center text-xs text-muted-foreground">
                  {t('analytics.no_problems')}
                </p>
              ) : (
                <ul className="max-h-[26rem] space-y-1 overflow-y-auto pr-1">
                  {problems.map((p) => (
                    <li key={p.id}>
                      <Link
                        to={`/calls/${p.id}`}
                        className="block rounded-md px-2.5 py-2 transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate text-xs font-medium">{p.name}</span>
                          <ScoreChip score={p.score} />
                        </span>
                        {p.summary && (
                          <span className="mt-1 block line-clamp-2 text-2xs leading-relaxed text-muted-foreground">
                            {p.summary}
                          </span>
                        )}
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 text-2xs text-muted-foreground">
                          <span className="tabular-nums">{formatDuration(p.duration_sec)}</span>
                          <span className="capitalize">{p.source_type.replace(/_/g, ' ')}</span>
                          {p.outcome && <span className="capitalize">{p.outcome}</span>}
                          {p.uploader_name && <span>· {p.uploader_name}</span>}
                          <span className="tabular-nums">· {formatDate(p.created_at)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
    </div>
  )
}

/** Where calls come from. Uses the previously-unused `/api/stats/source-breakdown`. */
function SourceBreakdown({ sources }: { sources: Record<string, number> }) {
  const { t } = useI18n()
  const rows = useMemo(
    () =>
      Object.entries(sources)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6),
    [sources]
  )
  const total = rows.reduce((s, [, n]) => s + n, 0) || 1

  return (
    <Card size="sm" className="lg:col-span-2">
      <CardHeader className="pb-1">
        <CardTitle>{t('analytics.source_breakdown')}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex h-[190px] items-center justify-center text-xs text-muted-foreground">
            {t('dashboard.chart.no_data')}
          </div>
        ) : (
          <ul className="space-y-2.5 pt-1">
            {rows.map(([source, count], i) => (
              <li key={source} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                <span className="truncate text-xs capitalize">{source.replace(/_/g, ' ')}</span>
                <span className="text-xs font-semibold tabular-nums">
                  {count}
                  <span className="ml-1.5 text-2xs font-normal text-muted-foreground">
                    {Math.round((count / total) * 100)}%
                  </span>
                </span>
                <div className="col-span-2 h-1 overflow-hidden rounded-full bg-surface-sunken">
                  <m.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: `var(--color-chart-${(i % 6) + 1})` }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(count / total) * 100}%` }}
                    transition={{ ...SPRING.gentle, delay: i * 0.04 }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function asActionItems(call: Call): string[] {
  const raw = call.analysis as { action_items?: unknown }
  if (!Array.isArray(raw.action_items)) return []
  return raw.action_items
    .map((a) => (a as { description?: unknown })?.description)
    .filter((d): d is string => typeof d === 'string' && d.trim() !== '')
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="loading">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-6 w-56 rounded-md" />
        <Skeleton className="h-3 w-72 rounded" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        <Skeleton className="h-56 rounded-lg lg:col-span-2" />
        <Skeleton className="h-56 rounded-lg" />
      </div>
      <Skeleton className="h-80 rounded-lg" />
    </div>
  )
}

export default Analytics

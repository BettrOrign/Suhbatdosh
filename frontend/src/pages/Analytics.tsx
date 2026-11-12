import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Clock,
  Gauge,
  Lightbulb,
  Loader2,
  MessageSquareWarning,
  Mic,
  Minus,
  PhoneCall,
  Send,
  Sparkles,
  TriangleAlert,
  Users,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'

import { DeltaChip } from '@/components/StatCard'
import { ScoreChip } from '@/components/ScoreRing'
import { PageHeader } from '@/components/EmptyState'
import { EmployeeHome } from '@/pages/EmployeeHome'
import { SPRING } from '@/lib/motion'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useI18n } from '@/i18n/i18n'
import { formatDate, formatDuration, scoreColor } from '@/lib/format'
import {
  callTitle,
  overallScore,
  type Call,
  type CrossCallAnswer,
  type CrossCallInsights,
} from '@/lib/types'
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

function signedDuration(diffSeconds: number): string {
  const rounded = Math.round(diffSeconds)
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : ''
  const abs = Math.abs(rounded)
  return abs >= 60 ? `${sign}${Math.floor(abs / 60)}m` : `${sign}${abs}s`
}

export function Analytics() {
  const { user } = useAuth()
  const { t } = useI18n()

  const canViewOrgStats = user?.role === 'admin' || user?.role === 'yonalish'

  const [overview, setOverview] = useState<OverviewStats | null>(null)
  const [dod, setDod] = useState<DayOverDay | null>(null)
  const [weekly, setWeekly] = useState<WeeklyTrend>([])
  const [rankings, setRankings] = useState<Ranking[]>([])
  const [calls, setCalls] = useState<Call[]>([])
  const [sources, setSources] = useState<Record<string, number>>({})
  const [problems, setProblems] = useState<ProblemCall[]>([])
  const [insights, setInsights] = useState<CrossCallInsights | null>(null)
  const [qaQuestion, setQaQuestion] = useState('')
  const [qaAsking, setQaAsking] = useState(false)
  const [qaAnswer, setQaAnswer] = useState<CrossCallAnswer | null>(null)
  const [selected, setSelected] = useState<{ id: number; name: string } | null>(null)
  const [selectedCalls, setSelectedCalls] = useState<Call[]>([])
  const [selectedLoading, setSelectedLoading] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!canViewOrgStats) {
      setLoading(false)
      return
    }

    let cancelled = false
    Promise.all([
      api.getOverviewStats().catch(() => null),
      api.getDayOverDay().catch(() => null),
      api.getWeeklyTrend().catch(() => [] as WeeklyTrend),
      api.getManagerRankings().catch(() => [] as Ranking[]),
      api.listCalls().catch(() => [] as Call[]),
      api.getSourceBreakdown().catch(() => ({}) as Record<string, number>),
      api.getProblemCalls().catch(() => [] as ProblemCall[]),
      api.getCrossCallInsights().catch(() => null),
    ])
      .then(([ov, day, wt, mr, cl, src, pb, ins]) => {
        if (cancelled) return
        setOverview(ov)
        setDod(day)
        setWeekly(wt)
        setRankings(mr)
        setCalls(cl)
        setSources(src)
        setProblems(pb)
        setInsights(ins)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [canViewOrgStats])

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
        score: d.avg_score != null ? Math.round(d.avg_score) : null,
      })),
    [weekly],
  )

  const scoreBuckets = useMemo(() => {
    const b = [
      { label: '70–100 (Strong)', count: 0, tone: 'bg-success' },
      { label: '40–69 (Needs work)', count: 0, tone: 'bg-warning' },
      { label: '0–39 (Critical)', count: 0, tone: 'bg-destructive' },
    ]
    for (const c of calls) {
      if (c.status !== 'done') continue
      const s = overallScore(c.analysis)
      if (s == null) continue
      if (s >= 70) b[0].count += 1
      else if (s >= 40) b[1].count += 1
      else b[2].count += 1
    }
    return b
  }, [calls])

  const sourceRows = useMemo(
    () =>
      Object.entries(sources)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6),
    [sources],
  )

  if (!canViewOrgStats) {
    return <EmployeeHome />
  }

  if (loading) return <DashboardSkeleton />

  const hasTeam = (overview?.total_managers ?? 0) > 0 || rankings.length > 0
  const hasCalls = (overview?.total_calls ?? 0) > 0
  const hasPbx = Boolean(sources.zadarma || sources.telegram_voice || sources.telegram_audio)

  const kpiCards = [
    {
      key: 'calls',
      icon: PhoneCall,
      label: t('analytics.total_calls'),
      headline: String(overview?.total_calls ?? 0),
      subLabel: `${t('analytics.today')}: ${dod?.today.calls ?? overview?.calls_today ?? 0} · ${t('analytics.yesterday')}: ${dod?.yesterday.calls ?? 0}`,
      delta:
        dod?.today.calls != null && dod?.yesterday.calls != null
          ? Math.round(dod.today.calls - dod.yesterday.calls)
          : null,
      invert: false,
      scoreTone: null as number | null,
    },
    {
      key: 'score',
      icon: Gauge,
      label: t('analytics.avg_score'),
      headline: overview?.avg_score != null ? `${Math.round(overview.avg_score)}/100` : '—',
      subLabel: `${t('analytics.today')}: ${dod?.today.avg_score != null ? Math.round(dod.today.avg_score) : '—'} · ${t('analytics.yesterday')}: ${dod?.yesterday.avg_score != null ? Math.round(dod.yesterday.avg_score) : '—'}`,
      delta:
        dod?.today.avg_score != null && dod?.yesterday.avg_score != null
          ? Math.round(dod.today.avg_score - dod.yesterday.avg_score)
          : null,
      invert: false,
      scoreTone: overview?.avg_score ?? null,
    },
    {
      key: 'duration',
      icon: Clock,
      label: t('analytics.duration'),
      headline:
        dod?.today.avg_duration != null
          ? formatDuration(dod.today.avg_duration)
          : dod?.yesterday.avg_duration != null
            ? formatDuration(dod.yesterday.avg_duration)
            : '—',
      subLabel: `${t('analytics.yesterday')}: ${dod?.yesterday.avg_duration != null ? formatDuration(dod.yesterday.avg_duration) : '—'}`,
      delta:
        dod?.today.avg_duration != null && dod?.yesterday.avg_duration != null
          ? signedDuration(dod.today.avg_duration - dod.yesterday.avg_duration)
          : null,
      invert: true,
      scoreTone: null as number | null,
    },
    {
      key: 'team',
      icon: Users,
      label: t('analytics.active_managers'),
      headline: String(overview?.total_managers ?? rankings.length),
      subLabel:
        dod?.today.avg_talk_ratio != null
          ? `${t('call.talk_ratio')}: ${Math.round(dod.today.avg_talk_ratio * 100)}%`
          : `${problems.length} ${t('analytics.problem_calls').toLowerCase()}`,
      delta:
        dod?.today.avg_talk_ratio != null && dod?.yesterday.avg_talk_ratio != null
          ? `${Math.round((dod.today.avg_talk_ratio - dod.yesterday.avg_talk_ratio) * 100)}pp`
          : null,
      invert: false,
      scoreTone: null as number | null,
    },
  ]

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow={user?.role === 'yonalish' ? t('nav.coaching_desk') : t('nav.dashboard')}
        title={user?.name ? t('dashboard.welcome', { name: user.name }) : t('analytics.title')}
        description={
          user?.role === 'yonalish' ? t('coach.banner_desc') : t('dashboard.welcome_desc')
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {insights && (
              <>
                <Link
                  to="/calls"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive-soft/60 px-2.5 py-1.5 text-xs font-medium text-destructive-soft-foreground transition-colors hover:bg-destructive-soft"
                >
                  <span>{t('coach.escalated_label')}:</span>
                  <strong data-numeric>{insights.decision_counts.ESCALATE}</strong>
                </Link>
                <Link
                  to="/calls"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning-soft/60 px-2.5 py-1.5 text-xs font-medium text-warning-soft-foreground transition-colors hover:bg-warning-soft"
                >
                  <span>{t('coach.needs_coaching_label')}:</span>
                  <strong data-numeric>{insights.decision_counts.COACH}</strong>
                </Link>
              </>
            )}
            <Button asChild size="sm">
              <Link to="/calls">
                <Mic aria-hidden="true" className="size-3.5" />
                {t('nav.calls')}
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            </Button>
          </div>
        }
      />

      {/* Setup Checklist (Admin only, when workspace is still being configured) */}
      {user?.role === 'admin' && (!hasTeam || !hasCalls) && (
        <section className="rounded-xl border border-primary/25 bg-surface p-4 shadow-e1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">{t('setup.title')}</h2>
              <p className="text-xs text-muted-foreground">{t('setup.desc')}</p>
            </div>
            <Badge variant="outline" className="font-mono text-2xs">
              {user.org_name ?? 'MBSI'}
            </Badge>
          </div>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: t('setup.step_org'), to: '/settings', done: hasCalls },
              { label: t('setup.step_team'), to: '/users', done: hasTeam },
              { label: t('setup.step_pbx'), to: '/settings', done: hasPbx },
              { label: t('setup.step_call'), to: '/calls', done: hasCalls },
            ].map((step) => (
              <Link
                key={step.label}
                to={step.to}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-xs transition-colors',
                  step.done
                    ? 'border-success/30 bg-success/5 text-foreground'
                    : 'border-border bg-surface-sunken/70 hover:bg-surface-hover',
                )}
              >
                <span className="font-medium">{step.label}</span>
                <CheckCircle2
                  className={cn(
                    'size-4 shrink-0',
                    step.done ? 'text-success' : 'text-muted-foreground/40',
                  )}
                />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Row 1: Unified Metasell KPI Strip (4 aligned cards with built-in day-over-day delta) */}
      <section
        aria-label={t('analytics.title')}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {kpiCards.map((k) => {
          const Icon = k.icon
          return (
            <Card key={k.key} className="h-full">
              <CardContent className="flex h-full flex-col justify-between gap-3 p-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <span className="flex size-7 items-center justify-center rounded-md bg-primary-soft text-primary-soft-foreground">
                      <Icon aria-hidden="true" className="size-3.5" />
                    </span>
                    {k.label}
                  </span>
                  <DeltaChip delta={k.delta} invert={k.invert} />
                </div>

                <div>
                  <p
                    data-numeric
                    className={cn(
                      'text-[1.85rem] leading-none font-bold tracking-[-0.03em] tabular-nums',
                      k.scoreTone != null ? scoreColor(k.scoreTone) : 'text-foreground',
                    )}
                  >
                    {k.headline}
                  </p>
                  <p className="mt-1.5 truncate text-2xs text-muted-foreground">{k.subLabel}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </section>

      {/* Row 2: Symmetrical 12-Column Analytics Bento Grid (Weekly Trend + Breakdown Card) */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
        <Card className="flex flex-col lg:col-span-7">
          <CardHeader className="border-b border-border-subtle pb-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>{t('analytics.weekly_trend')}</CardTitle>
                <CardDescription className="mt-0.5">{t('analytics.hero_sub')}</CardDescription>
              </div>
              <Badge variant="secondary" className="tabular-nums">
                {overview?.done_calls ?? 0} {t('status.done').toLowerCase()}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex-1 pt-4">
            {weeklyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={weeklyData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="callsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.38} />
                      <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" axisLine={false} tickLine={false} dy={4} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={32} />
                  <Tooltip
                    cursor={{ stroke: 'var(--color-border-strong)', strokeDasharray: '3 3' }}
                    contentStyle={CHART_TOOLTIP}
                  />
                  <Area
                    type="monotone"
                    dataKey="calls"
                    stroke="var(--color-chart-1)"
                    strokeWidth={2.25}
                    fill="url(#callsFill)"
                    dot={{ r: 3, fill: 'var(--color-chart-1)', strokeWidth: 0 }}
                    activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'var(--color-surface)' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">
                {t('dashboard.chart.no_data')}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col lg:col-span-5">
          <Tabs defaultValue="scores" className="flex h-full flex-col">
            <CardHeader className="border-b border-border-subtle pb-2.5">
              <div className="flex items-center justify-between gap-2">
                <CardTitle>{t('analytics.score_distribution')}</CardTitle>
                <TabsList>
                  <TabsTrigger value="scores">{t('analytics.score')}</TabsTrigger>
                  <TabsTrigger value="sources">{t('analytics.source_breakdown')}</TabsTrigger>
                </TabsList>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-center pt-4">
              <TabsContent value="scores" className="mt-0 space-y-4">
                {(() => {
                  const totalScored = scoreBuckets.reduce((s, b) => s + b.count, 0) || 1
                  return scoreBuckets.map((b) => {
                    const pct = Math.round((b.count / totalScored) * 100)
                    return (
                      <div key={b.label} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium">{b.label}</span>
                          <span className="font-semibold tabular-nums">
                            {b.count}{' '}
                            <span className="text-2xs font-normal text-muted-foreground">
                              ({pct}%)
                            </span>
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
                          <div
                            className={cn('h-full rounded-full transition-all', b.tone)}
                            style={{ width: `${Math.max(b.count > 0 ? 6 : 0, pct)}%` }}
                          />
                        </div>
                      </div>
                    )
                  })
                })()}

                <div className="grid grid-cols-2 gap-2.5 border-t border-border-subtle pt-3">
                  <div className="rounded-lg bg-surface-sunken px-3 py-2">
                    <p className="text-2xs text-muted-foreground">{t('call.manager_call')}</p>
                    <p data-numeric className="mt-0.5 text-base font-semibold">
                      {calls.filter((c) => c.call_type === 'manager').length}
                    </p>
                  </div>
                  <div className="rounded-lg bg-surface-sunken px-3 py-2">
                    <p className="text-2xs text-muted-foreground">{t('call.receptionist_call')}</p>
                    <p data-numeric className="mt-0.5 text-base font-semibold">
                      {calls.filter((c) => c.call_type === 'receptionist').length}
                    </p>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="sources" className="mt-0">
                {sourceRows.length === 0 ? (
                  <div className="flex h-[180px] items-center justify-center text-xs text-muted-foreground">
                    {t('dashboard.chart.no_data')}
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {(() => {
                      const total = sourceRows.reduce((s, [, n]) => s + n, 0) || 1
                      return sourceRows.map(([source, count], i) => (
                        <li key={source} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="capitalize font-medium">
                              {source.replace(/_/g, ' ')}
                            </span>
                            <span className="font-semibold tabular-nums">
                              {count}{' '}
                              <span className="text-2xs font-normal text-muted-foreground">
                                ({Math.round((count / total) * 100)}%)
                              </span>
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.round((count / total) * 100)}%`,
                                backgroundColor: `var(--color-chart-${(i % 6) + 1})`,
                              }}
                            />
                          </div>
                        </li>
                      ))
                    })()}
                  </ul>
                )}
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>
      </div>

      {/* Row 3: Metasell Split View — Team Leaderboard (Left 7 cols) + Problem Calls Queue (Right 5 cols) */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
        {/* Left: Team Performance Leaderboard */}
        <Card className="flex flex-col lg:col-span-7">
          <CardHeader className="border-b border-border-subtle pb-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>{t('analytics.manager_rankings')}</CardTitle>
                <CardDescription className="mt-0.5">{t(' analytics.click_employee' in t ? 'analytics.click_employee' : 'analytics.click_employee')}</CardDescription>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link to="/managers">{t('nav.submenu.managers')}</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex-1 pt-3">
            {rankings.length === 0 ? (
              <div className="flex h-60 items-center justify-center text-xs text-muted-foreground">
                {t('managers.no_managers')}
              </div>
            ) : (
              <div className="space-y-3">
                <div
                  role="region"
                  aria-label={t('analytics.manager_rankings')}
                  tabIndex={0}
                  className="max-h-80 overflow-y-auto rounded-lg border border-border-subtle [overscroll-behavior:contain] [scrollbar-gutter:stable]"
                >
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 z-10 border-b border-border-subtle bg-surface-sunken text-2xs font-semibold uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">{t('users.name')}</th>
                        <th className="px-3 py-2 text-right">{t('analytics.calls')}</th>
                        <th className="px-3 py-2 text-right">{t('analytics.score')}</th>
                        <th className="px-3 py-2 text-right">{t('analytics.best')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {rankings.map((r, i) => {
                        const isSelected = selected?.id === r.id
                        return (
                          <tr
                            key={r.id}
                            onClick={() =>
                              setSelected(isSelected ? null : { id: r.id, name: r.name })
                            }
                            className={cn(
                              'cursor-pointer transition-colors',
                              isSelected ? 'bg-primary-soft/60' : 'hover:bg-surface-hover',
                            )}
                          >
                            <td className="px-3 py-2.5 font-mono text-2xs font-semibold tabular-nums text-muted-foreground">
                              {i + 1}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5 font-medium text-foreground">
                                <span className="truncate">{r.name}</span>
                                <TrendIcon trend={r.trend} />
                              </div>
                              <div className="mt-0.5 flex items-center gap-2 text-2xs text-muted-foreground">
                                {r.role && <span>{t(`nav.role.${r.role}`)}</span>}
                                {(r.unsolved_problems ?? 0) > 0 && (
                                  <span className="text-destructive">
                                    · {r.unsolved_problems} {t('analytics.unsolved')}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                              {r.total_calls}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums">
                              {r.avg_score != null ? (
                                <span className={cn('font-semibold', scoreColor(r.avg_score))}>
                                  {Math.round(r.avg_score)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums">
                              {r.best_score != null ? (
                                <span className={cn('font-semibold', scoreColor(r.best_score))}>
                                  {Math.round(r.best_score)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Selected Rep's Recent Calls Drawer */}
                <AnimatePresence mode="wait">
                  {selected && (
                    <motion.div
                      key={selected.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={SPRING.standard}
                      className="rounded-lg border border-border bg-surface-sunken/50 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold">
                          {t('managers.recent_for', { name: selected.name })}
                        </p>
                        <Badge variant="secondary" className="tabular-nums">
                          {selectedCalls.length}
                        </Badge>
                      </div>
                      {selectedLoading ? (
                        <Skeleton className="h-16 rounded-md" />
                      ) : selectedCalls.length === 0 ? (
                        <p className="py-4 text-center text-xs text-muted-foreground">
                          {t('analytics.no_calls_for', { name: selected.name })}
                        </p>
                      ) : (
                        <ul className="max-h-44 space-y-1 overflow-y-auto pr-1 [overscroll-behavior:contain]">
                          {selectedCalls.slice(0, 6).map((c) => (
                            <li key={c.id}>
                              <Link
                                to={`/calls/${c.id}`}
                                className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors hover:bg-surface-hover"
                              >
                                <span className="truncate font-medium">{callTitle(c)}</span>
                                <ScoreChip score={overallScore(c.analysis)} />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: Problem Calls Queue (Always visible beside Leaderboard) */}
        <Card className="flex flex-col lg:col-span-5">
          <CardHeader className="border-b border-border-subtle pb-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-1.5">
                  <TriangleAlert aria-hidden="true" className="size-4 text-destructive" />
                  {t('analytics.problem_calls')}
                </CardTitle>
                <CardDescription className="mt-0.5">
                  {t('analytics.problem_calls_desc')}
                </CardDescription>
              </div>
              {problems.length > 0 && (
                <Badge variant="destructive" className="tabular-nums">
                  {problems.length}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex-1 pt-3">
            {problems.length === 0 ? (
              <div className="flex h-60 flex-col items-center justify-center gap-2 text-center">
                <CheckCircle2 aria-hidden="true" className="size-6 text-success" />
                <p className="text-xs text-muted-foreground">{t('analytics.no_problems')}</p>
              </div>
            ) : (
              <ul className="max-h-80 space-y-2 overflow-y-auto pr-1 [overscroll-behavior:contain] [scrollbar-gutter:stable]">
                {problems.map((p) => (
                  <li key={p.id}>
                    <Link
                      to={`/calls/${p.id}`}
                      className="block rounded-lg border border-border-subtle bg-surface-sunken/50 p-3 transition-colors hover:border-destructive/30 hover:bg-surface-hover"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-foreground">
                          {p.name}
                        </span>
                        <ScoreChip score={p.score} />
                      </div>
                      {p.summary && (
                        <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-muted-foreground">
                          {p.summary}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 text-2xs text-muted-foreground">
                        {p.uploader_name && <span className="font-medium">{p.uploader_name}</span>}
                        <span className="tabular-nums">· {formatDuration(p.duration_sec)}</span>
                        <span className="tabular-nums">· {formatDate(p.created_at)}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 4: Cross-Call AI Intelligence & Conversational Assistant */}
      <Card>
        <CardHeader className="border-b border-border-subtle pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles aria-hidden="true" className="size-4 text-primary" />
                {t('analytics.insights.title')}
              </CardTitle>
              <CardDescription className="mt-0.5">{t('analytics.insights.desc')}</CardDescription>
            </div>
            {insights && insights.analyzed_calls > 0 && (
              <Badge variant="outline" className="tabular-nums">
                {insights.analyzed_calls} {t('nav.calls')}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {insights && insights.analyzed_calls > 0 && (
            <div className="grid gap-3 md:grid-cols-3">
              {/* Weakest Rubric Dimensions */}
              <div className="rounded-lg border border-border-subtle bg-surface-sunken/50 p-3.5">
                <p className="mb-2.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('analytics.insights.weakest_dims')}
                </p>
                <ul className="space-y-2">
                  {insights.weakest_dimensions.map((d) => (
                    <li key={d.dimension} className="flex items-center justify-between text-xs">
                      <span className="truncate font-medium">{t(`rubric.${d.dimension}`)}</span>
                      <span className={cn('font-semibold tabular-nums', scoreColor(d.avg_score))}>
                        {d.avg_score}/100
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Top Client Objections */}
              <div className="rounded-lg border border-border-subtle bg-surface-sunken/50 p-3.5">
                <p className="mb-2.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <MessageSquareWarning aria-hidden="true" className="size-3.5 text-warning" />
                  {t('analytics.insights.top_objections')}
                </p>
                {insights.top_objections.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t('analytics.insights.no_objections')}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {insights.top_objections.slice(0, 4).map((obj, idx) => (
                      <li key={idx} className="flex items-start justify-between gap-2 text-xs">
                        <span className="line-clamp-1">{obj.text}</span>
                        <Badge variant="secondary" className="shrink-0 tabular-nums">
                          {obj.count}x
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Top Coaching Flaws */}
              <div className="rounded-lg border border-border-subtle bg-surface-sunken/50 p-3.5">
                <p className="mb-2.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Lightbulb aria-hidden="true" className="size-3.5 text-primary" />
                  {t('analytics.insights.top_flaws')}
                </p>
                {insights.top_flaws.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('analytics.insights.no_items')}</p>
                ) : (
                  <ul className="space-y-2">
                    {insights.top_flaws.slice(0, 4).map((flaw, idx) => (
                      <li key={idx} className="flex items-start justify-between gap-2 text-xs">
                        <span className="line-clamp-1">{flaw.text}</span>
                        <Badge variant="outline" className="shrink-0 tabular-nums">
                          {flaw.count}x
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Interactive Cross-Call Ask AI */}
          <div className="rounded-lg border border-border bg-surface p-3.5">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={async (e) => {
                e.preventDefault()
                const q = qaQuestion.trim()
                if (!q || qaAsking) return
                setQaAsking(true)
                try {
                  const res = await api.askAcrossCalls(q)
                  setQaAnswer(res)
                } catch (err) {
                  toast.error((err as Error).message)
                } finally {
                  setQaAsking(false)
                }
              }}
            >
              <Input
                value={qaQuestion}
                onChange={(e) => setQaQuestion(e.target.value)}
                placeholder={t('analytics.insights.ask_placeholder')}
                aria-label={t('analytics.insights.ask_placeholder')}
                className="flex-1"
              />
              <Button type="submit" disabled={qaAsking || !qaQuestion.trim()}>
                {qaAsking ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <Send aria-hidden="true" className="size-4" />
                )}
                {qaAsking ? t('analytics.insights.asking') : t('analytics.insights.ask_btn')}
              </Button>
            </form>

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {[
                t('analytics.insights.q1'),
                t('analytics.insights.q2'),
                t('analytics.insights.q3'),
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setQaQuestion(preset)}
                  className="rounded-full border border-border-subtle bg-surface-sunken px-2.5 py-1 text-2xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {preset}
                </button>
              ))}
            </div>

            {qaAnswer && (
              <div className="mt-3.5 space-y-2.5 rounded-md border border-primary/20 bg-primary-soft/20 p-3 text-xs">
                <p className="leading-relaxed whitespace-pre-line text-foreground">
                  {qaAnswer.answer}
                </p>
                {qaAnswer.recommendations.length > 0 && (
                  <div>
                    <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t('analytics.insights.recommendations')}
                    </p>
                    <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                      {qaAnswer.recommendations.map((rec, i) => (
                        <li key={i}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {qaAnswer.cited_call_ids.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-2xs font-semibold text-muted-foreground">
                      {t('analytics.insights.cited_calls')}:
                    </span>
                    {qaAnswer.cited_call_ids.map((cid) => (
                      <Link
                        key={cid}
                        to={`/calls/${cid}`}
                        className="rounded bg-surface px-1.5 py-0.5 font-mono text-2xs font-medium text-primary ring-1 ring-border transition-colors hover:bg-primary-soft"
                      >
                        #{cid}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="loading" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-56 rounded-md" />
        <Skeleton className="h-3 w-72 rounded" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <Skeleton className="h-72 rounded-xl lg:col-span-7" />
        <Skeleton className="h-72 rounded-xl lg:col-span-5" />
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <Skeleton className="h-80 rounded-xl lg:col-span-7" />
        <Skeleton className="h-80 rounded-xl lg:col-span-5" />
      </div>
    </div>
  )
}

export default Analytics

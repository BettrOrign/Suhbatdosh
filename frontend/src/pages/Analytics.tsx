import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, CheckCircle2, Clock, Gauge, Lightbulb, Loader2, MessageSquareWarning, Minus, PhoneCall, Send, Sparkles, UsersRound, Users } from 'lucide-react'
import { motion as m } from 'framer-motion'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'

import { DeltaChip, StatCard } from '@/components/StatCard'
import { ScoreChip } from '@/components/ScoreRing'
import { CallTypePieChart } from '@/components/CallTypePieChart'
import { ScoreDistributionChart } from '@/components/ScoreDistributionChart'
import { PageHeader } from '@/components/EmptyState'
import { EmployeeHome } from '@/pages/EmployeeHome'
import { Stagger, fadeUp, SPRING } from '@/lib/motion'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useI18n } from '@/i18n/i18n'
import { formatDate, formatDuration, scoreColor } from '@/lib/format'
import { callTitle, overallScore, type Call, type CrossCallAnswer, type CrossCallInsights } from '@/lib/types'
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

/**
 * Signed duration delta, e.g. `+45s`, `-2m`, `0s`. The absolute difference used
 * to be shown, so a longer average call and a shorter one both rendered as a
 * green improvement.
 */
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
    // Every request settles on its own: one failing endpoint must not blank
    // the six that worked.
    Promise.all([
      api.getOverviewStats().catch(() => null),
      api.getDayOverDay().catch(() => null),
      api.getWeeklyTrend().catch(() => [] as WeeklyTrend),
      api.getManagerRankings().catch(() => [] as Ranking[]),
      api.listCalls().catch(() => [] as Call[]),
      api.getSourceBreakdown().catch(() => ({}) as Record<string, number>),
      api.getProblemCalls().catch(() => [] as ProblemCall[]),
      api.getCrossCallInsights().catch(() => null),
    ]).then(([ov, day, wt, mr, cl, src, pb, ins]) => {
      if (cancelled) return
      setOverview(ov)
      setDod(day)
      setWeekly(wt)
      setRankings(mr)
      setCalls(cl)
      setSources(src)
      setProblems(pb)
      setInsights(ins)
    }).finally(() => {
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
      })),
    [weekly]
  )

  /* The leaderboard is the "xodimlar" concept: solved vs unsolved problems.
     Only `yonalish` rows participate; anything else is a different view. */
  const leaders = useMemo(() => rankings.filter((r) => r.role === 'yonalish'), [rankings])

  if (!canViewOrgStats) {
    return <EmployeeHome />
  }

  if (loading) return <DashboardSkeleton />

  const hasTeam = (overview?.total_managers ?? 0) > 0 || rankings.length > 0
  const hasCalls = (overview?.total_calls ?? 0) > 0
  const hasPbx = Boolean(sources.zadarma || sources.telegram_voice || sources.telegram_audio)

  return (
    <div>
      <PageHeader
        eyebrow={user?.role === 'yonalish' ? t('nav.coaching_desk') : t('nav.dashboard')}
        title={user?.name ? t('dashboard.welcome', { name: user.name }) : t('analytics.title')}
        description={user?.role === 'yonalish' ? t('coach.banner_desc') : t('dashboard.welcome_desc')}
      />

      {user?.role === 'admin' && (!hasTeam || !hasCalls) && (
        <section className="mb-5 rounded-xl border border-primary/25 bg-surface p-4 shadow-e1">
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

      {user?.role === 'yonalish' && (
        <section className="mb-5 rounded-xl border border-primary/25 bg-surface p-4 shadow-e1">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold">{t('coach.banner_title')}</h2>
              <p className="text-xs text-muted-foreground">{t('coach.banner_desc')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to="/calls"
                className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs"
              >
                <span className="text-muted-foreground">{t('coach.escalated_label')}: </span>
                <strong data-numeric className="text-destructive">
                  {insights?.decision_counts.ESCALATE ?? 0}
                </strong>
              </Link>
              <Link
                to="/calls"
                className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-xs"
              >
                <span className="text-muted-foreground">{t('coach.needs_coaching_label')}: </span>
                <strong data-numeric className="text-amber-600 dark:text-amber-400">
                  {insights?.decision_counts.COACH ?? 0}
                </strong>
              </Link>
              <Link
                to="/calls"
                className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs"
              >
                <span className="text-muted-foreground">{t('coach.exemplars_label')}: </span>
                <strong data-numeric className="text-primary">
                  {insights?.bookmarked_calls ?? 0}
                </strong>
              </Link>
            </div>
          </div>
        </section>
      )}

      <section className="relative mb-5 overflow-hidden rounded-2xl text-white">
        <div aria-hidden="true" className="absolute inset-0" style={{ background: 'var(--accent-gradient)' }} />
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-50"
          style={{
            background:
              'radial-gradient(560px 320px at 8% 0%, rgb(255 255 255 / 0.25), transparent 60%), radial-gradient(420px 280px at 96% 110%, rgb(52 214 226 / 0.5), transparent 62%)',
          }}
        />
        <div className="relative flex flex-wrap items-end justify-between gap-8 p-6 sm:p-8">
          <div className="max-w-xl">
            <p className="font-mono text-2xs font-medium tracking-[0.16em] text-white/75 uppercase">
              {t('analytics.hero_eyebrow')}
            </p>
            <h2 className="mt-3 text-[1.6rem] leading-tight font-semibold tracking-[-0.03em] sm:text-[2rem]">
              {t('analytics.hero_title')}
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-white/80">
              {t('analytics.hero_sub')}
            </p>
            <Link
              to="/calls"
              className="focus-ring mt-5 inline-flex h-10 items-center gap-2 rounded-full border border-white/30 bg-white/15 px-4 text-sm font-medium text-white backdrop-blur transition-colors duration-200 hover:bg-white/25"
            >
              {t('nav.calls')}
              <ArrowUp aria-hidden="true" className="size-3.5 rotate-45" />
            </Link>
          </div>

          <dl className="flex flex-wrap items-end gap-x-10 gap-y-6">
            <div>
              <dt className="text-2xs font-medium tracking-[0.12em] text-white/70 uppercase">
                {t('analytics.avg_score')}
              </dt>
              <dd className="mt-1 text-[2.75rem] leading-none font-semibold tracking-[-0.04em] tabular-nums">
                {overview?.avg_score != null ? Math.round(overview.avg_score) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-2xs font-medium tracking-[0.12em] text-white/70 uppercase">
                {t('analytics.total_calls')}
              </dt>
              <dd className="mt-1 text-[2rem] leading-none font-semibold tracking-[-0.04em] tabular-nums">
                {overview?.total_calls ?? 0}
              </dd>
            </div>
            <div>
              <dt className="text-2xs font-medium tracking-[0.12em] text-white/70 uppercase">
                {t('analytics.today_calls')}
              </dt>
              <dd className="mt-1 text-[2rem] leading-none font-semibold tracking-[-0.04em] tabular-nums">
                {overview?.calls_today ?? 0}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <Stagger className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
        <section className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('analytics.day_comparison')}>
          {[
            {
              key: 'calls',
              label: t('analytics.calls'),
              today: dod.today.calls,
              yesterday: dod.yesterday.calls,
              format: (v: number | null) => (v != null ? String(v) : '—'),
              delta: (a: number, b: number) => Math.round(a - b),
              invert: false,
            },
            {
              key: 'score',
              label: t('analytics.score'),
              today: dod.today.avg_score,
              yesterday: dod.yesterday.avg_score,
              format: (v: number | null) => (v != null ? String(v) : '—'),
              score: true,
              delta: (a: number, b: number) => Math.round(a - b),
              invert: false,
            },
            {
              key: 'duration',
              label: t('analytics.duration'),
              today: dod.today.avg_duration,
              yesterday: dod.yesterday.avg_duration,
              format: (v: number | null) => (v != null ? formatDuration(v) : '—'),
              delta: (a: number, b: number) => signedDuration(a - b),
              // Longer calls are not an achievement.
              invert: true,
            },
            {
              key: 'talk',
              label: t('analytics.talk_ratio'),
              today: dod.today.avg_talk_ratio,
              yesterday: dod.yesterday.avg_talk_ratio,
              format: (v: number | null) => (v != null ? `${Math.round(v * 100)}%` : '—'),
              delta: (a: number, b: number) => `${Math.round((a - b) * 100)}pp`,
              invert: false,
            },
          ].map((m) => {
            const today = typeof m.today === 'number' ? m.today : null
            const yesterday = typeof m.yesterday === 'number' ? m.yesterday : null
            const max = Math.max(today ?? 0, yesterday ?? 0, 1)
            return (
              <Card key={m.key}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">{m.label}</p>
                    <DeltaChip
                      delta={today != null && yesterday != null ? m.delta(today, yesterday) : null}
                      invert={m.invert}
                    />
                  </div>
                  <p
                    className={cn(
                      'text-[1.75rem] leading-none font-semibold tracking-[-0.03em] tabular-nums',
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

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
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
                      <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.42} />
                      <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" axisLine={false} tickLine={false} dy={4} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={32} />
                  <Tooltip cursor={{ stroke: 'var(--color-border-strong)', strokeDasharray: '3 3' }} contentStyle={CHART_TOOLTIP} />
                  <Area
                    type="monotone"
                    dataKey="calls"
                    stroke="var(--color-chart-1)"
                    strokeWidth={2.25}
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

      {/* Cross-Call AI Intelligence & Trends */}
      <Card>
        <CardHeader className="border-b border-border-subtle pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles aria-hidden="true" className="size-4 text-primary" />
                {t('analytics.insights.title')}
              </CardTitle>
              <CardDescription className="mt-0.5">
                {t('analytics.insights.desc')}
              </CardDescription>
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
              <div className="rounded-lg border border-border-subtle bg-surface-sunken/50 p-3">
                <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('analytics.insights.weak_dims')}
                </p>
                <ul className="space-y-1.5">
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
              <div className="rounded-lg border border-border-subtle bg-surface-sunken/50 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <MessageSquareWarning aria-hidden="true" className="size-3.5 text-warning" />
                  {t('analytics.insights.top_objections')}
                </p>
                {insights.top_objections.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('analytics.insights.no_objections')}</p>
                ) : (
                  <ul className="space-y-1.5">
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
              <div className="rounded-lg border border-border-subtle bg-surface-sunken/50 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Lightbulb aria-hidden="true" className="size-3.5 text-primary" />
                  {t('analytics.insights.top_flaws')}
                </p>
                {insights.top_flaws.length === 0 ? (
                  <p className="text-xs text-muted-foreground">—</p>
                ) : (
                  <ul className="space-y-1.5">
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
              {[t('analytics.insights.q1'), t('analytics.insights.q2'), t('analytics.insights.q3')].map((preset) => (
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
                <p className="leading-relaxed whitespace-pre-line text-foreground">{qaAnswer.answer}</p>
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
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-56 rounded-lg lg:col-span-2" />
        <Skeleton className="h-56 rounded-lg" />
      </div>
      <Skeleton className="h-80 rounded-lg" />
    </div>
  )
}

export default Analytics

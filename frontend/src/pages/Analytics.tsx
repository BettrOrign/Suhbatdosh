import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { motion, useReducedMotion } from 'framer-motion'
import {
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Minus,
  BarChart3,
  Clock,
  Gauge,
  Mic,
  PhoneCall,
  TrendingUp,
  Users,
  AlertTriangle,
  Play,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
} from 'recharts'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Stagger, fadeUp } from '@/lib/motion'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useI18n } from '@/i18n/i18n'
import { StatCard } from '@/components/StatCard'
import { formatDuration, scoreColor, scoreLabel } from '@/lib/format'
import type { Call } from '@/lib/types'

type OverviewStats = Awaited<ReturnType<typeof api.getOverviewStats>>
type DayOverDay = Awaited<ReturnType<typeof api.getDayOverDay>>
type WeeklyTrend = Awaited<ReturnType<typeof api.getWeeklyTrend>>
type ProblemCall = Awaited<ReturnType<typeof api.getProblemCalls>>
type ManagerRanking = Awaited<ReturnType<typeof api.getManagerRankings>>
type SourceBreakdown = Awaited<ReturnType<typeof api.getSourceBreakdown>>

const SCORE_COLORS = [
  { range: '0-20', min: 0, max: 20, color: 'var(--color-score-bad)' },
  { range: '20-40', min: 20, max: 40, color: 'var(--color-score-bad)' },
  { range: '40-60', min: 40, max: 60, color: 'var(--color-score-warn)' },
  { range: '60-80', min: 60, max: 80, color: 'var(--color-score-warn)' },
  { range: '80-100', min: 80, max: 101, color: 'var(--color-score-good)' },
]

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'up') return <ArrowUp className="size-3 text-emerald-500" />
  if (trend === 'down') return <ArrowDown className="size-3 text-red-500" />
  return <Minus className="size-3 text-muted-foreground" />
}

function DiffBadge({ current, previous }: { current: number | null; previous: number | null }) {
  if (current == null || previous == null) return null
  const diff = current - previous
  if (diff === 0) return <Badge variant="secondary" className="gap-1 text-xs"><Minus className="size-3" />0</Badge>
  if (diff > 0) return <Badge className="gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs"><ArrowUp className="size-3" />+{diff}</Badge>
  return <Badge className="gap-1 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-xs"><ArrowDown className="size-3" />{diff}</Badge>
}

export function Analytics() {
  const { user } = useAuth()
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()

  const [overview, setOverview] = useState<OverviewStats | null>(null)
  const [dayOverDay, setDayOverDay] = useState<DayOverDay | null>(null)
  const [weeklyTrend, setWeeklyTrend] = useState<WeeklyTrend>([])
  const [problemCalls, setProblemCalls] = useState<ProblemCall>([])
  const [rankings, setRankings] = useState<ManagerRanking[]>([])
  const [sources, setSources] = useState<SourceBreakdown>({})
  const [calls, setCalls] = useState<Call[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [ov, dod, wt, pc, mr, sb, cl] = await Promise.all([
        api.getOverviewStats(),
        api.getDayOverDay(),
        api.getWeeklyTrend(),
        api.getProblemCalls(),
        api.getManagerRankings(),
        api.getSourceBreakdown(),
        api.listCalls(),
      ])
      setOverview(ov)
      setDayOverDay(dod)
      setWeeklyTrend(wt)
      setProblemCalls(pc)
      setRankings(mr)
      setSources(sb)
      setCalls(cl)
    } catch {
      toast.error('Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const scoreDistData = (() => {
    const done = calls.filter((c) => c.status === 'done' && typeof c.analysis?.scorecard?.overall === 'number')
    return SCORE_COLORS.map((b) => ({
      name: b.range,
      count: done.filter((c) => c.analysis.scorecard!.overall >= b.min && c.analysis.scorecard!.overall < b.max).length,
      color: b.color,
    }))
  })()

  const weeklyData = weeklyTrend.map((d) => ({
    day: new Date(d.day).toLocaleDateString('en', { weekday: 'short' }),
    calls: d.total_calls,
    score: d.avg_score,
  }))

  const sourceData = Object.entries(sources).map(([name, value]) => ({ name, value }))
  const sourceColors = ['var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-chart-3)', 'var(--color-chart-4)']

  if (loading) {
    return (
      <div>
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Welcome */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mb-6"
      >
        <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-6 text-white shadow-lg shadow-indigo-500/25">
          <div className="flex size-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
            <TrendingUp className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('analytics.title')}</h1>
            <p className="text-sm text-white/70">{user?.name ?? ''}</p>
          </div>
        </div>
      </motion.div>

      {/* KPI Cards */}
      {reduceMotion ? (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard icon={PhoneCall} label={t('analytics.total_calls')} value={overview?.total_calls ?? 0} variant="solid" />
          <StatCard icon={Gauge} label={t('analytics.avg_score')} value={overview?.avg_score ?? 0} valueClass={scoreColor(overview?.avg_score ?? 0)} variant="accent" progress={overview?.avg_score ?? 0} progressClass={(overview?.avg_score ?? 0) >= 70 ? 'bg-emerald-500' : (overview?.avg_score ?? 0) >= 40 ? 'bg-amber-500' : 'bg-red-500'} />
          <StatCard icon={Clock} label={t('analytics.today_calls')} value={overview?.calls_today ?? 0} variant="gradient" />
          <StatCard icon={Users} label={t('analytics.active_managers')} value={overview?.total_managers ?? 0} variant="outline" />
        </div>
      ) : (
        <Stagger className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <motion.div variants={fadeUp}><StatCard icon={PhoneCall} label={t('analytics.total_calls')} value={overview?.total_calls ?? 0} variant="solid" /></motion.div>
          <motion.div variants={fadeUp}><StatCard icon={Gauge} label={t('analytics.avg_score')} value={overview?.avg_score ?? 0} valueClass={scoreColor(overview?.avg_score ?? 0)} variant="accent" progress={overview?.avg_score ?? 0} progressClass={(overview?.avg_score ?? 0) >= 70 ? 'bg-emerald-500' : (overview?.avg_score ?? 0) >= 40 ? 'bg-amber-500' : 'bg-red-500'} /></motion.div>
          <motion.div variants={fadeUp}><StatCard icon={Clock} label={t('analytics.today_calls')} value={overview?.calls_today ?? 0} variant="gradient" /></motion.div>
          <motion.div variants={fadeUp}><StatCard icon={Users} label={t('analytics.active_managers')} value={overview?.total_managers ?? 0} variant="outline" /></motion.div>
        </Stagger>
      )}

      {/* Day-over-Day Comparison */}
      {dayOverDay && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">{t('analytics.day_comparison')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t('analytics.calls')}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold tabular-nums">{dayOverDay.today.calls}</span>
                  <DiffBadge current={dayOverDay.today.calls} previous={dayOverDay.yesterday.calls} />
                </div>
                <p className="text-[11px] text-muted-foreground">{t('analytics.yesterday')}: {dayOverDay.yesterday.calls}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t('analytics.score')}</p>
                <div className="flex items-center gap-2">
                  <span className={`text-xl font-bold tabular-nums ${scoreColor(dayOverDay.today.avg_score ?? 0)}`}>{dayOverDay.today.avg_score ?? '—'}</span>
                  <DiffBadge current={dayOverDay.today.avg_score} previous={dayOverDay.yesterday.avg_score} />
                </div>
                <p className="text-[11px] text-muted-foreground">{t('analytics.yesterday')}: {dayOverDay.yesterday.avg_score ?? '—'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t('analytics.duration')}</p>
                <p className="text-xl font-bold tabular-nums">{dayOverDay.today.avg_duration != null ? formatDuration(dayOverDay.today.avg_duration) : '—'}</p>
                <p className="text-[11px] text-muted-foreground">{t('analytics.yesterday')}: {dayOverDay.yesterday.avg_duration != null ? formatDuration(dayOverDay.yesterday.avg_duration) : '—'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t('analytics.talk_ratio')}</p>
                <p className="text-xl font-bold tabular-nums">{dayOverDay.today.avg_talk_ratio != null ? `${Math.round(dayOverDay.today.avg_talk_ratio * 100)}%` : '—'}</p>
                <p className="text-[11px] text-muted-foreground">{t('analytics.yesterday')}: {dayOverDay.yesterday.avg_talk_ratio != null ? `${Math.round(dayOverDay.yesterday.avg_talk_ratio * 100)}%` : '—'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts Row */}
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {/* Weekly Trend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('analytics.weekly_trend')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {weeklyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={weeklyData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: 'var(--color-muted)', opacity: 0.5 }}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-card)' }}
                  />
                  <Bar dataKey="calls" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} maxBarSize={32} fillOpacity={0.85} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">{t('analytics.no_problems')}</div>
            )}
          </CardContent>
        </Card>

        {/* Score Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('analytics.score_distribution')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {scoreDistData.some((d) => d.count > 0) ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={scoreDistData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: 'var(--color-muted)', opacity: 0.5 }}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-card)' }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={40}>
                    {scoreDistData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} fillOpacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">{t('analytics.no_problems')}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Problem Calls + Manager Rankings */}
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {/* Problem Calls */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-500" />
                {t('analytics.problem_calls')}
              </CardTitle>
              <Badge variant="secondary">{problemCalls.length}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{t('analytics.problem_calls_desc')}</p>
          </CardHeader>
          <CardContent>
            {problemCalls.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('analytics.no_problems')}</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {problemCalls.map((pc) => (
                  <Link
                    key={pc.id}
                    to={`/calls/${pc.id}`}
                    className="flex items-center justify-between rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{pc.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{pc.summary}</p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="size-3" />
                        {formatDuration(pc.duration_sec)}
                        {pc.uploader_name && <span>· {pc.uploader_name}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <span className={`text-lg font-bold tabular-nums ${scoreColor(pc.score ?? 0)}`}>{pc.score}</span>
                      <ArrowRight className="size-3 text-muted-foreground" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Manager Rankings */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="size-4 text-indigo-500" />
              {t('analytics.manager_rankings')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rankings.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('analytics.no_problems')}</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {rankings.map((r, i) => (
                  <div key={r.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold tabular-nums">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{r.name}</span>
                        <TrendIcon trend={r.trend} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {r.total_calls} {t('analytics.calls').toLowerCase()}
                        {r.avg_score != null && <> · <span className={scoreColor(r.avg_score)}>{r.avg_score}</span></>}
                      </p>
                    </div>
                    {r.best_score != null && (
                      <span className="text-xs text-muted-foreground">best: <span className={scoreColor(r.best_score)}>{r.best_score}</span></span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Source Breakdown */}
      {sourceData.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('analytics.source_breakdown')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              {sourceData.map((s, i) => (
                <div key={s.name} className="flex items-center gap-2">
                  <span className="size-3 rounded-full" style={{ backgroundColor: sourceColors[i % sourceColors.length] }} />
                  <span className="text-sm text-muted-foreground">{s.name}</span>
                  <span className="text-sm font-semibold tabular-nums">{s.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

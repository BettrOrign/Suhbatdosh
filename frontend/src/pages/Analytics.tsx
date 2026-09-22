import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { motion, useReducedMotion } from 'framer-motion'
import {
  ArrowUp,
  ArrowDown,
  Minus,
  BarChart3,
  Clock,
  Gauge,
  PhoneCall,
  TrendingUp,
  Users,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  Area,
  AreaChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Stagger, fadeUp } from '@/lib/motion'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useI18n } from '@/i18n/i18n'
import { StatCard } from '@/components/StatCard'
import { formatDuration, scoreColor } from '@/lib/format'
import type { Call } from '@/lib/types'

type OverviewStats = Awaited<ReturnType<typeof api.getOverviewStats>>
type DayOverDay = Awaited<ReturnType<typeof api.getDayOverDay>>
type WeeklyTrend = Awaited<ReturnType<typeof api.getWeeklyTrend>>
type ManagerRanking = Awaited<ReturnType<typeof api.getManagerRankings>>

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
  const [rankings, setRankings] = useState<ManagerRanking>([])
  const [calls, setCalls] = useState<Call[]>([])
  const [selectedEmployee, setSelectedEmployee] = useState<{ id: number; name: string } | null>(null)
  const [empCalls, setEmpCalls] = useState<Call[]>([])
  const [empLoading, setEmpLoading] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [ov, dod, wt, mr, cl] = await Promise.all([
        api.getOverviewStats(),
        api.getDayOverDay(),
        api.getWeeklyTrend(),
        api.getManagerRankings(),
        api.listCalls(),
      ])
      setOverview(ov)
      setDayOverDay(dod)
      setWeeklyTrend(wt)
      setRankings(mr)
      setCalls(cl)
    } catch {
      toast.error('Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const loadEmpCalls = useCallback(async (emp: { id: number; name: string }) => {
    setSelectedEmployee(emp)
    setEmpLoading(true)
    try {
      const cl = await api.listManagerCalls(emp.id)
      setEmpCalls(cl)
    } catch {
      setEmpCalls([])
    } finally {
      setEmpLoading(false)
    }
  }, [])

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
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="mb-8"
      >
        <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-card p-6 shadow-xs">
          <div className="absolute -top-12 -right-12 size-40 rounded-full bg-primary/5 blur-2xl pointer-events-none" />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative">
            <div className="flex items-center gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-xs">
                <TrendingUp className="size-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('analytics.title')}</h1>
                <p className="text-sm text-muted-foreground mt-0.5">{user?.name ? `${t('dashboard.welcome_desc')} · ${user.name}` : t('dashboard.welcome_desc')}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <Badge variant="secondary" className="text-xs font-medium px-3 py-1">
                {new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </Badge>
            </div>
          </div>
        </div>
      </motion.div>

      {/* KPI Cards */}
      {reduceMotion ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard icon={PhoneCall} label={t('analytics.total_calls')} value={overview?.total_calls ?? 0} variant="solid" />
          <StatCard icon={Gauge} label={t('analytics.avg_score')} value={overview?.avg_score ?? 0} valueClass={scoreColor(overview?.avg_score ?? 0)} variant="accent" progress={overview?.avg_score ?? 0} progressClass={(overview?.avg_score ?? 0) >= 70 ? 'bg-emerald-500' : (overview?.avg_score ?? 0) >= 40 ? 'bg-amber-500' : 'bg-red-500'} />
          <StatCard icon={Clock} label={t('analytics.today_calls')} value={overview?.calls_today ?? 0} variant="solid" />
          <StatCard icon={Users} label={t('analytics.active_managers')} value={overview?.total_managers ?? 0} variant="outline" />
        </div>
      ) : (
        <Stagger className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <motion.div variants={fadeUp}><StatCard icon={PhoneCall} label={t('analytics.total_calls')} value={overview?.total_calls ?? 0} variant="solid" /></motion.div>
          <motion.div variants={fadeUp}><StatCard icon={Gauge} label={t('analytics.avg_score')} value={overview?.avg_score ?? 0} valueClass={scoreColor(overview?.avg_score ?? 0)} variant="accent" progress={overview?.avg_score ?? 0} progressClass={(overview?.avg_score ?? 0) >= 70 ? 'bg-emerald-500' : (overview?.avg_score ?? 0) >= 40 ? 'bg-amber-500' : 'bg-red-500'} /></motion.div>
          <motion.div variants={fadeUp}><StatCard icon={Clock} label={t('analytics.today_calls')} value={overview?.calls_today ?? 0} variant="solid" /></motion.div>
          <motion.div variants={fadeUp}><StatCard icon={Users} label={t('analytics.active_managers')} value={overview?.total_managers ?? 0} variant="outline" /></motion.div>
        </Stagger>
      )}

      {/* Day-over-Day Comparison */}
      {dayOverDay && (
        <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              label: t('analytics.calls'),
              today: dayOverDay.today.calls,
              yesterday: dayOverDay.yesterday.calls,
              icon: PhoneCall,
              gradient: 'from-blue-500/10 to-indigo-500/10 dark:from-blue-500/5 dark:to-indigo-500/5',
              iconBg: 'bg-blue-200 dark:bg-blue-900/30',
              iconColor: 'text-blue-600 dark:text-blue-400',
              barColor: 'bg-blue-500',
              format: (v: number | null) => v != null ? String(v) : '—',
            },
            {
              label: t('analytics.score'),
              today: dayOverDay.today.avg_score,
              yesterday: dayOverDay.yesterday.avg_score,
              icon: Gauge,
              gradient: 'from-emerald-500/10 to-teal-500/10 dark:from-emerald-500/5 dark:to-teal-500/5',
              iconBg: 'bg-emerald-200 dark:bg-emerald-900/30',
              iconColor: 'text-emerald-600 dark:text-emerald-400',
              barColor: 'bg-emerald-500',
              format: (v: number | null) => v != null ? String(v) : '—',
              scoreBased: true,
            },
            {
              label: t('analytics.duration'),
              today: dayOverDay.today.avg_duration,
              yesterday: dayOverDay.yesterday.avg_duration,
              icon: Clock,
              gradient: 'from-amber-500/10 to-orange-500/10 dark:from-amber-500/5 dark:to-orange-500/5',
              iconBg: 'bg-amber-200 dark:bg-amber-900/30',
              iconColor: 'text-amber-600 dark:text-amber-400',
              barColor: 'bg-amber-500',
              format: (v: number | null) => v != null ? formatDuration(v) : '—',
            },
            {
              label: t('analytics.talk_ratio'),
              today: dayOverDay.today.avg_talk_ratio,
              yesterday: dayOverDay.yesterday.avg_talk_ratio,
              icon: Users,
              gradient: 'from-purple-500/10 to-pink-500/10 dark:from-purple-500/5 dark:to-pink-500/5',
              iconBg: 'bg-purple-100 dark:bg-purple-900/30',
              iconColor: 'text-purple-600 dark:text-purple-400',
              barColor: 'bg-purple-500',
              format: (v: number | null) => v != null ? `${Math.round(v * 100)}%` : '—',
            },
          ].map((item) => {
            const todayVal = typeof item.today === 'number' ? item.today : null
            const yestVal = typeof item.yesterday === 'number' ? item.yesterday : null
            const maxVal = Math.max(todayVal ?? 0, yestVal ?? 0, 1)
            const todayPct = ((todayVal ?? 0) / maxVal) * 100
            const yestPct = ((yestVal ?? 0) / maxVal) * 100
            const Icon = item.icon

            return (
              <Card key={item.label} className={`overflow-hidden bg-gradient-to-br ${item.gradient} border-border/50`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className={`flex size-8 items-center justify-center rounded-lg ${item.iconBg}`}>
                      <Icon className={`size-4 ${item.iconColor}`} />
                    </div>
                    <DiffBadge current={todayVal} previous={yestVal} />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">{item.label}</p>
                    <p className={`text-2xl font-bold tabular-nums ${
                      item.scoreBased ? scoreColor(todayVal ?? 0) : 'text-foreground'
                    }`}>
                      {item.format(item.today)}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/50">
                        <div className={`h-full rounded-full ${item.barColor} opacity-20`} style={{ width: `${yestPct}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground tabular-nums w-12 text-right">
                        {t('analytics.yesterday')}: {item.format(item.yesterday)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/50">
                        <div className={`h-full rounded-full ${item.barColor}`} style={{ width: `${todayPct}%` }} />
                      </div>
                      <span className="text-[10px] font-medium tabular-nums w-12 text-right">
                        {t('analytics.today')}: {item.format(item.today)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Charts Row */}
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {/* Weekly Trend */}
        <Card>
          <CardHeader className="mb-5">
            <CardTitle className="text-center text-xl font-medium">{t('analytics.weekly_trend')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {weeklyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={weeklyData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="callsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ stroke: 'var(--color-chart-1)', strokeWidth: 1, strokeDasharray: '4 4' }}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-card)' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="calls"
                    stroke="var(--color-chart-1)"
                    strokeWidth={2.5}
                    fill="url(#callsGradient)"
                    dot={{ r: 3, fill: 'var(--color-chart-1)', strokeWidth: 0 }}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--color-card)' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">{t('analytics.no_problems')}</div>
            )}
          </CardContent>
        </Card>

        {/* Score Distribution */}
        <Card>
          <CardHeader className="pb-5">
            <CardTitle className="text-xl text-center font-medium">{t('analytics.score_distribution')}</CardTitle>
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

      {/* Manager Rankings */}
      <div className="block">
        <Card className="border-border/70 shadow-xs">
          <CardHeader className="pb-4 border-b border-border/50">
            <CardTitle className="text-lg font-bold flex items-center gap-2 text-foreground">
              <BarChart3 className="size-5 text-primary" />
              {t('analytics.manager_rankings')}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="space-y-2 max-h-80 overflow-y-auto lg:col-span-7 min-w-0 pr-1">
                {rankings
                  .filter((r) => (r as { role?: string }).role === 'yonalish')
                  .map((r, i) => {
                    const isSelected = selectedEmployee?.id === r.id
                    const rankClass = i === 0
                      ? 'bg-amber-100 text-amber-800 border border-amber-300/80 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/50'
                      : i === 1
                      ? 'bg-slate-100 text-slate-700 border border-slate-300/80 dark:bg-slate-800 dark:text-slate-300'
                      : i === 2
                      ? 'bg-orange-100 text-orange-800 border border-orange-300/80 dark:bg-orange-950/40 dark:text-orange-300'
                      : 'bg-muted text-muted-foreground border border-border/60'

                    return (
                      <div
                        key={r.id}
                        onClick={() => loadEmpCalls({ id: r.id, name: r.name })}
                        className={`flex items-center gap-3 rounded-xl border p-3 text-sm cursor-pointer transition-all duration-200 ${
                          isSelected
                            ? 'bg-primary/5 border-primary shadow-xs ring-1 ring-primary'
                            : 'bg-card border-border/70 hover:bg-muted/50 hover:border-border'
                        }`}
                      >
                        <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums shadow-2xs ${rankClass}`}>
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground truncate">{r.name}</span>
                            <TrendIcon trend={r.trend} />
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {r.total_calls} {t('analytics.calls').toLowerCase()}
                            {r.avg_score != null && <> · <span className={`font-semibold ${scoreColor(r.avg_score)}`}>{r.avg_score} pts</span></>}
                            {((r as { solved_problems?: number }).solved_problems ?? 0) > 0 && (
                              <span className="text-emerald-600 font-medium"> · {(r as { solved_problems?: number }).solved_problems ?? 0} {t('analytics.solved')}</span>
                            )}
                            {((r as { unsolved_problems?: number }).unsolved_problems ?? 0) > 0 && (
                              <span className="text-red-500 font-medium"> · {(r as { unsolved_problems?: number }).unsolved_problems ?? 0} {t('analytics.unsolved')}</span>
                            )}
                          </p>
                        </div>
                        {r.best_score != null && (
                          <div className="text-right shrink-0">
                            <span className="text-[10px] text-muted-foreground uppercase block font-semibold">Best</span>
                            <span className={`text-xs font-bold ${scoreColor(r.best_score)}`}>{r.best_score}</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
              </div>
              <div className="lg:col-span-5 w-full border border-border/70 rounded-xl bg-muted/20 p-3 overflow-y-auto max-h-80">
                {selectedEmployee ? (
                  empLoading ? (
                    <div className="flex items-center justify-center h-48 text-xs text-muted-foreground">{t('analytics.loading')}</div>
                  ) : empCalls.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 gap-2 text-xs text-muted-foreground">
                      <p>{t('analytics.no_calls_for', { name: selectedEmployee.name })}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between pb-2 border-b border-border/50">
                        <p className="text-xs font-semibold text-foreground truncate">{selectedEmployee.name}</p>
                        <Badge variant="secondary" className="text-[10px]">{empCalls.length} {t('analytics.calls').toLowerCase()}</Badge>
                      </div>
                      {empCalls.map((c) => (
                        <div key={c.id} className="rounded-lg border border-border/60 bg-card p-2.5 text-xs shadow-2xs hover:border-border transition-colors">
                          <p className="font-semibold truncate text-foreground">{c.name}</p>
                          <div className="flex items-center gap-2 mt-1 text-muted-foreground text-[11px]">
                            {c.analysis?.scorecard?.overall != null && (
                              <span className={`font-semibold ${scoreColor(c.analysis.scorecard.overall)}`}>
                                {c.analysis.scorecard.overall}/100
                              </span>
                            )}
                            {c.client_name && <span className="truncate">· {c.client_name}</span>}
                            {c.duration_sec != null && <span>· {formatDuration(c.duration_sec)}</span>}
                          </div>
                          {c.analysis && 'action_items' in c.analysis && c.analysis.action_items?.[0]?.description && (
                            <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2 bg-muted/40 p-1 rounded">
                              {c.analysis.action_items[0].description}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="flex flex-col items-center justify-center h-48 gap-2 text-xs text-muted-foreground text-center p-4">
                    <Users className="size-8 text-muted-foreground/40 mb-1" />
                    <p>{t('analytics.click_employee')}</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

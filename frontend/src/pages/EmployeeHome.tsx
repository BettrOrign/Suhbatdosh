import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Award,
  CheckCircle2,
  ListTodo,
  PhoneCall,
  Sparkles,
  TrendingUp,
  Trophy,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader } from '@/components/EmptyState'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDate, formatDuration, scoreColor, scoreColorVar } from '@/lib/format'
import { useI18n } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { EmployeeOverview } from '@/lib/types'

const RUBRIC_KEY_MAP: Record<string, string> = {
  opening: 'call.metric.opening',
  discovery: 'call.metric.discovery',
  objection_handling: 'call.metric.objections',
  value_prop: 'call.metric.value_prop',
  closing: 'call.metric.closing',
  rapport: 'call.metric.rapport',
  talk_ratio: 'call.metric.talk_ratio',
}

function scoreColorClass(score: number | null): string {
  if (score === null) return 'text-muted-foreground'
  return scoreColor(score)
}

export function EmployeeHome() {
  const { user } = useAuth()
  const { t } = useI18n()
  const [data, setData] = useState<EmployeeOverview | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setData(await api.getMyOverview())
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const completeTask = async (notificationId: number) => {
    try {
      await api.markNotificationRead(notificationId)
      toast.success(t('emp.task_completed'))
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  if (loading || !data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-20 rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-12">
          <Skeleton className="h-96 rounded-xl lg:col-span-5" />
          <Skeleton className="h-96 rounded-xl lg:col-span-7" />
        </div>
      </div>
    )
  }

  const sortedRubric = [...(data.rubric_averages ?? [])].sort((a, b) => b.avg_score - a.avg_score)
  const strongestSkill = sortedRubric[0]
  const weakestSkill = sortedRubric.length > 1 ? sortedRubric[sortedRubric.length - 1] : null
  const kpis = data.kpis
  const coachingPoints = data.coaching_points ?? []
  const openTasks = data.tasks ?? []
  const recentCalls = data.recent_calls ?? []

  return (
    <div className="space-y-4 pb-12">
      <PageHeader
        eyebrow={t('emp.eyebrow')}
        title={t('emp.greeting', { name: user?.name ?? '' })}
        description={t('emp.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/tasks">
                <ListTodo className="size-3.5" />
                {t('nav.tasks')}
                {kpis.open_tasks_count > 0 && (
                  <Badge variant="default" className="ml-1 text-2xs">
                    {kpis.open_tasks_count}
                  </Badge>
                )}
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/calls">
                <Upload className="size-3.5" />
                {t('dashboard.upload')}
              </Link>
            </Button>
          </div>
        }
      />

      {/* Row 1: 4 Unified Personal KPI Cards */}
      <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="h-full gap-0">
          <CardContent className="flex h-full flex-col justify-between p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                {t('emp.stat.my_avg')}
              </p>
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
                <Award className="size-3.5" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span
                data-numeric
                className={cn(
                  'text-[1.75rem] leading-none font-semibold tracking-[-0.03em] tabular-nums',
                  scoreColorClass(kpis.avg_score)
                )}
              >
                {kpis.avg_score !== null ? kpis.avg_score : '—'}
              </span>
              {data.outcome_metrics?.composite_score !== null && data.outcome_metrics?.composite_score !== undefined ? (
                <span className="text-2xs text-muted-foreground">
                  Outcome: {data.outcome_metrics.composite_score}
                </span>
              ) : (
                kpis.best_score !== null && (
                  <span className="text-2xs text-muted-foreground">
                    {t('emp.stat.best_score', { score: kpis.best_score })}
                  </span>
                )
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="h-full gap-0">
          <CardContent className="flex h-full flex-col justify-between p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                {t('emp.stat.calls_today')}
              </p>
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
                <PhoneCall className="size-3.5" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span
                data-numeric
                className="text-[1.75rem] leading-none font-semibold tracking-[-0.03em] tabular-nums"
              >
                {kpis.calls_today}
              </span>
              <span className="text-2xs text-muted-foreground">
                {t('emp.stat.calls_week', { n: kpis.calls_this_week })}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="h-full gap-0">
          <CardContent className="flex h-full flex-col justify-between p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                {t('emp.stat.peer_rank')}
              </p>
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-warning-soft text-warning">
                <Trophy className="size-3.5" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              {data.rank?.position !== null && data.rank?.position !== undefined ? (
                <>
                  <span
                    data-numeric
                    className="text-[1.75rem] leading-none font-semibold tracking-[-0.03em] tabular-nums text-primary"
                  >
                    #{data.rank.position}
                  </span>
                  <span className="text-2xs text-muted-foreground">
                    {t('emp.stat.rank_of', { total: data.rank.total_peers })}
                  </span>
                </>
              ) : (
                <span className="text-xs font-medium text-muted-foreground">
                  {t('emp.stat.no_rank')}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="h-full gap-0">
          <CardContent className="flex h-full flex-col justify-between p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                {t('emp.stat.open_tasks')}
              </p>
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
                <ListTodo className="size-3.5" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span
                data-numeric
                className="text-[1.75rem] leading-none font-semibold tracking-[-0.03em] tabular-nums"
              >
                {kpis.open_tasks_count}
              </span>
              <Link to="/tasks" className="text-2xs font-medium text-primary hover:underline">
                {t('emp.view_all_tasks')} →
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Locked 12-Column Split Grid (5 cols Skill Breakdown + 7 cols Recent Calls & Coaching) */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
        {/* Left (5 cols): Rubric Skill Breakdown Card */}
        <div className="lg:col-span-5">
          <Card className="flex h-full flex-col">
            <CardHeader className="border-b border-border-subtle pb-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-sm">{t('emp.rubric_title')}</CardTitle>
                  <p className="mt-0.5 text-2xs text-muted-foreground">{t('emp.rubric_desc')}</p>
                </div>
                <TrendingUp className="size-4 text-muted-foreground" />
              </div>
            </CardHeader>

            <CardContent className="flex-1 pt-4">
              {data.rubric_averages.length === 0 ? (
                <div className="flex h-full items-center justify-center py-12 text-center text-xs text-muted-foreground">
                  {t('emp.no_coaching')}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {strongestSkill && (
                      <div className="rounded-lg border border-success/25 bg-success/5 px-3 py-2">
                        <p className="text-2xs font-medium text-success">{t('emp.strength')}</p>
                        <p className="mt-0.5 text-xs font-semibold">
                          {t(RUBRIC_KEY_MAP[strongestSkill.dimension] ?? strongestSkill.dimension)} (
                          {strongestSkill.avg_score})
                        </p>
                      </div>
                    )}
                    {weakestSkill && (
                      <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2">
                        <p className="text-2xs font-medium text-amber-600 dark:text-amber-400">
                          {t('emp.focus_area')}
                        </p>
                        <p className="mt-0.5 text-xs font-semibold">
                          {t(RUBRIC_KEY_MAP[weakestSkill.dimension] ?? weakestSkill.dimension)} (
                          {weakestSkill.avg_score})
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2.5">
                    {data.rubric_averages.map((r) => (
                      <div key={r.dimension} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium">
                            {t(RUBRIC_KEY_MAP[r.dimension] ?? r.dimension)}
                          </span>
                          <span
                            data-numeric
                            className={cn('font-semibold tabular-nums', scoreColorClass(r.avg_score))}
                          >
                            {r.avg_score}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(100, Math.max(4, r.avg_score))}%`,
                              backgroundColor: scoreColorVar(r.avg_score),
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right (7 cols): Tabbed Recent Calls Table + AI Coaching Notes + Open Tasks */}
        <div className="lg:col-span-7">
          <Card className="flex h-full flex-col">
            <Tabs defaultValue="calls" className="flex h-full flex-col gap-0">
              <CardHeader className="flex flex-col gap-2.5 border-b border-border-subtle pb-3 sm:flex-row sm:items-center sm:justify-between">
                <TabsList>
                  <TabsTrigger value="calls">
                    <PhoneCall className="size-3.5 text-primary" />
                    {t('emp.recent_calls_title')}
                  </TabsTrigger>
                  <TabsTrigger value="coaching">
                    <Sparkles className="size-3.5 text-warning" />
                    {t('emp.coaching_title')}
                    {coachingPoints.length > 0 && (
                      <span className="ml-1 rounded-full bg-surface-active px-1.5 text-2xs font-semibold tabular-nums text-muted-foreground">
                        {coachingPoints.length}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="tasks">
                    <ListTodo className="size-3.5 text-chart-6" />
                    {t('emp.tasks_title')}
                    {openTasks.length > 0 && (
                      <span className="ml-1 rounded-full bg-surface-active px-1.5 text-2xs font-semibold tabular-nums text-muted-foreground">
                        {openTasks.length}
                      </span>
                    )}
                  </TabsTrigger>
                </TabsList>

                <Link
                  to="/calls"
                  className="inline-flex items-center gap-1 text-2xs font-medium text-primary hover:underline"
                >
                  {t('emp.view_all_calls')}
                  <ArrowRight className="size-3" />
                </Link>
              </CardHeader>

              <CardContent className="flex-1 p-0">
                {/* Tab 1: Metasell Recent Calls Data Table */}
                <TabsContent value="calls" className="m-0">
                  {recentCalls.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-12 text-center">
                      <p className="text-xs text-muted-foreground">{t('dashboard.no_calls_desc')}</p>
                      <Button asChild size="sm">
                        <Link to="/calls">{t('dashboard.upload_first')}</Link>
                      </Button>
                    </div>
                  ) : (
                    <div
                      role="region"
                      aria-label={t('emp.recent_calls_title')}
                      tabIndex={0}
                      className="max-h-[380px] overflow-auto [overscroll-behavior:contain] [scrollbar-gutter:stable]"
                    >
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 z-10 border-b border-border-subtle bg-surface-sunken text-left text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                          <tr>
                            <th className="px-4 py-2.5">{t('calls.table.call')}</th>
                            <th className="px-3 py-2.5">{t('calls.table.score')}</th>
                            <th className="hidden px-3 py-2.5 sm:table-cell">
                              {t('calls.table.duration')}
                            </th>
                            <th className="px-4 py-2.5 text-right">{t('calls.table.date')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-subtle">
                          {recentCalls.map((c) => {
                            const callScore =
                              typeof c.analysis?.scorecard?.overall === 'number'
                                ? Math.round(c.analysis.scorecard.overall)
                                : null
                            return (
                              <tr
                                key={c.id}
                                className="transition-colors hover:bg-surface-hover"
                              >
                                <td className="px-4 py-2.5">
                                  <Link
                                    to={`/calls/${c.id}`}
                                    className="block max-w-[240px] truncate text-xs font-semibold text-foreground hover:text-primary"
                                  >
                                    {c.name}
                                  </Link>
                                </td>
                                <td className="px-3 py-2.5">
                                  {callScore !== null ? (
                                    <div className="flex items-center gap-2">
                                      <span
                                        data-numeric
                                        className={cn(
                                          'w-7 text-xs font-semibold tabular-nums',
                                          scoreColorClass(callScore)
                                        )}
                                      >
                                        {callScore}
                                      </span>
                                      <div className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-surface-sunken sm:block">
                                        <div
                                          className="h-full rounded-full"
                                          style={{
                                            width: `${Math.max(4, Math.min(100, callScore))}%`,
                                            backgroundColor: scoreColorVar(callScore),
                                          }}
                                        />
                                      </div>
                                    </div>
                                  ) : (
                                    <Badge variant="secondary" className="text-2xs">
                                      {t(`status.${c.status}`)}
                                    </Badge>
                                  )}
                                </td>
                                <td className="hidden px-3 py-2.5 text-xs tabular-nums text-muted-foreground sm:table-cell">
                                  {c.duration_sec !== null ? formatDuration(c.duration_sec) : '—'}
                                </td>
                                <td className="px-4 py-2.5 text-right text-2xs text-muted-foreground">
                                  {formatDate(c.created_at)}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </TabsContent>

                {/* Tab 2: Recent AI Coaching Notes */}
                <TabsContent value="coaching" className="m-0 p-4">
                  {coachingPoints.length === 0 ? (
                    <p className="py-10 text-center text-xs text-muted-foreground">
                      {t('emp.no_coaching')}
                    </p>
                  ) : (
                    <ul className="max-h-[340px] space-y-2.5 overflow-y-auto pr-1 [overscroll-behavior:contain] [scrollbar-gutter:stable]">
                      {coachingPoints.map((pt, idx) => (
                        <li
                          key={`${pt.call_id}-${idx}`}
                          className="rounded-lg border border-border-subtle bg-surface-sunken/70 p-3 text-xs"
                        >
                          <p className="leading-relaxed text-foreground">{pt.point}</p>
                          <div className="mt-2 flex items-center justify-between text-2xs text-muted-foreground">
                            <Link
                              to={`/calls/${pt.call_id}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {pt.call_title} →
                            </Link>
                            <span>{formatDate(pt.created_at)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                {/* Tab 3: Open Follow-Up Tasks */}
                <TabsContent value="tasks" className="m-0 p-4">
                  {openTasks.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-center">
                      <CheckCircle2 className="size-6 text-success" />
                      <p className="text-xs text-muted-foreground">{t('emp.no_open_tasks')}</p>
                    </div>
                  ) : (
                    <ul className="max-h-[340px] space-y-2 overflow-y-auto pr-1 [overscroll-behavior:contain] [scrollbar-gutter:stable]">
                      {openTasks.map((task) => (
                        <li
                          key={task.id}
                          className="flex items-start justify-between gap-3 rounded-lg border border-border-subtle bg-surface-sunken/60 p-3 text-xs"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-foreground">{task.title}</p>
                            <p className="mt-0.5 text-muted-foreground">{task.message}</p>
                            {task.call_id && (
                              <Link
                                to={`/calls/${task.call_id}`}
                                className="mt-1.5 inline-block text-2xs font-medium text-primary hover:underline"
                              >
                                {t('tasks.open_call')} #{task.call_id} →
                              </Link>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void completeTask(task.id)}
                          >
                            <CheckCircle2 className="size-3.5 text-success" />
                            {t('emp.mark_done')}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default EmployeeHome

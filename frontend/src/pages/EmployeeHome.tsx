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
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/EmptyState'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDate, formatDuration, scoreColor } from '@/lib/format'
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
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-24 rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    )
  }

  const sortedRubric = [...data.rubric_averages].sort((a, b) => b.avg_score - a.avg_score)
  const strongestSkill = sortedRubric[0]
  const weakestSkill = sortedRubric.length > 1 ? sortedRubric[sortedRubric.length - 1] : null

  return (
    <div className="space-y-6 pb-12">
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
                {data.open_tasks_count > 0 && (
                  <Badge variant="default" className="ml-1 text-2xs">
                    {data.open_tasks_count}
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

      {/* 4 Personal KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-e1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('emp.stat.my_avg')}</span>
            <Award className="size-4 text-primary" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              data-numeric
              className={cn('text-3xl font-bold tracking-tight', scoreColorClass(data.avg_score))}
            >
              {data.avg_score !== null ? data.avg_score : '—'}
            </span>
            {data.best_score !== null && (
              <span className="text-xs text-muted-foreground">
                {t('emp.stat.best_score', { score: data.best_score })}
              </span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-e1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('emp.stat.calls_today')}</span>
            <PhoneCall className="size-4 text-primary" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span data-numeric className="text-3xl font-bold tracking-tight">
              {data.calls_today}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('emp.stat.calls_week', { n: data.calls_week })}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-e1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('emp.stat.peer_rank')}</span>
            <Trophy className="size-4 text-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            {data.rank !== null ? (
              <>
                <span data-numeric className="text-3xl font-bold tracking-tight text-primary">
                  #{data.rank}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('emp.stat.rank_of', { total: data.total_peers })}
                </span>
              </>
            ) : (
              <span className="text-sm font-medium text-muted-foreground">
                {t('emp.stat.no_rank')}
              </span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-e1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('emp.stat.open_tasks')}</span>
            <ListTodo className="size-4 text-primary" />
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span data-numeric className="text-3xl font-bold tracking-tight">
              {data.open_tasks_count}
            </span>
            <Link to="/tasks" className="text-xs font-medium text-primary hover:underline">
              {t('emp.view_all_tasks')} →
            </Link>
          </div>
        </div>
      </div>

      {/* Skill Breakdown + 7-Day Trend */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Rubric Skill Breakdown */}
        <section className="rounded-xl border border-border bg-surface p-5 shadow-e1">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">{t('emp.rubric_title')}</h2>
              <p className="text-xs text-muted-foreground">{t('emp.rubric_desc')}</p>
            </div>
            <TrendingUp className="size-4 text-muted-foreground" />
          </div>

          {data.rubric_averages.length === 0 ? (
            <p className="mt-6 py-6 text-center text-xs text-muted-foreground">
              {t('emp.no_coaching')}
            </p>
          ) : (
            <>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
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

              <div className="mt-4 space-y-2.5">
                {data.rubric_averages.map((r) => (
                  <div key={r.dimension} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">
                        {t(RUBRIC_KEY_MAP[r.dimension] ?? r.dimension)}
                      </span>
                      <span data-numeric className={cn('font-semibold', scoreColorClass(r.avg_score))}>
                        {r.avg_score}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          r.avg_score >= 70
                            ? 'bg-success'
                            : r.avg_score >= 40
                              ? 'bg-amber-500'
                              : 'bg-destructive',
                        )}
                        style={{ width: `${Math.min(100, Math.max(4, r.avg_score))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* Recent AI Coaching Notes */}
        <section className="rounded-xl border border-border bg-surface p-5 shadow-e1">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">{t('emp.coaching_title')}</h2>
              <p className="text-xs text-muted-foreground">{t('emp.coaching_desc')}</p>
            </div>
            <Sparkles className="size-4 text-primary" />
          </div>

          {data.recent_coaching_points.length === 0 ? (
            <p className="mt-6 py-8 text-center text-xs text-muted-foreground">
              {t('emp.no_coaching')}
            </p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {data.recent_coaching_points.map((pt, idx) => (
                <li
                  key={`${pt.call_id}-${idx}`}
                  className="rounded-lg border border-border-subtle bg-surface-sunken/70 p-3 text-xs"
                >
                  <p className="leading-relaxed text-foreground">{pt.text}</p>
                  <div className="mt-2 flex items-center justify-between text-2xs text-muted-foreground">
                    <Link
                      to={`/calls/${pt.call_id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {pt.call_name} →
                    </Link>
                    <span>{formatDate(pt.created_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Open Tasks + Recent Calls */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Open Follow-up Tasks */}
        <section className="rounded-xl border border-border bg-surface p-5 shadow-e1">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">{t('emp.tasks_title')}</h2>
              <p className="text-xs text-muted-foreground">{t('emp.tasks_desc')}</p>
            </div>
            <Link
              to="/tasks"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {t('emp.view_all_tasks')}
              <ArrowRight className="size-3.5" />
            </Link>
          </div>

          {data.open_tasks.length === 0 ? (
            <div className="mt-6 flex flex-col items-center gap-2 py-8 text-center">
              <CheckCircle2 className="size-6 text-success" />
              <p className="text-xs text-muted-foreground">{t('emp.no_open_tasks')}</p>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {data.open_tasks.map((task) => (
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
        </section>

        {/* Recent Calls */}
        <section className="rounded-xl border border-border bg-surface p-5 shadow-e1">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">{t('emp.recent_calls_title')}</h2>
              <p className="text-xs text-muted-foreground">{t('emp.trend_title')}</p>
            </div>
            <Link
              to="/calls"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {t('emp.view_all_calls')}
              <ArrowRight className="size-3.5" />
            </Link>
          </div>

          {data.recent_calls.length === 0 ? (
            <div className="mt-6 flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-xs text-muted-foreground">{t('dashboard.no_calls_desc')}</p>
              <Button asChild size="sm">
                <Link to="/calls">{t('dashboard.upload_first')}</Link>
              </Button>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-border-subtle">
              {data.recent_calls.map((c) => (
                <li key={c.id} className="py-2.5 first:pt-0 last:pb-0">
                  <Link
                    to={`/calls/${c.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-foreground">{c.name}</p>
                      <div className="mt-0.5 flex items-center gap-2 text-2xs text-muted-foreground">
                        <span>{formatDate(c.created_at)}</span>
                        {c.duration_sec !== null && <span>· {formatDuration(c.duration_sec)}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {c.score !== null ? (
                        <Badge
                          variant={
                            c.score >= 70 ? 'success' : c.score >= 40 ? 'outline' : 'secondary'
                          }
                          data-numeric
                        >
                          {c.score}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-2xs">
                          {t(`status.${c.status}`)}
                        </Badge>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

export default EmployeeHome

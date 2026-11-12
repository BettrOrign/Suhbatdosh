import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCheck, CheckCircle2, ExternalLink, ListTodo } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/EmptyState'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { useI18n } from '@/i18n/i18n'
import type { Notification } from '@/lib/types'

export function MyTasks() {
  const { t } = useI18n()
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'open' | 'completed' | 'all'>('open')

  const load = useCallback(async () => {
    try {
      setItems(await api.listNotifications(false, 100))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const markDone = async (id: number) => {
    try {
      await api.markNotificationRead(id)
      toast.success(t('emp.task_completed'))
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const markAllDone = async () => {
    try {
      await api.markAllNotificationsRead()
      toast.success(t('emp.task_completed'))
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const openCount = items.filter((n) => !n.read).length
  const filtered = items.filter((n) => {
    if (filter === 'open') return !n.read
    if (filter === 'completed') return n.read
    return true
  })

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        eyebrow={t('tasks.eyebrow')}
        title={t('tasks.title')}
        description={t('tasks.desc')}
        actions={
          openCount > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void markAllDone()}>
              <CheckCheck className="size-3.5" />
              {t('notifications.mark_all_read')}
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {(['open', 'completed', 'all'] as const).map((key) => (
          <Button
            key={key}
            type="button"
            variant={filter === key ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(key)}
          >
            {key === 'open'
              ? t('tasks.filter.open', { n: openCount })
              : t(`tasks.filter.${key}`)}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-surface px-6 py-16 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-surface-sunken">
            <ListTodo className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold">{t('emp.no_open_tasks')}</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((item) => {
            const priority = typeof item.metadata?.priority === 'string' ? item.metadata.priority : null
            const dueDate = typeof item.metadata?.due_date === 'string' ? item.metadata.due_date : null
            return (
              <div
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-surface p-4 shadow-e1"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{item.title}</p>
                    {priority && (
                      <Badge
                        variant={priority === 'high' ? 'default' : 'secondary'}
                        className="text-2xs uppercase"
                      >
                        {priority}
                      </Badge>
                    )}
                    {dueDate && (
                      <Badge variant="outline" className="text-2xs">
                        {t('notifications.due', { date: dueDate })}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.message}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-2xs text-muted-foreground">
                    <span>{formatDate(item.created_at)}</span>
                    {item.call_id && (
                      <Link
                        to={`/calls/${item.call_id}`}
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        {t('tasks.open_call')} #{item.call_id}
                        <ExternalLink className="size-3" />
                      </Link>
                    )}
                  </div>
                </div>

                {!item.read ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void markDone(item.id)}
                  >
                    <CheckCircle2 className="size-3.5 text-success" />
                    {t('emp.mark_done')}
                  </Button>
                ) : (
                  <Badge variant="secondary" className="text-2xs">
                    <CheckCircle2 className="mr-1 size-3 text-success" />
                    {t('emp.mark_done')}
                  </Badge>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default MyTasks

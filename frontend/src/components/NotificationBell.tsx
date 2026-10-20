import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, Check, Clock, TriangleAlert, UserRound } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/lib/format'
import { useI18n } from '@/i18n/i18n'
import { api } from '@/lib/api'
import { fadeUp } from '@/lib/motion'
import { cn } from '@/lib/utils'
import type { Notification } from '@/lib/types'

const TYPE_ICONS: Record<string, typeof Bell> = { action_item: TriangleAlert }

function NotificationItem({
  notification,
  onOpen,
  onRead,
}: {
  notification: Notification
  onOpen: () => void
  onRead: () => void
}) {
  const { t } = useI18n()
  const Icon = TYPE_ICONS[notification.type] ?? Bell
  const meta = notification.metadata as { priority?: string; due_date?: string; assignee?: string }
  const priority = meta?.priority ?? 'medium'
  const unread = !notification.read

  return (
    <motion.li variants={fadeUp} layout className="list-none">
      {/* A bare onClick div: the primary action (open the call) was reachable
          with a mouse only — no role, no tabIndex, no key handler. */}
      <div
        role="button"
        tabIndex={0}
        className={cn(
          'group/n flex cursor-pointer gap-2.5 rounded-md p-2.5 ring-1 transition-colors duration-150',
          'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          unread ? 'bg-primary-soft/40 ring-primary/20' : 'bg-transparent ring-transparent hover:bg-surface-hover'
        )}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        aria-label={notification.title}
      >
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset',
            unread
              ? 'bg-primary-soft text-primary-soft-foreground ring-primary/20'
              : 'bg-surface-sunken text-muted-foreground ring-border-subtle'
          )}
        >
          <Icon aria-hidden="true" className="size-3.5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className={cn('min-w-0 flex-1 text-xs leading-snug', unread ? 'font-semibold' : 'font-medium')}>
              {notification.title}
            </p>
            {unread && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(e) => {
                  e.stopPropagation()
                  onRead()
                }}
                onKeyDown={(e) => {
                  // Otherwise Enter/Space here bubbles to the row and opens the
                  // call instead of marking it read.
                  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
                }}
                aria-label={t('notifications.mark_read')}
              >
                <Check aria-hidden="true" className="size-3 text-success" />
              </Button>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{notification.message}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-2xs text-muted-foreground">{formatDate(notification.created_at)}</span>
            {meta?.due_date && (
              <Badge variant="outline" className="h-4 gap-1 text-2xs">
                <Clock aria-hidden="true" className="size-2.5" />
                {t('notifications.due', { date: formatDate(meta.due_date) })}
              </Badge>
            )}
            {meta?.assignee && (
              <Badge variant="outline" className="h-4 gap-1 text-2xs">
                <UserRound aria-hidden="true" className="size-2.5" />
                {meta.assignee}
              </Badge>
            )}
            <Badge
              variant={priority === 'high' ? 'destructive' : priority === 'low' ? 'secondary' : 'warning'}
              className="h-4 text-2xs"
            >
              {t(`notifications.priority_${priority}`)}
            </Badge>
          </div>
        </div>
      </div>
    </motion.li>
  )
}

export function NotificationBell() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const fetching = useRef(false)
  /**
   * Bumped by every local mutation (mark read / read all). A poll that started
   * before the bump and resolves after it carries a pre-mutation count, which
   * used to overwrite the optimistic decrement and leave the badge too high
   * until the next 30s tick. Such a response is dropped instead.
   */
  const mutations = useRef(0)

  const fetchAll = useCallback(async () => {
    if (fetching.current) return
    fetching.current = true
    try {
      const [notifs, count] = await Promise.all([
        api.listNotifications(false, 20),
        api.getUnreadCount(),
      ])
      setNotifications(notifs)
      setUnreadCount(count.count)
    } catch {
      /* the bell must never break the shell */
    } finally {
      fetching.current = false
      setLoading(false)
    }
  }, [])

  const fetchCount = useCallback(async () => {
    const stamp = mutations.current
    try {
      const { count } = await api.getUnreadCount()
      if (mutations.current !== stamp) return
      setUnreadCount(count)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void fetchAll()
    const interval = window.setInterval(fetchCount, 30000)
    return () => window.clearInterval(interval)
  }, [fetchAll, fetchCount])

  const handleRead = useCallback(async (id: number) => {
    try {
      await api.markNotificationRead(id)
      mutations.current += 1
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
      setUnreadCount((prev) => Math.max(0, prev - 1))
    } catch {
      /* ignore */
    }
  }, [])

  const handleReadAll = useCallback(async () => {
    try {
      await api.markAllNotificationsRead()
      mutations.current += 1
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
      setUnreadCount(0)
    } catch {
      /* ignore */
    }
  }, [])

  const handleOpen = useCallback(
    (n: Notification) => {
      if (!n.read) void handleRead(n.id)
      if (n.call_id) navigate(`/calls/${n.call_id}`)
      setOpen(false)
    },
    [handleRead, navigate]
  )

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) void fetchAll()
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('notifications.title')} className="relative">
          <Bell aria-hidden="true" className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground tabular-nums">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="flex max-h-[calc(100dvh-4rem)] w-[calc(100vw-2rem)] flex-col overflow-hidden p-0 sm:w-88"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
          <p className="truncate text-xs font-semibold">{t('notifications.title')}</p>
          {unreadCount > 0 && (
            <Button variant="ghost" size="xs" onClick={() => void handleReadAll()}>
              <Check aria-hidden="true" className="size-3" />
              {t('notifications.mark_all_read')}
            </Button>
          )}
        </div>
        <ScrollArea className="h-[min(400px,calc(100dvh-12rem))] p-1.5">
          {loading ? (
            <div className="space-y-2 p-1" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-md" />
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <Bell aria-hidden="true" className="size-6 opacity-40" />
              <p className="text-xs">{t('notifications.empty')}</p>
            </div>
          ) : (
            <ul className="space-y-0.5">
              <AnimatePresence initial={false}>
                {notifications.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    onOpen={() => handleOpen(n)}
                    onRead={() => void handleRead(n.id)}
                  />
                ))}
              </AnimatePresence>
            </ul>
          )}
        </ScrollArea>
      </DropdownMenuContent>
      <span className="sr-only" role="status" aria-live="polite">
        {unreadCount > 0 ? t('notifications.unread_count', { n: unreadCount }) : ''}
      </span>
    </DropdownMenu>
  )
}

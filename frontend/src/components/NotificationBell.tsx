import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, Check, Clock, AlertTriangle, User } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatDate } from '@/lib/format'
import { useI18n } from '@/i18n/i18n'
import { api } from '@/lib/api'
import type { Notification } from '@/lib/types'

const TYPE_ICONS: Record<string, typeof Bell> = {
  action_item: AlertTriangle,
}

const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-destructive/10 text-destructive border-destructive/20',
  medium: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800/50',
  low: 'bg-muted text-muted-foreground border-border',
}

function NotificationItem({ notification, onClick, onRead }: { notification: Notification; onClick: () => void; onRead: () => void }) {
  const { t } = useI18n()
  const Icon = TYPE_ICONS[notification.type] || Bell
  const priority = (notification.metadata?.priority as string) || 'medium'
  const dueDate = notification.metadata?.due_date as string | undefined
  const assignee = notification.metadata?.assignee as string | undefined

  return (
    <motion.div
      key={notification.id}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      className={`mb-2 flex cursor-pointer gap-3 rounded-xl border p-3 transition-all last:mb-0 ${
        notification.read ? 'bg-muted/30' : 'bg-primary/5 border-primary/20'
      }`}
      onClick={onClick}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`min-w-0 text-sm ${notification.read ? 'font-medium' : 'font-semibold'} text-foreground`}>
            {notification.title}
          </p>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {dueDate && (
              <Badge variant="outline" className="text-xs gap-1 px-2 py-0.5">
                <Clock className="size-2.5" />
                {t('notifications.due', { date: formatDate(dueDate) })}
              </Badge>
            )}
            {assignee && (
              <Badge variant="outline" className="text-xs gap-1 px-2 py-0.5">
                <User className="size-2.5" />
                {t('notifications.assignee', { assignee })}
              </Badge>
            )}
            <Badge
              variant="outline"
              className={`text-xs gap-1 px-2 py-0.5 ${PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium}`}
            >
              {t(`notifications.priority_${priority}`)}
            </Badge>
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{notification.message}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">{formatDate(notification.created_at)}</p>
      </div>
      {!notification.read && (
        <Button variant="ghost" size="icon-sm" onClick={(e) => { e.stopPropagation(); onRead(); }}>
          <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
        </Button>
      )}
    </motion.div>
  )
}

export function NotificationBell() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const fetchNotifications = async () => {
    try {
      const [notifs, count] = await Promise.all([
        api.listNotifications(false, 20),
        api.getUnreadCount(),
      ])
      setNotifications(notifs)
      setUnreadCount(count.count)
    } catch (e) {
      console.error('Failed to fetch notifications:', e)
    } finally {
      setLoading(false)
    }
  }

  const fetchUnreadCount = async () => {
    try {
      const count = await api.getUnreadCount()
      setUnreadCount(count.count)
    } catch (e) {
      console.error('Failed to fetch unread count:', e)
    }
  }

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchUnreadCount, 30000)
    return () => clearInterval(interval)
  }, [])

  const handleRead = async (id: number) => {
    try {
      await api.markNotificationRead(id)
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
      setUnreadCount((prev) => Math.max(0, prev - 1))
    } catch (e) {
      console.error('Failed to mark notification read:', e)
    }
  }

  const handleReadAll = async () => {
    try {
      await api.markAllNotificationsRead()
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
      setUnreadCount(0)
    } catch (e) {
      console.error('Failed to mark all read:', e)
    }
  }

  const handleItemClick = (notification: Notification) => {
    if (!notification.read) {
      handleRead(notification.id)
    }
    if (notification.call_id) {
      navigate(`/calls/${notification.call_id}`)
    }
    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={(o: boolean) => { setOpen(o); if (o) fetchNotifications() }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="size-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={dropdownRef}
        align="end"
        className="max-h-[calc(100dvh-4rem)] w-[calc(100vw-2rem)] overflow-hidden p-0 sm:w-96"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b px-4 py-3">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">{t('notifications.title')}</p>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={handleReadAll}>
              <Check className="size-3.5" />
              {t('notifications.mark_all_read')}
            </Button>
          )}
        </div>
        <ScrollArea className="h-[min(400px,calc(100dvh-12rem))] p-2">
          <AnimatePresence>
            {loading ? (
              <div key="loading" className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
              </div>
            ) : notifications.length === 0 ? (
              <div key="empty" className="flex flex-col items-center justify-center gap-2 h-32 text-muted-foreground">
                <Bell className="size-8 opacity-50" />
                <p className="text-sm">{t('notifications.empty')}</p>
              </div>
            ) : (
              notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onClick={() => handleItemClick(n)}
                  onRead={() => handleRead(n.id)}
                />
              ))
            )}
          </AnimatePresence>
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/EmptyState'
import { PeopleDenied } from '@/components/people/PeopleDenied'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/i18n'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDate } from '@/lib/format'
import { Reveal } from '@/lib/motion'
import type { TelegramMessage } from '@/lib/types'
import { cn } from '@/lib/utils'

type FilterMode = 'all' | 'pending' | 'replied'

export default function TelegramPage() {
  const { user } = useAuth()
  const { t } = useI18n()
  const [msgs, setMsgs] = useState<TelegramMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<number | null>(null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterMode>('all')

  const canView =
    user?.role === 'admin' || user?.role === 'receptionist' || user?.role === 'yonalish'

  const loadMessages = useCallback(
    (showSpinner = false) => {
      if (!canView) return
      if (showSpinner) setLoading(true)
      api
        .listTelegramMessages()
        .then((d) => setMsgs(d))
        .catch(() => setMsgs([]))
        .finally(() => setLoading(false))
    },
    [canView],
  )

  useEffect(() => {
    loadMessages(true)
    const timer = setInterval(() => loadMessages(false), 10000)
    return () => clearInterval(timer)
  }, [loadMessages])

  const allClients = useMemo(() => {
    const map = new Map<number, TelegramMessage[]>()
    for (const m of msgs) {
      if (m.is_bot || m.is_staff) continue
      const key = m.user_id ?? m.chat_id
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(m)
    }
    return [...map.entries()].map(([id, ms]) => {
      const sorted = [...ms].sort((a, b) => a.id - b.id)
      const latest = sorted[sorted.length - 1]
      const hasPending = sorted.some((m) => !m.reply_text)
      return {
        id,
        name: latest.full_name || latest.username || 'Unknown',
        username: latest.username,
        photo: latest.photo_url,
        msgs: sorted,
        latestMsg: latest,
        hasPending,
      }
    })
  }, [msgs])

  const counts = useMemo(() => {
    const pending = allClients.filter((c) => c.hasPending).length
    return {
      all: allClients.length,
      pending,
      replied: allClients.length - pending,
    }
  }, [allClients])

  const clients = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allClients.filter((c) => {
      if (filter === 'pending' && !c.hasPending) return false
      if (filter === 'replied' && c.hasPending) return false
      if (!q) return true
      return (
        c.name.toLowerCase().includes(q) ||
        (c.username && c.username.toLowerCase().includes(q)) ||
        c.msgs.some(
          (m) =>
            (m.text && m.text.toLowerCase().includes(q)) ||
            (m.reply_text && m.reply_text.toLowerCase().includes(q)),
        )
      )
    })
  }, [allClients, filter, search])

  const active = clients.find((c) => c.id === selected) ?? clients[0]

  async function handleSend() {
    const text = reply.trim()
    if (!text || !active || active.msgs.length === 0 || sending) return
    const unanswered = [...active.msgs].reverse().find((m) => !m.reply_text)
    const targetMsg = unanswered ?? active.msgs[active.msgs.length - 1]
    setSending(true)
    try {
      const updated = await api.replyTelegramMessage(targetMsg.id, text)
      setMsgs((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
      setReply('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send reply')
    } finally {
      setSending(false)
    }
  }

  if (!canView) {
    return <PeopleDenied />
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="TELEGRAM"
        title={t('telegram.title')}
        description={t('telegram.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5 py-1">
              <span className="size-1.5 rounded-full bg-warning" />
              {counts.pending} {t('telegram.filter.pending')}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadMessages(true)}
              disabled={loading}
            >
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            </Button>
          </div>
        }
      />

      <Reveal>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
          {/* Sidebar: Search + Filter + Client Thread List */}
          <Card className="flex h-[calc(100dvh-14rem)] min-h-[480px] flex-col overflow-hidden">
            <div className="space-y-2.5 border-b border-border-subtle p-3">
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('telegram.search')}
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-sunken p-1">
                {(['all', 'pending', 'replied'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setFilter(mode)}
                    className={cn(
                      'flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-2xs font-medium transition-all',
                      filter === mode
                        ? 'bg-surface text-foreground shadow-xs ring-1 ring-border-subtle'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <span>{t(`telegram.filter.${mode}`)}</span>
                    <span className="rounded-full bg-surface-active px-1.5 text-[10px] tabular-nums">
                      {counts[mode]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 space-y-1.5 overflow-y-auto p-2.5">
              <AnimatePresence initial={false}>
                {clients.map((c) => {
                  const isSelected = active?.id === c.id
                  return (
                    <motion.button
                      key={c.id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      type="button"
                      onClick={() => setSelected(c.id)}
                      className={cn(
                        'group relative flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all',
                        isSelected
                          ? 'border-primary/40 bg-primary-soft/60 shadow-xs'
                          : 'border-transparent hover:border-border hover:bg-surface-hover',
                      )}
                    >
                      <div className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent-foreground text-xs font-semibold text-primary-foreground shadow-xs">
                        {c.photo ? (
                          <img
                            src={c.photo}
                            alt=""
                            className="size-10 rounded-full object-cover"
                          />
                        ) : (
                          c.name.charAt(0).toUpperCase()
                        )}
                        {c.hasPending && (
                          <span
                            aria-hidden="true"
                            className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-warning ring-2 ring-surface"
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1.5">
                          <p className="truncate text-xs font-semibold text-foreground">
                            {c.name}
                          </p>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                            {formatDate(c.latestMsg.created_at)}
                          </span>
                        </div>
                        {c.username && (
                          <p className="truncate text-2xs text-primary">@{c.username}</p>
                        )}
                        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                          {c.latestMsg.text}
                        </p>
                      </div>
                    </motion.button>
                  )
                })}
              </AnimatePresence>

              {clients.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
                  <div className="icon-well">
                    <MessageSquare aria-hidden="true" className="size-4" />
                  </div>
                  <p className="text-xs text-muted-foreground">{t('telegram.no_clients')}</p>
                </div>
              )}
            </div>
          </Card>

          {/* Main Conversation Panel */}
          <Card className="flex h-[calc(100dvh-14rem)] min-h-[480px] flex-col overflow-hidden">
            {active ? (
              <>
                <header className="flex items-center justify-between gap-3 border-b border-border-subtle bg-surface/60 px-5 py-3.5 backdrop-blur-xs">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent-foreground text-xs font-semibold text-primary-foreground shadow-xs">
                      {active.photo ? (
                        <img
                          src={active.photo}
                          alt=""
                          className="size-10 rounded-full object-cover"
                        />
                      ) : (
                        active.name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{active.name}</p>
                        <Badge
                          variant={active.hasPending ? 'warning' : 'success'}
                          className="text-[10px]"
                        >
                          {active.hasPending
                            ? t('telegram.pending_badge')
                            : t('telegram.replied_badge')}
                        </Badge>
                      </div>
                      {active.username && (
                        <p className="text-2xs text-muted-foreground">@{active.username}</p>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className="font-mono text-2xs">
                    {active.msgs.length} msg
                  </Badge>
                </header>

                <CardContent className="flex-1 space-y-4 overflow-y-auto p-5">
                  {active.msgs.map((m, idx) => (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(idx * 0.03, 0.2) }}
                      className="space-y-2.5"
                    >
                      {/* Client Question Bubble */}
                      <div className="flex flex-col items-start gap-1">
                        <div className="max-w-[82%] rounded-2xl rounded-tl-xs bg-surface-sunken px-4 py-2.5 text-sm leading-relaxed text-foreground ring-1 ring-border-subtle ring-inset">
                          {m.text}
                        </div>
                        <span className="inline-flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
                          <Clock aria-hidden="true" className="size-2.5" />
                          {formatDate(m.created_at)}
                        </span>
                      </div>

                      {/* Staff Reply Bubble */}
                      {m.reply_text && (
                        <div className="flex flex-col items-end gap-1">
                          <div className="gradient-surface max-w-[82%] rounded-2xl rounded-tr-xs px-4 py-2.5 text-sm leading-relaxed shadow-xs">
                            {m.reply_text}
                          </div>
                          <span className="inline-flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
                            <CheckCircle2 aria-hidden="true" className="size-2.5 text-success" />
                            {m.replied_at ? formatDate(m.replied_at) : t('telegram.replied_badge')}
                          </span>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </CardContent>

                <footer className="border-t border-border-subtle bg-surface-sunken/50 p-3.5">
                  <div className="flex items-center gap-2">
                    <Input
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void handleSend()
                        }
                      }}
                      placeholder={t('telegram.reply_placeholder')}
                      disabled={sending}
                      className="bg-surface text-sm"
                    />
                    <Button
                      disabled={sending || !reply.trim()}
                      onClick={() => void handleSend()}
                      className="shrink-0 gap-1.5"
                    >
                      {sending ? (
                        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                      ) : (
                        <Send aria-hidden="true" className="size-3.5" />
                      )}
                      {sending ? t('telegram.sending') : t('telegram.send')}
                    </Button>
                  </div>
                </footer>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <div className="icon-well size-12">
                  <Sparkles aria-hidden="true" className="size-5" />
                </div>
                <p className="text-sm font-medium text-foreground">{t('telegram.title')}</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  {t('telegram.select_client')}
                </p>
              </div>
            )}
          </Card>
        </div>
      </Reveal>
    </div>
  )
}

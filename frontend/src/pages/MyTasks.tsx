import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCheck,
  CheckCircle2,
  ExternalLink,
  ListTodo,
  MessageSquare,
  Send,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { useI18n } from '@/i18n/i18n'
import type { EmployeeActionQueue, Notification } from '@/lib/types'

export function MyTasks() {
  const { t, lang } = useI18n()
  const isUz = lang === 'uz'
  const [queue, setQueue] = useState<EmployeeActionQueue | null>(null)
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [escNotes, setEscNotes] = useState<Record<number, string>>({})
  const [tgReplies, setTgReplies] = useState<Record<number, string>>({})

  const load = useCallback(async () => {
    try {
      const [q, notifs] = await Promise.all([
        api.getMyActions(),
        api.listNotifications(false, 100),
      ])
      setQueue(q)
      setItems(notifs)
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

  const resolveEsc = async (escId: number) => {
    try {
      await api.resolveEscalation(escId, escNotes[escId] ?? '')
      toast.success(isUz ? 'Eskalatsiya hal qilindi' : 'Escalation resolved')
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const advanceLead = async (clientId: number, stage: 'consulted' | 'test_scheduled') => {
    try {
      await api.updateClient(clientId, { pipeline_stage: stage })
      toast.success(isUz ? 'Mijoz bosqichi yangilandi' : 'Lead stage updated')
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const replyTg = async (msgId: number) => {
    const text = (tgReplies[msgId] ?? '').trim()
    if (!text) return
    try {
      await api.replyTelegramMessage(msgId, text)
      toast.success(isUz ? 'Javob yuborildi' : 'Reply sent')
      setTgReplies((prev) => ({ ...prev, [msgId]: '' }))
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const openEsc = queue?.open_escalations ?? []
  const dueLeads = queue?.due_leads ?? []
  const unansweredTg = queue?.unanswered_telegram ?? []
  const openNotifs = items.filter((n) => !n.read)
  const metrics = queue?.outcome_metrics

  return (
    <div className="space-y-4 pb-12">
      <PageHeader
        eyebrow={t('tasks.eyebrow')}
        title={t('tasks.title')}
        description={t('tasks.desc')}
        actions={
          openNotifs.length > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void markAllDone()}>
              <CheckCheck className="size-3.5" />
              {t('notifications.mark_all_read')}
            </Button>
          ) : undefined
        }
      />

      {metrics && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="p-3.5">
              <p className="text-2xs text-muted-foreground">
                {isUz ? 'Natija bali' : 'Outcome Score'}
              </p>
              <p data-numeric className="mt-1 text-xl font-semibold tabular-nums">
                {metrics.outcome_score ?? '—'}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3.5">
              <p className="text-2xs text-muted-foreground">
                {isUz ? 'Lid konversiyasi' : 'Lead Conversion'}
              </p>
              <p data-numeric className="mt-1 text-xl font-semibold tabular-nums">
                {metrics.lead_conversion_rate !== null ? `${metrics.lead_conversion_rate}%` : '—'}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3.5">
              <p className="text-2xs text-muted-foreground">
                {isUz ? 'Eskalatsiya yechimi' : 'Escalation SLA'}
              </p>
              <p data-numeric className="mt-1 text-xl font-semibold tabular-nums">
                {metrics.escalation_resolved_rate !== null
                  ? `${metrics.escalation_resolved_rate}%`
                  : '—'}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3.5">
              <p className="text-2xs text-muted-foreground">
                {isUz ? 'Telegram javob bali' : 'Telegram Quality'}
              </p>
              <p data-numeric className="mt-1 text-xl font-semibold tabular-nums">
                {metrics.avg_telegram_score ?? '—'}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <Tabs defaultValue="escalations" className="space-y-3">
          <TabsList className="flex-wrap">
            <TabsTrigger value="escalations">
              <AlertTriangle className="size-3.5 text-warning" />
              {isUz ? 'Eskalatsiyalar' : 'Escalations'} ({openEsc.length})
            </TabsTrigger>
            <TabsTrigger value="leads">
              <Users className="size-3.5 text-primary" />
              {isUz ? 'Mijozlar (Lidlar)' : 'Follow-up Leads'} ({dueLeads.length})
            </TabsTrigger>
            <TabsTrigger value="telegram">
              <MessageSquare className="size-3.5 text-primary" />
              Telegram ({unansweredTg.length})
            </TabsTrigger>
            <TabsTrigger value="checklists">
              <ListTodo className="size-3.5" />
              {isUz ? 'AI Vazifalar' : 'AI Checklists'} ({openNotifs.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="escalations" className="space-y-3">
            {openEsc.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                  <CheckCircle2 className="size-7 text-success" />
                  <p className="text-xs text-muted-foreground">
                    {isUz ? 'Ochiq eskalatsiyalar yoʻq' : 'No open escalations'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              openEsc.map((esc) => (
                <Card key={esc.id}>
                  <CardContent className="space-y-2.5 p-4 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-foreground">
                          {esc.call_name || `Call #${esc.call_id}`}
                        </p>
                        <p className="mt-0.5 text-muted-foreground">{esc.detected_problem}</p>
                      </div>
                      <Link
                        to={`/calls/${esc.call_id}`}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <ExternalLink className="size-3" />
                        {isUz ? 'Ochish' : 'Open'}
                      </Link>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        value={escNotes[esc.id] ?? ''}
                        onChange={(e) =>
                          setEscNotes((prev) => ({ ...prev, [esc.id]: e.target.value }))
                        }
                        placeholder={isUz ? 'Qanday hal qilindi?' : 'Resolution notes...'}
                      />
                      <Button size="sm" onClick={() => void resolveEsc(esc.id)}>
                        <CheckCircle2 className="size-3.5" />
                        {isUz ? 'Hal qilish' : 'Resolve'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="leads" className="space-y-3">
            {dueLeads.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-xs text-muted-foreground">
                  {isUz ? 'Kutilayotgan lidlar yoʻq' : 'No pending leads'}
                </CardContent>
              </Card>
            ) : (
              dueLeads.map((lead) => (
                <Card key={lead.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-foreground">{lead.name}</p>
                        <Badge variant="outline">{lead.pipeline_stage ?? 'new_lead'}</Badge>
                        {lead.source_channel && (
                          <Badge variant="secondary">{lead.source_channel}</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-muted-foreground">
                        {lead.phone || '—'} {lead.student_grade ? `· ${lead.student_grade}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {lead.pipeline_stage === 'new_lead' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void advanceLead(lead.id, 'consulted')}
                        >
                          {isUz ? 'Maʼlumot berildi' : 'Mark Consulted'}
                        </Button>
                      )}
                      {lead.pipeline_stage !== 'test_scheduled' && (
                        <Button
                          size="sm"
                          onClick={() => void advanceLead(lead.id, 'test_scheduled')}
                        >
                          {isUz ? 'Test belgilandi' : 'Schedule Test'}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="telegram" className="space-y-3">
            {unansweredTg.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-xs text-muted-foreground">
                  {isUz ? 'Javobsiz Telegram xabarlar yoʻq' : 'No unanswered Telegram messages'}
                </CardContent>
              </Card>
            ) : (
              unansweredTg.map((msg) => (
                <Card key={msg.id}>
                  <CardContent className="space-y-2 p-4 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">
                        {msg.full_name || msg.username || `User #${msg.user_id}`}
                      </span>
                      <span className="text-2xs text-muted-foreground">
                        {formatDate(msg.created_at)}
                      </span>
                    </div>
                    <p className="text-foreground">{msg.text}</p>
                    <div className="flex items-center gap-2">
                      <Input
                        value={tgReplies[msg.id] ?? ''}
                        onChange={(e) =>
                          setTgReplies((prev) => ({ ...prev, [msg.id]: e.target.value }))
                        }
                        placeholder={isUz ? 'Javob yozing...' : 'Type your reply...'}
                      />
                      <Button size="sm" onClick={() => void replyTg(msg.id)}>
                        <Send className="size-3.5" />
                        {isUz ? 'Yuborish' : 'Send'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="checklists" className="space-y-2.5">
            {openNotifs.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-xs text-muted-foreground">
                  {t('emp.no_open_tasks')}
                </CardContent>
              </Card>
            ) : (
              openNotifs.map((n) => (
                <Card key={n.id}>
                  <CardContent className="flex items-start justify-between gap-3 p-4 text-xs">
                    <div>
                      <p className="font-semibold text-foreground">{n.title}</p>
                      <p className="mt-0.5 text-muted-foreground">{n.message}</p>
                      <div className="mt-1.5 flex items-center gap-3 text-2xs text-muted-foreground">
                        <span>{formatDate(n.created_at)}</span>
                        {n.call_id && (
                          <Link
                            to={`/calls/${n.call_id}`}
                            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                          >
                            {t('tasks.open_call')} #{n.call_id}
                            <ExternalLink className="size-3" />
                          </Link>
                        )}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => void markDone(n.id)}>
                      <CheckCircle2 className="size-3.5 text-success" />
                      {t('emp.mark_done')}
                    </Button>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

export default MyTasks

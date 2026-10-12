import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  Check,
  CheckSquare,
  Clock,
  Copy,
  FilePenLine,
  Globe,
  Lightbulb,
  MessageSquare,
  PhoneCall,
  RefreshCw,
  Target,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { WavePlayer } from '@/components/WavePlayer'
import { ScorecardView } from '@/components/ScorecardView'
import { ScoreRing } from '@/components/ScoreRing'
import { Reveal } from '@/lib/motion'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useI18n } from '@/i18n/i18n'
import {
  formatDate,
  formatDuration,
  isInFlight,
  scoreColor,
  scoreLabel,
} from '@/lib/format'
import {
  analysisError,
  analysisProblem,
  analysisSolutions,
  asAnalysis,
  callTitle,
  type Call,
  type CallType,
  type Client,
} from '@/lib/types'
import { cn } from '@/lib/utils'

const NO_CLIENT = 'none'

const POLL_ACTIVE_MS = 4000
const POLL_IDLE_MS = 60000

const SPEAKER_PALETTE = [
  { fg: 'var(--color-chart-1)', bg: 'color-mix(in oklch, var(--color-chart-1) 8%, transparent)' },
  { fg: 'var(--color-chart-6)', bg: 'color-mix(in oklch, var(--color-chart-6) 8%, transparent)' },
  { fg: 'var(--color-chart-5)', bg: 'color-mix(in oklch, var(--color-chart-5) 8%, transparent)' },
  { fg: 'var(--color-chart-2)', bg: 'color-mix(in oklch, var(--color-chart-2) 8%, transparent)' },
  { fg: 'var(--color-chart-3)', bg: 'color-mix(in oklch, var(--color-chart-3) 8%, transparent)' },
  { fg: 'var(--color-chart-4)', bg: 'color-mix(in oklch, var(--color-chart-4) 8%, transparent)' },
]

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

function speakerStyle(label: string): CSSProperties {
  const c = SPEAKER_PALETTE[hash(label) % SPEAKER_PALETTE.length]
  return { color: c.fg, backgroundColor: c.bg, borderColor: c.fg }
}

function TranscriptView({ call }: { call: Call }) {
  if (call.segments.length > 0) {
    return (
      <div className="max-h-[540px] space-y-2.5 overflow-y-auto pr-1">
        {call.segments.map((s, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: Math.min(i * 0.015, 0.4), duration: 0.25 }}
            className="flex gap-2.5"
          >
            {(s.speaker_label || s.language_code) && (
              <div className="flex w-20 shrink-0 flex-col items-end gap-1 pt-1">
                {s.speaker_label && (
                  <span
                    className="max-w-full truncate rounded-sm px-1.5 py-0.5 text-2xs font-semibold ring-1 ring-inset"
                    style={speakerStyle(s.speaker_label)}
                    title={s.speaker_label}
                  >
                    {s.speaker_label}
                  </span>
                )}
                {s.language_code && (
                  <span className="inline-flex items-center gap-1 rounded-sm bg-surface-sunken px-1 py-px text-2xs uppercase tracking-wide text-muted-foreground">
                    <Globe aria-hidden="true" className="size-2.5" />
                    {s.language_code}
                  </span>
                )}
              </div>
            )}
            <p className="flex-1 rounded-md px-3 py-2 text-sm leading-relaxed ring-1 ring-inset"
              style={s.speaker_label ? { ...speakerStyle(s.speaker_label), backgroundColor: 'transparent', borderColor: 'var(--color-border)' } : { backgroundColor: 'var(--color-surface-sunken)' }}
            >
              {s.text}
            </p>
          </motion.div>
        ))}
      </div>
    )
  }
  return <p className="text-sm leading-relaxed whitespace-pre-wrap">{call.transcript}</p>
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="loading">
      <Skeleton className="mb-4 h-36 rounded-lg" />
      <Skeleton className="mb-4 h-16 rounded-lg" />
      <div className="mb-4 grid gap-3 lg:grid-cols-5">
        <Skeleton className="h-56 rounded-lg lg:col-span-2" />
        <Skeleton className="h-56 rounded-lg lg:col-span-3" />
      </div>
      <Skeleton className="mb-4 h-64 rounded-lg" />
      <Skeleton className="h-72 rounded-lg" />
    </div>
  )
}

export function CallDetail() {
  const { t, lang } = useI18n()
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const callId = Number(id)

  const [call, setCall] = useState<Call | null>(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editType, setEditType] = useState<CallType>('manager')
  const [editClient, setEditClient] = useState<string>(NO_CLIENT)
  const [clients, setClients] = useState<Client[]>([])
  const [clientsLoading, setClientsLoading] = useState(false)

  const timer = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      setCall(await api.getCall(callId))
      setMissing(false)
    } catch (e) {
      setMissing(true)
      toast.error(t('call.load_failed', { error: (e as Error).message }))
    } finally {
      setLoading(false)
    }
  }, [callId, t])

  /**
   * One self-adjusting timer. The previous code had a 10s interval plus a
   * separate "stop polling on terminal state" effect whose body was empty and
   * whose dependency list was `call?.status` — it re-ran on the wrong render
   * and the interval kept firing forever.
   */
  useEffect(() => {
    if (!Number.isFinite(callId) || callId <= 0) {
      navigate('/calls', { replace: true })
      return
    }
    void refresh()
    let delay = POLL_ACTIVE_MS
    const tick = () => {
      if (!document.hidden) void refresh()
      delay = call && !isInFlight(call.status) ? POLL_IDLE_MS : POLL_ACTIVE_MS
      timer.current = window.setTimeout(tick, delay)
    }
    timer.current = window.setTimeout(tick, delay)
    const onVisible = () => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // `call` is read inside the timer for cadence only; re-arming on every
    // status change would restart the poll mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, refresh, navigate])

  const saveTranscript = useCallback(async () => {
    try {
      await api.updateTranscript(callId, draft)
      toast.success(t('call.saved'))
      setEditing(false)
      await refresh()
    } catch (e) {
      toast.error(t('call.save_failed', { error: (e as Error).message }))
    }
  }, [callId, draft, refresh, t])

  useEffect(() => {
    if (!editing) return
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void saveTranscript()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [editing, saveTranscript])

  useEffect(() => {
    if (!editOpen) return
    setClientsLoading(true)
    api
      .listClients()
      .then(setClients)
      .catch(() => toast.error(t('call.clients_load_failed')))
      .finally(() => setClientsLoading(false))
  }, [editOpen, t])

  const copyTranscript = async () => {
    if (!call?.transcript) return
    try {
      await navigator.clipboard.writeText(call.transcript)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error(t('call.copy_failed'))
    }
  }

  const reanalyze = async () => {
    try {
      await api.reanalyze(callId)
      toast.success(t('call.reanalyzing'))
      await refresh()
    } catch (e) {
      toast.error(t('call.reanalyze_failed', { error: (e as Error).message }))
    }
  }

  const remove = async () => {
    if (!call || !window.confirm(t('call.delete_confirm', { name: call.name }))) return
    try {
      await api.deleteCall(callId)
      navigate('/calls', { replace: true })
    } catch (e) {
      toast.error(t('call.delete_failed', { error: (e as Error).message }))
    }
  }

  const openEdit = () => {
    if (!call) return
    setEditType(call.call_type)
    setEditClient(call.client_id != null ? String(call.client_id) : NO_CLIENT)
    setEditOpen(true)
  }

  const saveEdit = async () => {
    try {
      await api.updateCall(callId, {
        call_type: editType,
        client_id: editClient === NO_CLIENT ? null : Number(editClient),
      })
      toast.success(t('call.details_updated'))
      setEditOpen(false)
      await refresh()
    } catch (e) {
      toast.error(t('call.save_failed', { error: (e as Error).message }))
    }
  }

  if (loading) return <DetailSkeleton />

  if (!call || missing) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <PhoneCall aria-hidden="true" className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t('call.not_found')}</p>
            <Button size="sm" variant="outline" asChild>
              <Link to="/calls">{t('call.back')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const analysis = asAnalysis(call.analysis)
  const error = analysisError(call.analysis)
  const problem = analysisProblem(call.analysis)
  const solutions = analysisSolutions(call.analysis)
  const overall = analysis.scorecard?.overall ?? null
  const hasAnalysis = call.status === 'done' && analysis.scorecard != null
  const processing = isInFlight(call.status)
  const title = callTitle(call)

  return (
    <div className="space-y-4">
      <Reveal>
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <Button variant="outline" size="icon-sm" asChild className="mt-0.5 shrink-0">
                  <Link to="/calls" aria-label={t('call.back')}>
                    <ArrowLeft aria-hidden="true" className="size-3.5" />
                  </Link>
                </Button>
                <div className="min-w-0">
                  <h1 className="text-lg font-semibold tracking-[-0.02em] text-balance">{title}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-md bg-surface-sunken px-1.5 py-0.5 text-2xs tabular-nums text-muted-foreground ring-1 ring-border-subtle ring-inset">
                      <Clock aria-hidden="true" className="size-3" />
                      {formatDuration(call.duration_sec)}
                    </span>
                    <span className="rounded-md bg-surface-sunken px-1.5 py-0.5 text-2xs text-muted-foreground ring-1 ring-border-subtle ring-inset">
                      {formatDate(call.created_at)}
                    </span>
                    {call.language && (
                      <span className="rounded-sm bg-primary-soft px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-primary-soft-foreground">
                        {call.language}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded-md bg-surface-sunken px-1.5 py-0.5 text-2xs capitalize text-muted-foreground ring-1 ring-border-subtle ring-inset">
                      <PhoneCall aria-hidden="true" className="size-3" />
                      {call.call_type}
                    </span>
                    {call.client_name && (
                      <Link
                        to="/clients"
                        className="rounded-md bg-primary-soft px-1.5 py-0.5 text-2xs font-medium text-primary-soft-foreground transition-colors hover:opacity-80"
                      >
                        {call.client_name}
                      </Link>
                    )}
                    {call.uploader_name && (
                      <span className="rounded-md bg-surface-sunken px-1.5 py-0.5 text-2xs text-muted-foreground ring-1 ring-border-subtle ring-inset">
                        {t('call.uploader')} {call.uploader_name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <Badge
                variant={
                  call.status === 'done'
                    ? 'success'
                    : call.status === 'error'
                      ? 'destructive'
                      : 'secondary'
                }
                className="shrink-0 self-start"
              >
                {t(`status.${call.status}`)}
              </Badge>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
              {isAdmin && (
                <Button variant="outline" size="sm" onClick={openEdit}>
                  <FilePenLine aria-hidden="true" className="size-3.5" />
                  {t('call.edit_details')}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => void reanalyze()} disabled={!call.transcript}>
                <RefreshCw aria-hidden="true" className="size-3.5" />
                {t('call.reanalyze')}
              </Button>
              <Button
                variant="destructive-ghost"
                size="sm"
                onClick={() => void remove()}
                className="ml-auto"
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
                {t('call.delete')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </Reveal>

      <Reveal>
        <Card size="sm">
          <CardContent className="py-3">
            <WavePlayer url={api.audioUrl(callId)} />
          </CardContent>
        </Card>
      </Reveal>

      {(processing || call.status === 'error') && (
        <Reveal>
          <div
            role="status"
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-5 text-center',
              call.status === 'error' ? 'border-destructive/30 bg-destructive-soft/40' : 'border-border'
            )}
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  'size-2 rounded-full',
                  call.status === 'error' ? 'bg-destructive' : 'animate-pulse-soft bg-primary'
                )}
              />
              <span className="text-xs font-medium text-muted-foreground">
                {call.status === 'error' ? t('call.analysis_failed') : t('dashboard.proc_short')}
              </span>
            </div>
            {error && (
              <p className="max-w-2xl font-mono text-2xs break-words text-destructive">{error}</p>
            )}
            {call.status === 'error' && (
              <p className="text-xs text-muted-foreground">{t('call.analysis_failed_hint')}</p>
            )}
          </div>
        </Reveal>
      )}

      {hasAnalysis && (
        <>
          <Reveal>
            <div className="grid gap-3 lg:grid-cols-5">
              <Card className="lg:col-span-2">
                <div
                  aria-hidden="true"
                  className={cn(
                    'h-0.5 w-full',
                    overall == null
                      ? 'bg-border-strong'
                      : overall >= 70
                        ? 'bg-success'
                        : overall >= 40
                          ? 'bg-warning'
                          : 'bg-destructive'
                  )}
                />
                <CardContent className="flex flex-col items-center justify-center gap-3 py-7">
                  <ScoreRing score={overall ?? 0} size={132} stroke={10} delay={0.15} />
                  <p className={cn('text-sm font-semibold', scoreColor(overall))}>
                    {scoreLabel(overall, lang)}
                  </p>
                </CardContent>
              </Card>

              <Card className="lg:col-span-3">
                <CardHeader className="border-b border-border-subtle pb-2.5">
                  <CardTitle className="flex items-center gap-1.5">
                    <Lightbulb aria-hidden="true" className="size-3.5 text-warning" />
                    {t('call.summary')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-3">
                  <p className="text-sm leading-relaxed text-muted-foreground">{analysis.summary}</p>
                  <Separator />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-md bg-surface-sunken px-2.5 py-2 ring-1 ring-border-subtle ring-inset">
                      <p className="eyebrow">{t('call.outcome')}</p>
                      <p className="mt-0.5 text-sm font-medium capitalize">
                        {analysis.outcome ?? '—'}
                      </p>
                    </div>
                    <div className="rounded-md bg-surface-sunken px-2.5 py-2 ring-1 ring-border-subtle ring-inset">
                      <p className="eyebrow">{t('call.talk_ratio')}</p>
                      <p className="mt-0.5 text-sm font-medium tabular-nums">
                        {analysis.rep_share_of_talk != null
                          ? `${Math.round(analysis.rep_share_of_talk * 100)}%`
                          : '—'}
                      </p>
                    </div>
                  </div>
                  {analysis.key_metrics?.length ? (
                    <>
                      <Separator />
                      <div>
                        <p className="eyebrow mb-1.5">{t('call.key_metrics')}</p>
                        <ul className="flex flex-wrap gap-1">
                          {analysis.key_metrics.map((m, i) => (
                            <li key={i}>
                              <Badge variant="outline" className="font-normal">
                                <span className="text-muted-foreground">{m.name}:</span> {m.value}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </Reveal>

          {problem && (
            <Reveal>
              <Card>
                <div aria-hidden="true" className="h-0.5 w-full bg-warning" />
                <CardHeader className="border-b border-border-subtle pb-2.5">
                  <CardTitle className="flex items-center gap-1.5">
                    <TriangleAlert aria-hidden="true" className="size-3.5 text-warning" />
                    {t('call.problem')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-3">
                  <p className="text-sm leading-relaxed text-muted-foreground">{problem}</p>
                  {solutions.length > 0 && (
                    <>
                      <Separator />
                      <p className="eyebrow">{t('call.solutions')}</p>
                      <ol className="space-y-2">
                        {solutions.map((s, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2.5 rounded-md bg-warning-soft px-3 py-2.5 text-warning-soft-foreground"
                          >
                            <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-sm text-2xs font-semibold tabular-nums ring-1 ring-current/20 ring-inset">
                              {i + 1}
                            </span>
                            <span className="text-sm leading-relaxed">{s}</span>
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                </CardContent>
              </Card>
            </Reveal>
          )}

          <Reveal>
            {analysis.scorecard && <ScorecardView scorecard={analysis.scorecard} />}
          </Reveal>

          <Reveal>
            <Card>
              <Tabs defaultValue="action-items" className="gap-0">
                <CardHeader className="border-b border-border-subtle pb-2.5">
                  <TabsList>
                <TabsTrigger value="action-items">
                  <CheckSquare aria-hidden="true" className="text-primary" />
                  {t('call.tab.action_items')}
                  {analysis.action_items?.length ? (
                    <Count>{analysis.action_items.length}</Count>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger value="coaching">
                  <Lightbulb aria-hidden="true" className="text-warning" />
                  {t('call.tab.coaching')}
                  {analysis.coaching_points?.length ? (
                    <Count>{analysis.coaching_points.length}</Count>
                  ) : null}
                </TabsTrigger>
                  <TabsTrigger value="next-steps">
                    <Target aria-hidden="true" className="text-chart-6" />
                    {t('call.tab.next_steps')}
                    {analysis.next_steps?.length ? (
                      <Count>{analysis.next_steps.length}</Count>
                    ) : null}
                  </TabsTrigger>
                </TabsList>
                </CardHeader>

                <CardContent className="pt-3">

                  <TabsContent value="action-items">
                    {analysis.action_items?.length ? (
                      <ol className="space-y-2">
                        {analysis.action_items.map((item, i) => (
                          <motion.li
                            key={i}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.04 }}
                            className="flex items-start gap-2.5 rounded-md bg-surface-sunken px-3 py-2.5 ring-1 ring-border-subtle ring-inset"
                          >
                            <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-sm bg-primary-soft text-2xs font-semibold tabular-nums text-primary-soft-foreground">
                              {i + 1}
                            </span>
                            <div className="min-w-0 flex-1 space-y-1.5">
                              <p className="text-sm leading-relaxed">{item.description}</p>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge
                                  variant={
                                    item.priority === 'high'
                                      ? 'destructive'
                                      : item.priority === 'medium'
                                        ? 'warning'
                                        : 'secondary'
                                  }
                                >
                                  {item.priority}
                                </Badge>
                                {item.assignee && (
                                  <Badge variant="secondary" className="capitalize">
                                    {item.assignee}
                                  </Badge>
                                )}
                                {item.due_date && (
                                  <span className="inline-flex items-center gap-1 text-2xs tabular-nums text-muted-foreground">
                                    <Clock aria-hidden="true" className="size-2.5" />
                                    {item.due_date}
                                  </span>
                                )}
                              </div>
                            </div>
                          </motion.li>
                        ))}
                      </ol>
                    ) : (
                      <p className="py-8 text-center text-xs text-muted-foreground">
                        {t('call.no_action_items')}
                      </p>
                    )}
                  </TabsContent>

                  <TabsContent value="coaching">
                    <ol className="space-y-2">
                      {(analysis.coaching_points ?? []).map((s, i) => (
                        <motion.li
                          key={i}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.04 }}
                          className="flex items-start gap-2.5 rounded-md bg-surface-sunken px-3 py-2.5 ring-1 ring-border-subtle ring-inset"
                        >
                          <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-sm bg-primary-soft text-2xs font-semibold tabular-nums text-primary-soft-foreground">
                            {i + 1}
                          </span>
                          <span className="text-sm leading-relaxed">{s}</span>
                        </motion.li>
                      ))}
                    </ol>
                  </TabsContent>

                  <TabsContent value="next-steps">
                    <ol className="space-y-2">
                      {(analysis.next_steps ?? []).map((s, i) => (
                        <motion.li
                          key={i}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.04 }}
                          className="flex items-start gap-2.5 rounded-md bg-surface-sunken px-3 py-2.5 ring-1 ring-border-subtle ring-inset"
                        >
                          <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-sm bg-surface-active text-2xs font-semibold tabular-nums text-muted-foreground">
                            {i + 1}
                          </span>
                          <span className="text-sm leading-relaxed">{s}</span>
                        </motion.li>
                      ))}
                    </ol>
                  </TabsContent>
                </CardContent>
              </Tabs>
            </Card>
          </Reveal>
        </>
      )}

      <Reveal>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border-subtle pb-2.5">
            <CardTitle className="flex items-center gap-1.5">
              <MessageSquare aria-hidden="true" className="size-3.5 text-primary" />
              {t('call.transcript')}
            </CardTitle>
            <div className="flex gap-1.5">
              {editing ? (
                <>
                  <Button size="sm" onClick={() => void saveTranscript()} title={t('call.save_shortcut')}>
                    <Check aria-hidden="true" className="size-3.5" />
                    {t('call.save')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(false)
                      setDraft(call.transcript)
                    }}
                  >
                    {t('call.cancel')}
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={() => void copyTranscript()} disabled={!call.transcript}>
                    {copied ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
                    <span className="sr-only sm:not-sr-only">{copied ? t('call.copied') : t('call.copy')}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDraft(call.transcript)
                      setEditing(true)
                    }}
                    disabled={!call.transcript}
                  >
                    <FilePenLine aria-hidden="true" className="size-3.5" />
                    {t('call.edit')}
                  </Button>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-3">
            {editing ? (
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.max(8, call.transcript.split('\n').length + 2)}
                className="font-mono text-sm"
                aria-label={t('call.transcript')}
              />
            ) : call.transcript ? (
              <TranscriptView call={call} />
            ) : (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <MessageSquare aria-hidden="true" className="size-7 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">{t('call.no_transcript')}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </Reveal>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('call.edit_details')}</DialogTitle>
            <DialogDescription>{t('call.edit_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-call-type">{t('upload.call_type')}</Label>
              <Select value={editType} onValueChange={(v) => setEditType(v as CallType)}>
                <SelectTrigger id="edit-call-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">{t('call.manager_call')}</SelectItem>
                  <SelectItem value="receptionist">{t('call.receptionist_call')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-call-client">{t('call.client')}</Label>
              <Select value={editClient} onValueChange={setEditClient}>
                <SelectTrigger id="edit-call-client" className="w-full" disabled={clientsLoading}>
                  <SelectValue
                    placeholder={clientsLoading ? t('call.loading_clients') : t('upload.no_client')}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLIENT}>{t('upload.no_client')}</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                      {c.company ? ` · ${c.company}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => void saveEdit()}>{t('common.save_changes')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Count({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1 rounded-full bg-surface-active px-1.5 text-2xs font-semibold tabular-nums text-muted-foreground">
      {children}
    </span>
  )
}
export default CallDetail

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Activity,
  ArrowLeft,
  Check,
  CheckSquare,
  Clock,
  Copy,
  FilePenLine,
  Globe,
  Lightbulb,
  Mail,
  MessageSquare,
  PhoneCall,
  Play,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Star,
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
import { Input } from '@/components/ui/input'
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

import { WavePlayer, type WavePlayerHandle } from '@/components/WavePlayer'
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
  type AcousticsInfo,
  type Call,
  type CallType,
  type Client,
  type Escalation,
  type Segment,
  type User,
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

/** Text colour only: the transcript reads as prose, not as coloured cards. */
function speakerTone(label: string): string {
  return SPEAKER_PALETTE[hash(label) % SPEAKER_PALETTE.length].fg
}

/**
 * A turn is "current" while the playhead sits inside it. Only private-mode
 * segments carry `start`/`end`, so every check here tolerates their absence.
 */
function isCurrentTurn(s: Segment, currentTime: number, hasTimings: boolean): boolean {
  if (!hasTimings || s.start == null || s.end == null) return false
  return currentTime >= s.start && currentTime < s.end
}

function TranscriptView({
  call,
  currentTime,
  query,
  onSeek,
}: {
  call: Call
  currentTime: number
  query: string
  onSeek: (sec: number) => void
}) {
  const { t } = useI18n()
  const q = query.trim().toLowerCase()

  const filteredSegments = useMemo(() => {
    if (!q) return call.segments.map((s, idx) => ({ s, idx }))
    return call.segments
      .map((s, idx) => ({ s, idx }))
      .filter(
        ({ s }) =>
          s.text.toLowerCase().includes(q) ||
          (s.speaker_label && s.speaker_label.toLowerCase().includes(q))
      )
  }, [call.segments, q])

  if (call.segments.length > 0) {
    const hasTimings = call.segments.some((s) => s.start != null)
    const activeIndex = hasTimings
      ? call.segments.findIndex((s) => isCurrentTurn(s, currentTime, hasTimings))
      : -1

    if (filteredSegments.length === 0) {
      return (
        <p className="py-10 text-center text-xs text-muted-foreground">
          {t('calls.no_match_title')}
        </p>
      )
    }

    return (
      <div className="max-h-[calc(100dvh-16rem)] space-y-2.5 overflow-y-auto pr-1 [overscroll-behavior:contain] [scrollbar-gutter:stable]">
        {filteredSegments.map(({ s, idx }) => {
          const start = s.start
          const isActive = idx === activeIndex
          const seek = () => onSeek(start as number)
          const onSeekKey = (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              seek()
            }
          }

          return (
            <motion.div
              key={idx}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(idx * 0.012, 0.3), duration: 0.2 }}
              className="flex gap-2.5"
            >
              {(s.speaker_label || s.language_code || start != null) && (
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
                  {start != null && (
                    <button
                      type="button"
                      onClick={seek}
                      title={t('call.jump_to_turn')}
                      aria-label={`${t('call.jump_to_turn')} ${formatDuration(start)}`}
                      className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs font-medium tabular-nums text-muted-foreground outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <Play aria-hidden="true" className="size-2.5" />
                      {formatDuration(start)}
                    </button>
                  )}
                  {s.language_code && (
                    <span className="inline-flex items-center gap-1 rounded-sm bg-surface-sunken px-1 py-px text-2xs uppercase tracking-wide text-muted-foreground">
                      <Globe aria-hidden="true" className="size-2.5" />
                      {s.language_code}
                    </span>
                  )}
                </div>
              )}
              <p
                {...(start != null
                  ? { onClick: seek, onKeyDown: onSeekKey, role: 'button', tabIndex: 0 }
                  : {})}
                className={cn(
                  'flex-1 rounded-lg border-l-2 border-transparent px-3 py-2 text-[13.5px] leading-relaxed transition-colors',
                  start != null &&
                    'cursor-pointer outline-none hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  isActive && 'border-primary bg-primary-soft text-primary-soft-foreground'
                )}
                style={
                  isActive
                    ? undefined
                    : { color: s.speaker_label ? speakerTone(s.speaker_label) : undefined }
                }
              >
                {s.text}
              </p>
            </motion.div>
          )
        })}
      </div>
    )
  }
  return (
    <div className="max-h-[calc(100dvh-16rem)] overflow-y-auto pr-1 [overscroll-behavior:contain] [scrollbar-gutter:stable]">
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{call.transcript}</p>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="loading" className="space-y-4">
      <Skeleton className="h-36 rounded-lg" />
      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        <div className="space-y-4 lg:col-span-5">
          <Skeleton className="h-80 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
        <div className="lg:col-span-7">
          <Skeleton className="h-[540px] rounded-lg" />
        </div>
      </div>
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
  const [currentTime, setCurrentTime] = useState(0)
  const [transcriptQuery, setTranscriptQuery] = useState('')
  const [escalation, setEscalation] = useState<Escalation | null>(null)
  const [draftMsg, setDraftMsg] = useState<string | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [escalateModalOpen, setEscalateModalOpen] = useState(false)
  const [assignUserList, setAssignUserList] = useState<User[]>([])
  const [assigneeId, setAssigneeId] = useState<string>('')
  const [problemDescription, setProblemDescription] = useState('')
  const [escalateReason, setEscalateReason] = useState('')
  const [escalating, setEscalating] = useState(false)
  const [resolving, setResolving] = useState(false)

  const timer = useRef<number | null>(null)
  const playerRef = useRef<WavePlayerHandle>(null)
  const statusRef = useRef<Call['status'] | null>(null)
  const callRef = useRef<Call | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await api.getCall(callId)
      statusRef.current = next.status
      callRef.current = next
      setCall(next)
      setMissing(false)
      try {
        const escRes = await api.getCallEscalation(callId)
        setEscalation(escRes.escalation)
      } catch {
        /* ignore */
      }
    } catch (e) {
      if (callRef.current === null) setMissing(true)
      toast.error(t('call.load_failed', { error: (e as Error).message }))
    } finally {
      setLoading(false)
    }
  }, [callId, t])

  const handleResolveEscalation = async () => {
    if (!escalation) return
    setResolving(true)
    try {
      const res = await api.resolveEscalation(escalation.id, "Muammo to'liq hal qilindi")
      setEscalation(res.escalation)
      toast.success(t('escalation.resolved_toast'))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setResolving(false)
    }
  }

  const openEscalateModal = async () => {
    setEscalateModalOpen(true)
    try {
      const users = await api.listUsers()
      setAssignUserList(users)
    } catch {
      /* ignore */
    }
  }

  const handleManualEscalate = async () => {
    setEscalating(true)
    try {
      const res = await api.escalateCall(callId, {
        assigned_to_user_id: assigneeId ? Number(assigneeId) : undefined,
        detected_problem: problemDescription.trim() || undefined,
        assigned_reason: escalateReason.trim() || undefined,
      })
      setEscalation(res.escalation)
      setEscalateModalOpen(false)
      toast.success(t('escalation.dispatched_toast'))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setEscalating(false)
    }
  }

  useEffect(() => {
    if (!Number.isFinite(callId) || callId <= 0) {
      navigate('/calls', { replace: true })
      return
    }
    setCurrentTime(0)
    statusRef.current = null
    callRef.current = null
    setCall(null)
    setMissing(false)
    setLoading(true)
    void refresh()
    const tick = () => {
      if (!document.hidden) void refresh()
      const status = statusRef.current
      const delay = status && !isInFlight(status) ? POLL_IDLE_MS : POLL_ACTIVE_MS
      timer.current = window.setTimeout(tick, delay)
    }
    timer.current = window.setTimeout(tick, POLL_ACTIVE_MS)
    const onVisible = () => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
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

  const toggleResolved = async () => {
    if (!call) return
    try {
      const updated = await api.updateCall(callId, { resolved: !call.resolved })
      setCall(updated)
      callRef.current = updated
    } catch (e) {
      toast.error(t('call.save_failed', { error: (e as Error).message }))
    }
  }

  const toggleBookmark = async () => {
    if (!call) return
    const nextBookmarked = !call.bookmarked
    let note = call.bookmark_note ?? ''
    if (nextBookmarked && !note) {
      const prompted = window.prompt(t('call.bookmark_note_placeholder'), '')
      if (prompted === null) return
      note = prompted.trim()
    }
    try {
      const updated = await api.updateCall(callId, {
        bookmarked: nextBookmarked,
        bookmark_note: nextBookmarked ? note : '',
      })
      setCall(updated)
      callRef.current = updated
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
  const acoustics = (call.source_meta?.acoustics as AcousticsInfo | undefined) ?? null
  const coachingCount =
    (analysis.coaching_points?.length ?? 0) +
    (analysis.evidence_quotes?.length ?? 0) +
    (problem ? 1 : 0)
  const actionCount =
    (analysis.action_items?.length ?? 0) + (analysis.next_steps?.length ?? 0)

  return (
    <div className="space-y-4">
      {/* 1. Sticky Top Header + Docked Waveform Bar (Metasell Coaching Header) */}
      <Reveal>
        <div className="sticky top-14 z-20">
          <Card className="bg-surface/95 backdrop-blur-md">
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <Button variant="outline" size="icon-sm" asChild className="mt-0.5 shrink-0">
                    <Link to="/calls" aria-label={t('call.back')}>
                      <ArrowLeft aria-hidden="true" className="size-3.5" />
                    </Link>
                  </Button>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-lg font-semibold tracking-[-0.02em] text-balance">
                        {title}
                      </h1>
                      <Badge
                        variant={
                          call.status === 'done'
                            ? 'success'
                            : call.status === 'error'
                              ? 'destructive'
                              : 'secondary'
                        }
                      >
                        {t(`status.${call.status}`)}
                      </Badge>
                      {analysis.coach_decision && (
                        <Badge
                          variant={
                            analysis.coach_decision === 'ESCALATE'
                              ? 'destructive'
                              : analysis.coach_decision === 'COACH'
                                ? 'warning'
                                : 'success'
                          }
                          className="font-mono text-2xs"
                        >
                          {analysis.coach_decision}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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
                      {acoustics && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-surface-sunken px-1.5 py-0.5 font-mono text-2xs text-muted-foreground ring-1 ring-border-subtle ring-inset">
                          <Activity aria-hidden="true" className="size-3 text-primary" />
                          {acoustics.channels >= 2
                            ? t('call.acoustics.stereo')
                            : t('call.acoustics.mono')}
                        </span>
                      )}
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

                {/* Action controls right-aligned on the header row */}
                <div className="flex flex-wrap items-center gap-1.5 lg:shrink-0">
                  {(overall != null && overall < 50) || call.resolved ? (
                    <Button
                      variant={call.resolved ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => void toggleResolved()}
                    >
                      <Check aria-hidden="true" className="size-3.5" />
                      {call.resolved ? t('call.resolved') : t('call.mark_resolved')}
                    </Button>
                  ) : null}
                  <Button
                    variant={call.bookmarked ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => void toggleBookmark()}
                    title={call.bookmark_note || undefined}
                  >
                    <Star
                      aria-hidden="true"
                      className={cn('size-3.5', call.bookmarked && 'fill-current')}
                    />
                    {call.bookmarked ? t('call.bookmarked') : t('call.bookmark')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void reanalyze()}
                    disabled={!call.transcript}
                  >
                    <RefreshCw aria-hidden="true" className="size-3.5" />
                    {t('call.reanalyze')}
                  </Button>
                  {call.status === 'done' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={drafting}
                      onClick={async () => {
                        setDrafting(true)
                        try {
                          const res = await api.draftFollowup(callId)
                          setDraftMsg(res.message)
                        } catch (err) {
                          toast.error((err as Error).message)
                        } finally {
                          setDrafting(false)
                        }
                      }}
                    >
                      <Sparkles aria-hidden="true" className="size-3.5 text-primary" />
                      {drafting ? '...' : lang === 'uz' ? 'Xabar tayyorlash' : 'Draft Follow-up'}
                    </Button>
                  )}
                  {(user?.role === 'admin' || user?.role === 'yonalish') && (
                    <Button
                      variant={escalation ? 'outline' : 'secondary'}
                      size="sm"
                      onClick={() => void openEscalateModal()}
                    >
                      <Send aria-hidden="true" className="size-3.5 text-primary" />
                      {escalation ? t('escalation.reassign') : t('escalation.button')}
                    </Button>
                  )}
                  {isAdmin && (
                    <Button variant="outline" size="sm" onClick={openEdit}>
                      <FilePenLine aria-hidden="true" className="size-3.5" />
                      {t('call.edit_details')}
                    </Button>
                  )}
                  <Button variant="destructive-ghost" size="sm" onClick={() => void remove()}>
                    <Trash2 aria-hidden="true" className="size-3.5" />
                    {t('call.delete')}
                  </Button>
                </div>
              </div>

              {/* Docked WavePlayer bar inside sticky header */}
              {call.audio_path && (
                <div className="border-t border-border-subtle pt-2.5">
                  <WavePlayer
                    ref={playerRef}
                    url={api.audioUrl(callId)}
                    onTimeUpdate={setCurrentTime}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </Reveal>

      {/* Processing / Error Banner */}
      {draftMsg && (
        <Reveal>
          <Card className="border-primary/30 bg-primary-soft/20">
            <CardContent className="flex items-start justify-between gap-3 p-4">
              <div className="space-y-1 text-xs">
                <p className="font-semibold text-primary">
                  {lang === 'uz' ? 'Mijozga yuborish uchun xabar:' : 'Drafted Follow-up Message:'}
                </p>
                <p className="whitespace-pre-wrap leading-relaxed text-foreground">{draftMsg}</p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(draftMsg)
                    toast.success(lang === 'uz' ? 'Nusxalandi' : 'Copied')
                  }}
                >
                  {lang === 'uz' ? 'Nusxalash' : 'Copy'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDraftMsg(null)}>
                  ×
                </Button>
              </div>
            </CardContent>
          </Card>
        </Reveal>
      )}
      {(processing || call.status === 'error') && (
        <Reveal>
          <div
            role="status"
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-5 text-center',
              call.status === 'error'
                ? 'border-destructive/30 bg-destructive-soft/40'
                : 'border-border'
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

      {/* 2. Metasell 2-Pane Split Coaching Workspace (5 cols Evaluation + 7 cols Transcript) */}
      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        {hasAnalysis && (
          <div className="space-y-4 lg:col-span-5">
            {/* Outactive AI Escalation Banner */}
            {escalation && (
              <Reveal>
                <div
                  className={cn(
                    'rounded-lg border p-3.5 shadow-xs transition-all',
                    escalation.status === 'resolved'
                      ? 'border-success/30 bg-success/5'
                      : escalation.severity === 'critical'
                        ? 'border-destructive/40 bg-destructive/10'
                        : 'border-warning/40 bg-warning/10'
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2.5">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant={
                            escalation.status === 'resolved'
                              ? 'success'
                              : escalation.severity === 'critical'
                                ? 'destructive'
                                : 'warning'
                          }
                          className="font-mono text-2xs"
                        >
                          {escalation.status === 'resolved'
                            ? t('escalation.resolved')
                            : `${t('escalation.badge')}: ${escalation.severity.toUpperCase()}`}
                        </Badge>
                        <span className="text-xs font-semibold">{escalation.detected_problem}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        <strong className="text-foreground">{t('escalation.assigned_to')}:</strong>{' '}
                        <span className="font-medium text-foreground">
                          {escalation.assigned_user_name || 'Masʼul xodim'}
                        </span>{' '}
                        ({escalation.assigned_user_title || escalation.assigned_user_role}) &bull;{' '}
                        <span>{escalation.assigned_user_email}</span>
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {escalation.status !== 'resolved' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={resolving}
                          className="border-success/40 text-success hover:bg-success/10 hover:text-success"
                          onClick={() => void handleResolveEscalation()}
                        >
                          <Check className="size-3.5" />
                          {t('escalation.mark_resolved')}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="mt-2.5 rounded-md border border-border/60 bg-background/70 p-2.5 text-xs text-muted-foreground space-y-1.5">
                    <p>
                      <strong className="text-foreground">{t('escalation.reason')}:</strong>{' '}
                      {escalation.assigned_reason}
                    </p>
                    {escalation.action_plan && escalation.action_plan.length > 0 && (
                      <div>
                        <strong className="text-foreground">{t('escalation.action_plan')}:</strong>
                        <ul className="mt-1 list-disc pl-4 space-y-0.5">
                          {escalation.action_plan.map((step, idx) => (
                            <li key={idx}>{step}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Delivery Status */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-2xs">
                    <span className="text-muted-foreground">{t('escalation.dispatch_status')}:</span>
                    {escalation.email_status && (
                      <Badge
                        variant={escalation.email_status === 'sent' ? 'outline' : 'secondary'}
                        className={escalation.email_status === 'sent' ? 'border-primary/40 text-primary' : ''}
                      >
                        <Mail className="mr-1 size-3" />
                        Gmail: {escalation.email_status}
                      </Badge>
                    )}
                    {escalation.telegram_status && (
                      <Badge
                        variant={escalation.telegram_status === 'sent' ? 'outline' : 'secondary'}
                        className={escalation.telegram_status === 'sent' ? 'border-primary/40 text-primary' : ''}
                      >
                        <Send className="mr-1 size-3" />
                        Telegram: {escalation.telegram_status}
                      </Badge>
                    )}
                  </div>
                </div>
              </Reveal>
            )}

            {/* Card 1: Consolidated AI Evaluation Card (Score + Summary + 7-Dim Rubric) */}
            <Reveal>
              <Card>
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
                <CardContent className="space-y-4 p-4">
                  {/* Compact side-by-side Score + Outcome + Talk Share header */}
                  <div className="flex flex-wrap items-center gap-4">
                    <ScoreRing score={overall ?? 0} size={88} stroke={8} delay={0.1} />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={cn('text-sm font-semibold', scoreColor(overall))}>
                          {scoreLabel(overall, lang)}
                        </p>
                        {analysis.coach_decision && (
                          <Badge
                            variant={
                              analysis.coach_decision === 'ESCALATE'
                                ? 'destructive'
                                : analysis.coach_decision === 'COACH'
                                  ? 'warning'
                                  : 'success'
                            }
                            className="font-mono text-2xs"
                          >
                            {t('call.coach_decision')}: {analysis.coach_decision}
                          </Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-md bg-surface-sunken px-2.5 py-1.5 ring-1 ring-border-subtle ring-inset">
                          <p className="eyebrow">{t('call.outcome')}</p>
                          <p className="mt-0.5 text-xs font-semibold capitalize">
                            {analysis.outcome ?? '—'}
                          </p>
                        </div>
                        <div className="rounded-md bg-surface-sunken px-2.5 py-1.5 ring-1 ring-border-subtle ring-inset">
                          <p className="eyebrow">{t('call.talk_ratio')}</p>
                          <p className="mt-0.5 text-xs font-semibold tabular-nums">
                            {analysis.rep_share_of_talk != null
                              ? `${Math.round(analysis.rep_share_of_talk * 100)}%`
                              : '—'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Executive Summary */}
                  {analysis.summary && (
                    <>
                      <Separator />
                      <div className="space-y-1.5">
                        <p className="eyebrow flex items-center gap-1.5">
                          <Lightbulb aria-hidden="true" className="size-3 text-warning" />
                          {t('call.summary')}
                        </p>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          {analysis.summary}
                        </p>
                      </div>
                    </>
                  )}

                  {/* Key Metrics Badges */}
                  {analysis.key_metrics?.length ? (
                    <div className="space-y-1.5">
                      <p className="eyebrow">{t('call.key_metrics')}</p>
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
                  ) : null}

                  {/* Integrated 7-Dimension Rubric Scorecard */}
                  {analysis.scorecard && (
                    <>
                      <Separator />
                      <ScorecardView scorecard={analysis.scorecard} embedded />
                    </>
                  )}
                </CardContent>
              </Card>
            </Reveal>

            {/* Card 2: Tabbed Coaching, Action Items & Acoustic Telemetry Card */}
            <Reveal>
              <Card>
                <Tabs defaultValue="coaching" className="gap-0">
                  <CardHeader className="border-b border-border-subtle pb-2.5">
                    <TabsList className="w-full justify-start">
                      <TabsTrigger value="coaching">
                        <Lightbulb aria-hidden="true" className="text-warning" />
                        {t('call.tab.coaching')}
                        {coachingCount > 0 ? <Count>{coachingCount}</Count> : null}
                      </TabsTrigger>
                      <TabsTrigger value="action-items">
                        <CheckSquare aria-hidden="true" className="text-primary" />
                        {t('call.tab.action_items')}
                        {actionCount > 0 ? <Count>{actionCount}</Count> : null}
                      </TabsTrigger>
                      {acoustics && (
                        <TabsTrigger value="acoustics">
                          <Activity aria-hidden="true" className="text-chart-6" />
                          {t('call.acoustics.title')}
                        </TabsTrigger>
                      )}
                    </TabsList>
                  </CardHeader>

                  <CardContent className="pt-3">
                    {/* Tab 1: Problem & Solutions + Coaching Points + Clickable Evidence Quotes */}
                    <TabsContent value="coaching" className="space-y-4">
                      {problem && (
                        <div className="space-y-2.5 rounded-lg border border-warning/30 bg-warning-soft/40 p-3">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-warning-soft-foreground">
                            <TriangleAlert aria-hidden="true" className="size-3.5 text-warning" />
                            {t('call.problem')}
                          </div>
                          <p className="text-sm leading-relaxed text-foreground">{problem}</p>
                          {solutions.length > 0 && (
                            <div className="space-y-1.5 border-t border-warning/20 pt-2">
                              <p className="eyebrow">{t('call.solutions')}</p>
                              <ol className="space-y-1.5">
                                {solutions.map((s, i) => (
                                  <li
                                    key={i}
                                    className="flex items-start gap-2 text-xs leading-relaxed text-warning-soft-foreground"
                                  >
                                    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm text-2xs font-semibold tabular-nums ring-1 ring-current/25 ring-inset">
                                      {i + 1}
                                    </span>
                                    <span>{s}</span>
                                  </li>
                                ))}
                              </ol>
                            </div>
                          )}
                        </div>
                      )}

                      {analysis.coaching_points?.length ? (
                        <ol className="space-y-2">
                          {analysis.coaching_points.map((s, i) => (
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
                      ) : !problem ? (
                        <p className="py-6 text-center text-xs text-muted-foreground">
                          {t('emp.no_coaching')}
                        </p>
                      ) : null}

                      {analysis.evidence_quotes?.length ? (
                        <div className="space-y-2 border-t border-border-subtle pt-3">
                          <p className="eyebrow">{t('call.evidence_quotes')}</p>
                          {analysis.evidence_quotes.map((eq, idx) => (
                            <div
                              key={idx}
                              onClick={() => {
                                if (eq.start_sec != null) playerRef.current?.seek(eq.start_sec)
                              }}
                              className={cn(
                                'rounded-md border border-border-subtle bg-surface-sunken/70 p-2.5 text-xs transition-colors',
                                eq.start_sec != null &&
                                  'cursor-pointer hover:border-primary/40 hover:bg-surface-hover'
                              )}
                            >
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <Badge variant="outline" className="text-[10px] capitalize">
                                  {eq.dimension.replace(/_/g, ' ')}
                                </Badge>
                                {eq.start_sec != null && (
                                  <span className="inline-flex items-center gap-1 font-mono text-[10px] text-primary">
                                    <Play className="size-2.5 fill-current" />
                                    {formatDuration(eq.start_sec)}
                                  </span>
                                )}
                              </div>
                              <p className="italic text-foreground">“{eq.quote}”</p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </TabsContent>

                    {/* Tab 2: Action Items + Next Steps */}
                    <TabsContent value="action-items" className="space-y-4">
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
                        <p className="py-4 text-center text-xs text-muted-foreground">
                          {t('call.no_action_items')}
                        </p>
                      )}

                      {analysis.next_steps?.length ? (
                        <div className="space-y-2 border-t border-border-subtle pt-3">
                          <p className="eyebrow flex items-center gap-1.5">
                            <Target aria-hidden="true" className="size-3 text-chart-6" />
                            {t('call.tab.next_steps')}
                          </p>
                          <ol className="space-y-2">
                            {analysis.next_steps.map((s, i) => (
                              <li
                                key={i}
                                className="flex items-start gap-2.5 rounded-md bg-surface-sunken px-3 py-2 ring-1 ring-border-subtle ring-inset"
                              >
                                <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-sm bg-surface-active text-2xs font-semibold tabular-nums text-muted-foreground">
                                  {i + 1}
                                </span>
                                <span className="text-sm leading-relaxed">{s}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      ) : null}
                    </TabsContent>

                    {/* Tab 3: Acoustic Telemetry */}
                    {acoustics && (
                      <TabsContent value="acoustics">
                        <div className="grid grid-cols-3 gap-2">
                          <div className="rounded-md bg-surface-sunken px-2.5 py-2 ring-1 ring-border-subtle ring-inset">
                            <p className="eyebrow">{t('call.acoustics.dead_air')}</p>
                            <p className="mt-0.5 text-sm font-semibold tabular-nums">
                              {Math.round((acoustics.silence_ratio ?? 0) * 100)}%
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {formatDuration(acoustics.silence_sec)}
                            </p>
                          </div>
                          <div className="rounded-md bg-surface-sunken px-2.5 py-2 ring-1 ring-border-subtle ring-inset">
                            <p className="eyebrow">{t('call.acoustics.longest_silence')}</p>
                            <p className="mt-0.5 text-sm font-semibold tabular-nums">
                              {formatDuration(acoustics.longest_silence_sec)}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {acoustics.dead_air_count} gaps ≥3s
                            </p>
                          </div>
                          <div className="rounded-md bg-surface-sunken px-2.5 py-2 ring-1 ring-border-subtle ring-inset">
                            <p className="eyebrow">{t('call.acoustics.interruptions')}</p>
                            <p className="mt-0.5 text-sm font-semibold tabular-nums">
                              {acoustics.interruption_count ?? 0}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {formatDuration(acoustics.talk_over_sec ?? 0)}
                            </p>
                          </div>
                        </div>
                      </TabsContent>
                    )}
                  </CardContent>
                </Tabs>
              </Card>
            </Reveal>
          </div>
        )}

        {/* Right Pane: Synchronized Chat-Style Transcript (7 cols when analysis exists, 12 cols otherwise) */}
        <div className={cn(hasAnalysis ? 'lg:col-span-7' : 'lg:col-span-12')}>
          <Reveal>
            <Card>
              <CardHeader className="flex flex-col gap-2.5 border-b border-border-subtle pb-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="flex items-center gap-1.5">
                  <MessageSquare aria-hidden="true" className="size-3.5 text-primary" />
                  {t('call.transcript')}
                  {call.segments.length > 0 && <Count>{call.segments.length}</Count>}
                </CardTitle>
                <div className="flex flex-wrap items-center gap-1.5">
                  {!editing && call.segments.length > 0 && (
                    <div className="relative w-44 sm:w-52">
                      <Search
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                      />
                      <Input
                        value={transcriptQuery}
                        onChange={(e) => setTranscriptQuery(e.target.value)}
                        placeholder={t('calls.search_placeholder')}
                        aria-label={t('calls.search_placeholder')}
                        className="h-8 pl-8 text-xs"
                      />
                    </div>
                  )}
                  {editing ? (
                    <>
                      <Button
                        size="sm"
                        onClick={() => void saveTranscript()}
                        title={t('call.save_shortcut')}
                      >
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void copyTranscript()}
                        disabled={!call.transcript}
                      >
                        {copied ? (
                          <Check aria-hidden="true" className="size-3.5" />
                        ) : (
                          <Copy aria-hidden="true" className="size-3.5" />
                        )}
                        <span className="sr-only sm:not-sr-only">
                          {copied ? t('call.copied') : t('call.copy')}
                        </span>
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
                  <TranscriptView
                    call={call}
                    currentTime={currentTime}
                    query={transcriptQuery}
                    onSeek={(sec) => playerRef.current?.seek(sec)}
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <MessageSquare aria-hidden="true" className="size-7 text-muted-foreground/40" />
                    <p className="text-xs text-muted-foreground">{t('call.no_transcript')}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </Reveal>
        </div>
      </div>

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
                    placeholder={
                      clientsLoading ? t('call.loading_clients') : t('upload.no_client')
                    }
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

      {/* Escalate / Outbound Dispatch Dialog */}
      <Dialog open={escalateModalOpen} onOpenChange={setEscalateModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('escalation.modal_title')}</DialogTitle>
            <DialogDescription>{t('escalation.modal_desc')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="esc-assignee">{t('escalation.select_assignee')}</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger id="esc-assignee">
                  <SelectValue placeholder={t('escalation.auto_ai_choice')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t('escalation.auto_ai_choice')}</SelectItem>
                  {assignUserList.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.name} ({u.job_title || u.role}) — {u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="esc-problem">{t('escalation.problem_label')}</Label>
              <Input
                id="esc-problem"
                value={problemDescription}
                onChange={(e) => setProblemDescription(e.target.value)}
                placeholder={t('escalation.problem_placeholder')}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="esc-reason">{t('escalation.reason_label')}</Label>
              <Textarea
                id="esc-reason"
                rows={2}
                value={escalateReason}
                onChange={(e) => setEscalateReason(e.target.value)}
                placeholder={t('escalation.reason_placeholder')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEscalateModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void handleManualEscalate()} disabled={escalating}>
              {t('escalation.dispatch_action')}
            </Button>
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

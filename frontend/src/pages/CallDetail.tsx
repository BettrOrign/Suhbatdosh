import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
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
  TriangleAlert,
  Trash2,
} from 'lucide-react'

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
import { AnimatedNumber } from '@/components/AnimatedNumber'
import { Reveal } from '@/lib/motion'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useI18n } from '@/i18n/i18n'
import { formatDate, formatDuration, statusVariant } from '@/lib/format'
import type { Call, CallType, Client } from '@/lib/types'

const NO_CLIENT = 'none'

interface CallAnalysisExtras {
  problem?: string | null
  solutions?: string[]
  error?: string
}

const PROCESSING_STATES = ['uploaded', 'queued', 'transcribing', 'transcribed', 'analyzing'] as const

const SPEAKER_PALETTE = [
  { fg: '#4f46e5', bg: 'rgba(79, 70, 229, 0.10)', border: 'rgba(79, 70, 229, 0.30)' },
  { fg: '#0e7490', bg: 'rgba(14, 116, 144, 0.10)', border: 'rgba(14, 116, 144, 0.30)' },
  { fg: '#be185d', bg: 'rgba(190, 24, 93, 0.10)', border: 'rgba(190, 24, 93, 0.30)' },
  { fg: '#4d7c0f', bg: 'rgba(77, 124, 15, 0.10)', border: 'rgba(77, 124, 15, 0.30)' },
  { fg: '#b45309', bg: 'rgba(180, 83, 9, 0.10)', border: 'rgba(180, 83, 9, 0.30)' },
  { fg: '#7c3aed', bg: 'rgba(124, 58, 237, 0.10)', border: 'rgba(124, 58, 237, 0.30)' },
]

function speakerStyle(label: string): CSSProperties {
  let h = 0
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0
  const c = SPEAKER_PALETTE[h % SPEAKER_PALETTE.length]
  return { color: c.fg, backgroundColor: c.bg, border: `1px solid ${c.border}` }
}

function speakerColor(label: string): string {
  let h = 0
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0
  return SPEAKER_PALETTE[h % SPEAKER_PALETTE.length].fg
}

function ScoreRing({ score, size = 120 }: { score: number; size?: number }) {
  const radius = (size - 12) / 2
  const circumference = 2 * Math.PI * radius
  const pct = Math.max(0, Math.min(100, score))
  const offset = circumference - (pct / 100) * circumference
  const color = score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#ef4444'
  const bgColor = score >= 70 ? 'rgba(16,185,129,0.1)' : score >= 40 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)'

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="size-full -rotate-90" viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={bgColor}
          strokeWidth={10}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <AnimatedNumber value={score} className="text-4xl font-bold" />
        <span className="text-xs text-muted-foreground">/ 100</span>
      </div>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <Skeleton className="mb-6 h-32 rounded-2xl" />
      <Skeleton className="mb-6 h-24 rounded-2xl" />
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
      <Skeleton className="mb-6 h-64 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  )
}

function TranscriptView({ segments, transcript }: { segments: Call['segments']; transcript: string }) {
  if (segments.length > 0) {
    return (
      <div className="max-h-[520px] space-y-4 overflow-y-auto pr-2">
        {segments.map((s, i) => {
          const hasMeta = s.speaker_label != null || s.language_code != null
          return (
            <motion.div
              key={i}
              className="flex gap-3"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.02, duration: 0.3 }}
            >
              {hasMeta && (
                <div className="flex shrink-0 flex-col items-end gap-1 pt-1">
                  {s.speaker_label && (
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                      style={speakerStyle(s.speaker_label)}
                    >
                      {s.speaker_label}
                    </span>
                  )}
                  {s.language_code && (
                    <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <Globe className="size-2.5" />
                      {s.language_code}
                    </span>
                  )}
                </div>
              )}
              <div
                className="flex-1 rounded-xl border px-4 py-3 text-sm leading-relaxed"
                style={s.speaker_label ? {
                  borderColor: `${speakerColor(s.speaker_label)}20`,
                  backgroundColor: `${speakerColor(s.speaker_label)}05`,
                } : {}}
              >
                {s.text}
              </div>
            </motion.div>
          )
        })}
      </div>
    )
  }
  return <p className="whitespace-pre-wrap text-sm leading-relaxed">{transcript}</p>
}

export function CallDetail() {
  const { t } = useI18n()
  const { id } = useParams()
  const navigate = useNavigate()
  const callId = Number(id)
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [call, setCall] = useState<Call | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editType, setEditType] = useState<CallType>('manager')
  const [editClient, setEditClient] = useState<string>(NO_CLIENT)
  const [clients, setClients] = useState<Client[]>([])
  const [clientsLoading, setClientsLoading] = useState(false)
  const pollTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!id || isNaN(callId)) {
      navigate('/')
    }
  }, [id, callId, navigate])

  const refresh = useCallback(async () => {
    try {
      setCall(await api.getCall(callId))
    } catch (e) {
      toast.error(t('call.load_failed', { error: (e as Error).message }))
    } finally {
      setLoading(false)
    }
  }, [callId, t])

  useEffect(() => {
    refresh()
    if (pollTimer.current) window.clearInterval(pollTimer.current)
    pollTimer.current = window.setInterval(() => {
      refresh().then(() => {
        // Stop polling once call reaches a terminal state
      })
    }, 10000)
    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current)
    }
  }, [refresh])

  // Stop polling when call reaches terminal state
  useEffect(() => {
    if (call && ['done', 'error'].includes(call.status) && pollTimer.current) {
      window.clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }, [call?.status])

  const saveTranscript = useCallback(async () => {
    try {
      await api.updateTranscript(callId, draft)
      toast.success(t('call.saved'))
      setEditing(false)
      await refresh()
    } catch (e) {
      toast.error(t('call.save_failed', { error: (e as Error).message }))
    }
  }, [callId, draft, t, refresh])

  useEffect(() => {
    if (!editing) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void saveTranscript()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [editing, saveTranscript])

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
    if (!window.confirm(t('call.delete_confirm', { name: call?.name ?? '' }))) return
    try {
      await api.deleteCall(callId)
      navigate('/')
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

  useEffect(() => {
    if (!editOpen) return
    setClientsLoading(true)
    api
      .listClients()
      .then(setClients)
      .catch(() => toast.error(t('call.clients_load_failed')))
      .finally(() => setClientsLoading(false))
  }, [editOpen, t])

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

  if (loading) return <LoadingSkeleton />
  if (!call) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center gap-4 py-20">
            <PhoneCall className="size-10 text-muted-foreground" />
            <p className="text-muted-foreground">{t('call.not_found')}</p>
            <Button asChild variant="outline">
              <Link to="/">Back to dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const analysis = call.analysis as Partial<Call['analysis']>
  const problemExtras = analysis as unknown as CallAnalysisExtras
  const analysisError =
    typeof problemExtras.error === 'string' && problemExtras.error.trim() !== ''
      ? problemExtras.error.trim()
      : ''
  const hasAnalysis = call.status === 'done' && analysis.scorecard != null
  const processing = PROCESSING_STATES.includes(call.status as (typeof PROCESSING_STATES)[number])
  const overall = analysis.scorecard?.overall ?? 0
  const displayName = (call.status === 'done' && typeof analysis.topic === 'string' && analysis.topic) || call.name

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8">
      {/* Hero Header */}
      <Reveal>
        <div className="mb-6 overflow-hidden rounded-2xl border border-border/70 bg-card p-6 shadow-xs relative">
          <div className="absolute top-0 right-0 -mt-10 -mr-10 size-48 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 relative">
            <div className="flex items-start gap-3.5">
              <Button
                variant="outline"
                size="icon"
                asChild
                className="mt-0.5 size-9 rounded-xl shrink-0"
              >
                <Link to="/calls/" aria-label={t('call.back')}>
                  <ArrowLeft className="size-4" />
                </Link>
              </Button>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">{displayName}</h1>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    <Clock className="size-3" />
                    {formatDuration(call.duration_sec)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    {formatDate(call.created_at)}
                  </span>
                  {call.language && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary uppercase tracking-wider">
                      <Globe className="size-3" />
                      {call.language}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1 text-xs font-medium capitalize text-muted-foreground">
                    <PhoneCall className="size-3" />
                    {call.call_type}
                  </span>
                  {call.client_name && (
                    <Link
                      to="/clients"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
                    >
                      {call.client_name}
                    </Link>
                  )}
                  {call.uploader_name && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      by {call.uploader_name}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <Badge
                variant={statusVariant(call.status)}
                className={`text-xs font-semibold px-3 py-1 ${
                  call.status === 'done' ? 'color-badge-good' :
                  call.status === 'error' ? 'color-badge-bad' : ''
                }`}
              >
                {t('status.' + call.status)}
              </Badge>
            </div>
          </div>
          <div className="mt-5 pt-4 border-t border-border/50 flex flex-wrap items-center gap-2">
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={openEdit}
                className="gap-1.5 text-xs rounded-xl"
              >
                <FilePenLine className="size-3.5" /> {t('call.edit_details')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={reanalyze}
              disabled={!call.transcript}
              className="gap-1.5 text-xs rounded-xl"
            >
              <RefreshCw className="size-3.5" /> {t('call.reanalyze')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={remove}
              className="gap-1.5 text-xs rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive ml-auto"
            >
              <Trash2 className="size-3.5" /> {t('call.delete')}
            </Button>
          </div>
        </div>
      </Reveal>

      {/* Audio Player */}
      <Reveal>
        <Card className="mb-6 overflow-hidden border-border/70 bg-card shadow-xs">
          <CardContent className="py-4">
            <WavePlayer url={api.audioUrl(callId)} />
          </CardContent>
        </Card>
      </Reveal>

      {/* Processing / failure indicator */}
      {(processing || call.status === 'error') && (
        <Reveal>
          <Card className="mb-6 border-dashed border-2 border-indigo-200 dark:border-indigo-800/50">
            <CardContent className="flex flex-col items-center justify-center gap-2 py-6 text-center">
              <div className="flex items-center gap-3">
                <span
                  className={`size-2.5 rounded-full ${
                    call.status === 'error' ? 'bg-destructive' : 'animate-pulse-soft bg-indigo-500'
                  }`}
                />
                <span className="text-sm font-medium text-muted-foreground">
                  {call.status === 'error'
                    ? t('call.analysis_failed')
                    : `${t('dashboard.proc_short')} — analyzing call...`}
                </span>
              </div>
              {analysisError && (
                <p className="line-clamp-3 w-full break-words font-mono text-[11px] leading-relaxed text-destructive/80">
                  {analysisError}
                </p>
              )}
              {call.status === 'error' && (
                <p className="text-xs text-muted-foreground">{t('call.analysis_failed_hint')}</p>
              )}
            </CardContent>
          </Card>
        </Reveal>
      )}

      {/* Analysis Content */}
      {hasAnalysis && (
        <>
          {/* Score + Summary Hero */}
          <Reveal>
            <div className="mb-6 grid gap-5 lg:grid-cols-5">
              {/* Score Ring */}
              <Card className="lg:col-span-2 overflow-hidden border-border/70 bg-card shadow-xs">
                <div className={`h-1 w-full ${
                  overall >= 70 ? 'bg-emerald-500' :
                  overall >= 40 ? 'bg-amber-500' :
                  'bg-red-500'
                }`} />
                <CardContent className="flex flex-col items-center justify-center py-8">
                  <ScoreRing score={overall} size={140} />
                  <motion.p
                    className={`mt-4 text-base font-bold ${
                      overall >= 70 ? 'text-emerald-600 dark:text-emerald-400' :
                      overall >= 40 ? 'text-amber-600 dark:text-amber-400' :
                      'text-red-600 dark:text-red-400'
                    }`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                  >
                    {overall >= 70 ? t('call.strong') : overall >= 40 ? t('call.needs_work') : t('call.weak')}
                  </motion.p>
                </CardContent>
              </Card>

              {/* Summary + Details */}
              <Card className="lg:col-span-3 border-border/70 bg-card shadow-xs">
                <CardHeader className="pb-3 border-b border-border/50">
                  <CardTitle className="flex items-center gap-2 text-base font-bold text-foreground">
                    <Lightbulb className="size-4 text-amber-500" />
                    {t('call.summary')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  <p className="text-sm leading-relaxed text-muted-foreground">{analysis.summary}</p>
                  <Separator />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{t('call.outcome')}</p>
                      <p className="mt-1 text-sm font-semibold capitalize text-foreground">{analysis.outcome ?? '—'}</p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Rep share of talk</p>
                      <p className="mt-1 text-sm font-semibold text-foreground">
                        {analysis.rep_share_of_talk != null ? `${Math.round(analysis.rep_share_of_talk * 100)}%` : '—'}
                      </p>
                    </div>
                  </div>
                  {!!analysis.key_metrics?.length && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">{t('call.key_metrics')}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {analysis.key_metrics.map((m, i) => (
                            <Badge
                              key={i}
                              variant="secondary"
                              className="bg-muted/70 text-foreground border border-border/60 text-xs font-normal"
                            >
                              <span className="font-semibold text-muted-foreground mr-1">{m.name}:</span> {m.value}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </Reveal>

          {/* Problem + Solutions */}
          {typeof problemExtras.problem === 'string' &&
            problemExtras.problem!.trim() !== '' && (
              <Reveal>
                <Card className="mb-6 overflow-hidden border-border/70 bg-card shadow-xs">
                  <div className="h-1 w-full bg-amber-500" />
                  <CardHeader className="pb-3 border-b border-border/50">
                    <CardTitle className="flex items-center gap-2 text-base font-bold text-foreground">
                      <TriangleAlert className="size-4 text-amber-500" />
                      {t('call.problem')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-4">
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {problemExtras.problem}
                    </p>
                    {Array.isArray(problemExtras.solutions) &&
                      problemExtras.solutions!.length > 0 && (
                        <>
                          <Separator />
                          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                            {t('call.solutions')}
                          </p>
                          <div className="grid gap-2.5">
                            {problemExtras.solutions!.map((s, i) => (
                              <div
                                key={i}
                                className="flex items-start gap-3 rounded-xl border border-amber-200/60 bg-amber-50/30 p-3.5 dark:border-amber-800/30 dark:bg-amber-950/20"
                              >
                                <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-xs font-bold text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                                  {i + 1}
                                </div>
                                <span className="text-sm leading-relaxed text-foreground">{s}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                  </CardContent>
                </Card>
              </Reveal>
            )}

          {/* Metrics */}
          <Reveal>
            <div className="mb-6">
              <ScorecardView scorecard={analysis.scorecard!} />
            </div>
          </Reveal>

          {/* Coaching & Action Items Tabs */}
          <Reveal>
            <Tabs defaultValue="action-items" className="mb-6">
              <TabsList className="mb-4 bg-muted/60 p-1 rounded-xl">
                <TabsTrigger value="action-items" className="gap-1.5 rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-xs">
                  <CheckSquare className="size-3.5 text-primary" />
                  {t('call.tab.action_items')}
                  {analysis.action_items && analysis.action_items.length > 0 && (
                    <span className="ml-1 rounded-full bg-primary/15 text-primary px-1.5 py-0.2 text-[10px] font-bold">
                      {analysis.action_items.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="coaching" className="gap-1.5 rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-xs">
                  <Lightbulb className="size-3.5 text-amber-500" />
                  {t('call.tab.coaching')}
                  {analysis.coaching_points && analysis.coaching_points.length > 0 && (
                    <span className="ml-1 rounded-full bg-muted text-muted-foreground px-1.5 py-0.2 text-[10px] font-semibold">
                      {analysis.coaching_points.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="next-steps" className="gap-1.5 rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-xs">
                  <Target className="size-3.5 text-cyan-500" />
                  {t('call.tab.next_steps')}
                  {analysis.next_steps && analysis.next_steps.length > 0 && (
                    <span className="ml-1 rounded-full bg-muted text-muted-foreground px-1.5 py-0.2 text-[10px] font-semibold">
                      {analysis.next_steps.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* Action Items Tab */}
              <TabsContent value="action-items">
                <Card className="overflow-hidden border-border/70 bg-card shadow-xs">
                  <CardHeader className="pb-3 border-b border-border/50">
                    <CardTitle className="flex items-center gap-2 text-base font-bold text-foreground">
                      <CheckSquare className="size-4 text-primary" />
                      {t('call.action_items')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                    {analysis.action_items && analysis.action_items.length > 0 ? (
                      <div className="grid gap-2.5">
                        {analysis.action_items.map((item, i) => {
                          const priorityClass =
                            item.priority === 'high' ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800/40' :
                            item.priority === 'medium' ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/40' :
                            'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'

                          return (
                            <motion.div
                              key={i}
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: i * 0.05 }}
                              className="flex items-start gap-3.5 rounded-xl border border-border/70 bg-muted/20 p-3.5 hover:border-border transition-colors"
                            >
                              <div className="mt-0.5 size-5 shrink-0 rounded-md border border-primary/30 bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                                {i + 1}
                              </div>
                              <div className="min-w-0 flex-1 space-y-1.5">
                                <p className="text-sm font-medium text-foreground leading-relaxed">
                                  {item.description}
                                </p>
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                  <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wider ${priorityClass}`}>
                                    {item.priority}
                                  </span>
                                  <span className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[11px] font-medium capitalize">
                                    {item.assignee}
                                  </span>
                                  {item.due_date && (
                                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground font-mono">
                                      <Clock className="size-3" />
                                      {item.due_date}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                        <CheckSquare className="size-8 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">{t('call.no_action_items')}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Coaching Points */}
              <TabsContent value="coaching">
                <Card className="overflow-hidden border-border/70 bg-card shadow-xs">
                  <CardHeader className="pb-3 border-b border-border/50">
                    <CardTitle className="flex items-center gap-2 text-base font-bold text-foreground">
                      <Lightbulb className="size-4 text-amber-500" />
                      {t('call.coaching_points')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <div className="grid gap-2.5">
                      {analysis.coaching_points?.map((s, i) => (
                        <motion.div
                          key={i}
                          className="flex items-start gap-3.5 rounded-xl border border-border/70 bg-muted/20 p-3.5 hover:border-border transition-colors"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.05 }}
                        >
                          <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                            {i + 1}
                          </div>
                          <span className="text-sm leading-relaxed text-foreground">{s}</span>
                        </motion.div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Next Steps */}
              <TabsContent value="next-steps">
                <Card className="overflow-hidden border-border/70 bg-card shadow-xs">
                  <CardHeader className="pb-3 border-b border-border/50">
                    <CardTitle className="flex items-center gap-2 text-base font-bold text-foreground">
                      <Target className="size-4 text-cyan-500" />
                      {t('call.next_steps')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <div className="grid gap-2.5">
                      {analysis.next_steps?.map((s, i) => (
                        <motion.div
                          key={i}
                          className="flex items-start gap-3.5 rounded-xl border border-border/70 bg-muted/20 p-3.5 hover:border-border transition-colors"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.05 }}
                        >
                          <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-cyan-500/15 text-xs font-bold text-cyan-600 dark:text-cyan-400">
                            {i + 1}
                          </div>
                          <span className="text-sm leading-relaxed text-foreground">{s}</span>
                        </motion.div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </Reveal>
        </>
      )}

      {/* Transcript */}
      <Reveal>
        <Card className="overflow-hidden border-border/70 bg-card shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-border/50">
            <CardTitle className="flex items-center gap-2 text-base font-bold text-foreground">
              <MessageSquare className="size-4 text-primary" />
              {t('call.transcript')}
            </CardTitle>
            <div className="flex gap-2">
              {editing ? (
                <>
                  <Button onClick={saveTranscript} title={t('call.save_shortcut')} className="gap-2">
                    <Check className="size-4" /> {t('call.save')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditing(false)
                      setDraft(call.transcript)
                    }}
                    className="gap-2"
                  >
                    {t('call.cancel')}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={copyTranscript} disabled={!call.transcript} className="gap-2">
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {copied ? t('call.copied') : t('call.copy')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDraft(call.transcript)
                      setEditing(true)
                    }}
                    disabled={!call.transcript}
                    className="gap-2"
                  >
                    <FilePenLine className="size-4" />
                    {t('call.edit')}
                  </Button>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {editing ? (
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.max(8, (call.transcript ?? '').split('\n').length + 2)}
                className="font-mono text-sm"
              />
            ) : call.transcript ? (
              <TranscriptView segments={call.segments} transcript={call.transcript} />
            ) : (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <MessageSquare className="size-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">{t('call.no_transcript')}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </Reveal>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('call.edit_details')}</DialogTitle>
            <DialogDescription>{t('call.edit_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{t('upload.call_type')}</Label>
              <Select value={editType} onValueChange={(v) => setEditType(v as CallType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">{t('call.manager_call')}</SelectItem>
                  <SelectItem value="receptionist">{t('call.receptionist_call')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('call.client')}</Label>
              <Select value={editClient} onValueChange={setEditClient}>
                <SelectTrigger className="w-full" disabled={clientsLoading}>
                  <SelectValue placeholder={clientsLoading ? t('call.loading_clients') : t('upload.no_client')} />
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
            <Button onClick={saveEdit}>{t('common.save_changes')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

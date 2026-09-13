import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { motion, useReducedMotion } from 'framer-motion'
import {
  ArrowRight,
  AudioWaveform,
  BarChart3,
  CircleAlert,
  Clock,
  FileAudio2,
  Gauge,
  KeyRound,
  Loader2,
  Mic,
  PhoneCall,
  Search,
  Upload,
  UploadCloud,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { fadeUp, Stagger } from '@/lib/motion'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useI18n } from '@/i18n/i18n'
import { TokenControl } from '@/components/TokenControl'
import { StatCard } from '@/components/StatCard'
import { ScoreDistributionChart } from '@/components/ScoreDistributionChart'
import { CallTypePieChart } from '@/components/CallTypePieChart'
import {
  formatDate,
  formatDuration,
  scoreColor,
  scoreLabel,
  statusVariant,
} from '@/lib/format'
import type { Call, CallType, Client } from '@/lib/types'

const NO_CLIENT = 'none'

interface CallAnalysisExtras {
  problem?: string | null
  solutions?: string[]
  error?: string
}

const TYPE_OPTIONS: { value: CallType; label: string }[] = [
  { value: 'manager', label: 'upload.call_type.manager' },
  { value: 'receptionist', label: 'upload.call_type.receptionist' },
]

const RING_COLOR = (v: number) =>
  v >= 70 ? 'var(--color-score-good)' : v >= 40 ? 'var(--color-score-warn)' : 'var(--color-score-bad)'

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function ScoreRing({ score }: { score: number }) {
  const size = 56
  const stroke = 5
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-muted)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={RING_COLOR(score)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ * (1 - Math.max(0, Math.min(100, score)) / 100) }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-bold tabular-nums">{score}</span>
      </div>
    </div>
  )
}

const PROCESSING_STATES = ['uploaded', 'queued', 'transcribing', 'transcribed', 'analyzing'] as const

function CallCard({ call }: { call: Call }) {
  const { t } = useI18n()
  const processing = PROCESSING_STATES.includes(call.status as (typeof PROCESSING_STATES)[number])
  const overall = call.status === 'done' ? call.analysis.scorecard?.overall : undefined
  const summary =
    call.status === 'done' && typeof call.analysis.summary === 'string' ? call.analysis.summary : ''
  const topic = call.status === 'done' && typeof call.analysis.topic === 'string' ? call.analysis.topic : ''
  const displayName = topic || call.name
  const extras = call.analysis as unknown as CallAnalysisExtras
  const problem = call.status === 'done' && typeof extras.problem === 'string' ? extras.problem : ''
  const outcome =
    call.status === 'done' && typeof call.analysis.outcome === 'string' ? call.analysis.outcome : ''
  const keyMetrics =
    call.status === 'done' && Array.isArray(call.analysis.key_metrics)
      ? call.analysis.key_metrics.slice(0, 3)
      : []
  const analysisError =
    typeof extras.error === 'string' && extras.error.trim() !== '' ? extras.error.trim() : ''

  return (
    <Link to={`/calls/${call.id}`} className="group block h-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 cursor-pointer">
      <Card className={`h-full overflow-hidden border-2 transition-all duration-300 ${
        call.status === 'done' ? 'border-transparent group-hover:border-emerald-300 group-hover:shadow-lg group-hover:shadow-emerald-500/10' :
        call.status === 'error' ? 'border-transparent group-hover:border-red-300 group-hover:shadow-lg group-hover:shadow-red-500/10' :
        'border-transparent group-hover:border-indigo-300 group-hover:shadow-lg group-hover:shadow-indigo-500/10'
      }`}>
        <div className={`h-1.5 w-full ${
          call.status === 'done' ? 'bg-gradient-to-r from-emerald-400 to-green-500' :
          call.status === 'error' ? 'bg-gradient-to-r from-red-400 to-rose-500' :
          call.status === 'analyzing' ? 'bg-gradient-to-r from-amber-400 to-yellow-500 animate-shimmer' :
          'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500'
        }`} />
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="line-clamp-1 text-base">{displayName}</CardTitle>
              <CardDescription className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3" />
                  {formatDuration(call.duration_sec)}
                </span>
                <span>{formatDate(call.created_at)}</span>
                {call.language && (
                  <span className="inline-flex items-center gap-1 rounded bg-indigo-100 px-1.5 py-0.5 uppercase tracking-wide text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400">
                    {call.language}
                  </span>
                )}
                {outcome && (
                  <span className="rounded-full bg-muted px-2 py-0.5 font-medium capitalize text-muted-foreground">
                    {outcome}
                  </span>
                )}
              </CardDescription>
            </div>
            <Badge variant={statusVariant(call.status)} className={call.status === 'done' ? 'color-badge-good' : call.status === 'error' ? 'color-badge-bad' : ''}>
              {t('status.' + call.status)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {processing && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <span className="size-1.5 animate-pulse-soft rounded-full bg-indigo-500" />
                <span className="text-xs text-muted-foreground">
                  {t('status.' + call.status)} in background…
                </span>
              </div>
              <Progress
                value={call.status === 'analyzing' ? 70 : 40}
                className="h-1.5 [&_[data-slot=progress-indicator]]:animate-pulse-soft"
              />
              {analysisError && (
                <p className="line-clamp-2 font-mono text-[11px] leading-relaxed text-destructive/80">
                  {analysisError}
                </p>
              )}
            </div>
          )}
          {call.status === 'error' && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive">
              <CircleAlert className="size-3.5" /> {t('status.error')}
            </div>
          )}
          {call.status === 'done' && overall != null && (
            <div className="flex items-center gap-3">
              <ScoreRing score={overall} />
              <div className="min-w-0 space-y-1">
                <p className={`text-[11px] font-semibold uppercase tracking-wide ${scoreColor(overall)}`}>
                  {scoreLabel(overall)} · {overall}/100
                </p>
                {summary && (
                  <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                    {summary}
                  </p>
                )}
              </div>
            </div>
          )}
          {call.status === 'done' && overall == null && (
            <p className="text-sm text-muted-foreground">Analysis ready — open to review.</p>
          )}
          {call.status === 'done' && problem && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 dark:border-amber-800/30 dark:bg-amber-950/20">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="line-clamp-2 text-xs leading-relaxed">
                <span className="font-semibold">{t('call.problem')}: </span>
                {problem}
              </p>
            </div>
          )}
          {call.status === 'done' && keyMetrics.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {keyMetrics.map((m, i) => (
                <span
                  key={i}
                  className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-400"
                >
                  {m.name}: {m.value}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            View details <ArrowRight className="size-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

function TypeSegmented({
  value,
  onChange,
  options,
}: {
  value: CallType
  onChange: (v: CallType) => void
  options: typeof TYPE_OPTIONS
}) {
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()

  return (
    <div className="flex w-full rounded-lg border border-input bg-muted/40 p-0.5">
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`relative flex-1 rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {!reduceMotion && active && (
              <motion.span
                layoutId="call-type-pill"
                className="absolute inset-0 rounded-md bg-background shadow-sm ring-1 ring-foreground/10"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
            <span className="relative">{t(opt.label)}</span>
          </button>
        )
      })}
    </div>
  )
}

const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200 MB
const SUPPORTED_TYPES = ['audio/', 'video/']

function isAudioVideo(file: File): boolean {
  return SUPPORTED_TYPES.some((p) => file.type.startsWith(p))
}

function Dropzone({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { t } = useI18n()

  const handleFile = (f: File | null) => {
    if (!f) {
      onFile(null)
      return
    }
    if (!isAudioVideo(f)) {
      toast.error(t('dashboard.invalid_file_type'))
      return
    }
    if (f.size > MAX_FILE_SIZE) {
      toast.error(t('dashboard.file_too_large', { size: formatBytes(f.size) }))
      return
    }
    onFile(f)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const f = e.dataTransfer.files?.[0]
        if (f) handleFile(f)
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center outline-none transition-all duration-300 focus-visible:border-indigo-500 focus-visible:ring-3 focus-visible:ring-indigo-500/40 ${
        dragOver ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20' : 'border-indigo-200 dark:border-indigo-900/50 hover:border-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20'
      }`}
    >
      <input
        ref={inputRef}
        id="file"
        type="file"
        accept="audio/*,video/*"
        className="sr-only"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <>
          <FileAudio2 className="size-7 text-primary" />
          <div className="flex max-w-full flex-col items-center gap-0.5">
            <span className="max-w-full truncate text-sm font-medium">{file.name}</span>
            <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation()
              onFile(null)
            }}
            className="h-8 gap-1.5 px-3 text-sm"
          >
            <X /> {t('call.cancel')}
          </Button>
        </>
      ) : (
        <>
          <UploadCloud className="size-7 text-muted-foreground" />
          <p className="text-sm font-medium">{t('dashboard.dropzone_title')}</p>
          <p className="text-xs text-muted-foreground">{t('dashboard.dropzone_desc')}</p>
        </>
      )}
    </div>
  )
}

export function Dashboard() {
  const { user } = useAuth()
  const { t } = useI18n()
  const role = user?.role
  const defaultCallType: CallType = role === 'receptionist' ? 'receptionist' : 'manager'

  const [calls, setCalls] = useState<Call[]>([])
  const [ownToken, setOwnToken] = useState<string | null>(user?.api_token ?? null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [callType, setCallType] = useState<CallType>(defaultCallType)
  const [clientId, setClientId] = useState<string>(NO_CLIENT)
  const [clients, setClients] = useState<Client[]>([])
  const [clientsLoading, setClientsLoading] = useState(false)
  const [search, setSearch] = useState('')
  const pollTimer = useRef<number | null>(null)
  const fetching = useRef(false)
  const reduceMotion = useReducedMotion()

  const typeOptions =
    role === 'admin' ? TYPE_OPTIONS : TYPE_OPTIONS.filter((o) => o.value === defaultCallType)

  const mounted = useRef(true)
  const refresh = useCallback(async () => {
    if (fetching.current) return
    fetching.current = true
    try {
      const data = await api.listCalls()
      if (mounted.current) setCalls(data)
    } catch {
      if (mounted.current) toast.error('Failed to load calls')
    } finally {
      fetching.current = false
      if (mounted.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user?.api_token) setOwnToken(user.api_token)
  }, [user?.api_token])

  useEffect(() => {
    mounted.current = true
    refresh()
    pollTimer.current = window.setInterval(refresh, 3000)
    return () => {
      mounted.current = false
      if (pollTimer.current) window.clearInterval(pollTimer.current)
    }
  }, [refresh])

  // Stop polling when no calls are in processing states
  useEffect(() => {
    const hasProcessing = calls.some((c) => !['done', 'error'].includes(c.status))
    if (!hasProcessing && pollTimer.current) {
      window.clearInterval(pollTimer.current)
      pollTimer.current = null
    } else if (hasProcessing && !pollTimer.current) {
    pollTimer.current = window.setInterval(refresh, 10000)
    }
  }, [calls, refresh])

  useEffect(() => {
    if (!dialogOpen) return
    setClientsLoading(true)
    api
      .listClients()
      .then(setClients)
      .catch(() => toast.error(t('dashboard.clients_load_failed')))
      .finally(() => setClientsLoading(false))
  }, [dialogOpen])

  const handleUpload = async () => {
    if (!file) {
      toast.error(t('dashboard.choose_first'))
      return
    }
    setUploading(true)
    try {
      await api.uploadCall(file, {
        name: name || file.name,
        call_type: callType,
        client_id: clientId === NO_CLIENT ? undefined : Number(clientId),
      })
      toast.success(t('dashboard.upload_success'))
      setFile(null)
      setName('')
      setClientId(NO_CLIENT)
      setDialogOpen(false)
      await refresh()
    } catch (e) {
      toast.error(t('dashboard.upload_error', { error: (e as Error).message }))
    } finally {
      setUploading(false)
    }
  }

  const processing = calls.filter((c) => !['done', 'error'].includes(c.status)).length
  const avgScore = (() => {
    const done = calls.filter(
      (c) => c.status === 'done' && c.analysis && typeof c.analysis.scorecard?.overall === 'number',
    )
    if (!done.length) return null
    return Math.round(
      done.reduce((acc, c) => acc + (c.analysis.scorecard?.overall ?? 0), 0) / done.length,
    )
  })()
  const avgTalkRatio = (() => {
    const done = calls.filter(
      (c) => c.status === 'done' && c.analysis && typeof c.analysis?.rep_share_of_talk === 'number',
    )
    if (!done.length) return null
    return done.reduce((acc, c) => acc + (c.analysis?.rep_share_of_talk ?? 0), 0) / done.length
  })()

  const filteredCalls = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return calls
    return calls.filter(
      (c) => c.name?.toLowerCase().includes(q) || c.client_name?.toLowerCase().includes(q),
    )
  }, [calls, search])

  const statCount = 1 + (avgScore !== null ? 1 : 0) + (avgTalkRatio !== null ? 1 : 0)

  return (
    <div>
       {/* Welcome header */}
       <motion.div
         initial={reduceMotion ? false : { opacity: 0, y: 10 }}
         animate={{ opacity: 1, y: 0 }}
         transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
         className="mb-6"
       >
         <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-6 text-white shadow-lg shadow-indigo-500/25">
           <div className="flex size-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
             <Mic className="size-6" />
           </div>
           <div>
             <h1 className="text-2xl font-bold tracking-tight">
               {t('dashboard.welcome', { name: user?.name?.split(' ')[0] ?? '' })}
             </h1>
             <p className="text-sm text-white/70">{t('dashboard.welcome_desc')}</p>
           </div>
         </div>
       </motion.div>

        {/* Calls toolbar */}
        <header className="mb-6 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight">{t('dashboard.title')}</h2>
          <div className="ml-auto flex w-full flex-wrap items-center gap-3 sm:w-auto sm:flex-nowrap">
            <div className="relative min-w-0 flex-1 basis-48 sm:flex-none">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('dashboard.search_placeholder')}
                className="w-full pl-8 sm:w-56"
              />
            </div>
          {!loading && processing > 0 && (
            <Badge variant="secondary" className="gap-1.5">
              <span className="size-1.5 animate-pulse-soft rounded-full bg-primary" />
              {t('dashboard.in_progress', { n: processing })}
            </Badge>
          )}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gradient-bg hover:opacity-90 shadow-lg shadow-indigo-500/25">
                <Upload /> {t('dashboard.upload')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('dashboard.upload_dialog_title')}</DialogTitle>
                <DialogDescription>
                  {t('dashboard.upload_dialog_desc')}
                </DialogDescription>
              </DialogHeader>
              <Dropzone file={file} onFile={setFile} />
              <div className="space-y-2">
                <Label htmlFor="name">{t('upload.name_optional')}</Label>
                <Input
                   id="name"
                   value={name}
                   placeholder={file?.name ?? t('upload.name_placeholder')}
                   onChange={(e) => setName(e.target.value)}
                   autoFocus
                 />
              </div>
              <div className="space-y-2">
                <Label>{t('upload.call_type')}</Label>
                <TypeSegmented value={callType} onChange={setCallType} options={typeOptions} />
              </div>
              <div className="space-y-2">
                <Label>{t('upload.client_optional')}</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger className="w-full" disabled={clientsLoading}>
                    <SelectValue placeholder={clientsLoading ? 'Loading clients…' : t('upload.no_client')} />
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
              <DialogFooter>
                <Button onClick={handleUpload} disabled={uploading || !file}>
                  {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                  {uploading ? t('dashboard.uploading') : t('dashboard.upload')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {loading ? (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
          <div className="mb-6 grid gap-4 md:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-52 rounded-xl" />
            ))}
          </div>
        </>
      ) : calls.length === 0 ? (
        <Card className="border-dashed border-2 border-indigo-200 dark:border-indigo-900/50">
          <CardContent className="flex flex-col items-center gap-4 px-6 py-20 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl gradient-bg shadow-lg shadow-indigo-500/25">
              <AudioWaveform className="size-8 text-white" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold">{t('dashboard.no_calls')}</p>
              <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                {t('dashboard.no_calls_desc')}
              </p>
            </div>
            <Button onClick={() => setDialogOpen(true)} className="gradient-bg hover:opacity-90 shadow-lg shadow-indigo-500/25">
                <Upload /> {t('dashboard.upload_first')}
            </Button>
          </CardContent>
        </Card>
      ) : filteredCalls.length === 0 ? (
        <Card className="border-dashed border-2 border-muted-foreground/20">
          <CardContent className="flex flex-col items-center gap-4 px-6 py-20 text-center">
            <Search className="size-8 text-indigo-400" />
            <div className="space-y-1">
              <p className="text-base font-semibold">{t('dashboard.no_search_results')}</p>
              <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                {t('dashboard.no_search_results_desc')}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Stats row */}
           {reduceMotion ? (
              <div className={`mb-6 grid gap-3 ${statCount > 1 ? 'grid-cols-2' : 'grid-cols-1'} ${statCount > 2 ? 'lg:grid-cols-3' : ''}`}>
                <StatCard
                  icon={PhoneCall}
                  label={t('dashboard.stat.total')}
                  value={calls.length}
                  variant="solid"
                />
                {avgScore !== null && (
                  <StatCard
                    icon={Gauge}
                    label={t('dashboard.stat.avg')}
                    value={avgScore}
                    valueClass={scoreColor(avgScore)}
                    variant="accent"
                    progress={avgScore}
                    progressClass={avgScore >= 70 ? 'bg-emerald-500' : avgScore >= 40 ? 'bg-amber-500' : 'bg-red-500'}
                  />
                )}
                {avgTalkRatio !== null && (
                  <StatCard
                    icon={BarChart3}
                    label={t('dashboard.stat.talk_ratio')}
                    value={avgTalkRatio}
                    valueClass="text-foreground"
                    variant="gradient"
                    decimals={2}
                    progress={avgTalkRatio * 100}
                  />
                )}
              </div>
            ) : (
              <Stagger className={`mb-6 grid gap-3 ${statCount > 1 ? 'grid-cols-2' : 'grid-cols-1'} ${statCount > 2 ? 'lg:grid-cols-3' : ''}`}>
                <motion.div key="total" variants={fadeUp}>
                  <StatCard
                    icon={PhoneCall}
                    label={t('dashboard.stat.total')}
                    value={calls.length}
                    variant="solid"
                  />
                </motion.div>
                 {avgScore !== null && (
                   <motion.div key="avg" variants={fadeUp}>
                     <StatCard
                       icon={Gauge}
                       label={t('dashboard.stat.avg')}
                       value={avgScore}
                       valueClass={scoreColor(avgScore)}
                       variant="accent"
                       progress={avgScore}
                       progressClass={avgScore >= 70 ? 'bg-emerald-500' : avgScore >= 40 ? 'bg-amber-500' : 'bg-red-500'}
                     />
                   </motion.div>
                 )}
                 {avgTalkRatio !== null && (
                   <motion.div key="talk" variants={fadeUp}>
                     <StatCard
                       icon={BarChart3}
                       label={t('dashboard.stat.talk_ratio')}
                       value={avgTalkRatio}
                       valueClass="text-foreground"
                       variant="gradient"
                       decimals={2}
                       progress={avgTalkRatio * 100}
                     />
                   </motion.div>
                 )}
              </Stagger>
            )}

           {/* Charts row */}
           {reduceMotion ? (
             <div className="mb-6 grid gap-4 md:grid-cols-2">
               <ScoreDistributionChart calls={calls} />
               <CallTypePieChart calls={calls} />
             </div>
           ) : (
             <Stagger className="mb-6 grid gap-4 md:grid-cols-2">
               <motion.div key="score-dist" variants={fadeUp}>
                 <ScoreDistributionChart calls={calls} />
               </motion.div>
               <motion.div key="call-type" variants={fadeUp}>
                 <CallTypePieChart calls={calls} />
               </motion.div>
             </Stagger>
           )}

          {/* Call cards */}
          {reduceMotion ? (
            <div className="grid gap-4 md:grid-cols-2">
              {filteredCalls.map((c) => (
                <CallCard key={c.id} call={c} />
              ))}
            </div>
          ) : (
            <Stagger className="grid gap-4 md:grid-cols-2">
              {filteredCalls.map((c) => (
                <motion.div key={c.id} variants={fadeUp}>
                  <CallCard call={c} />
                </motion.div>
              ))}
            </Stagger>
          )}
        </>
      )}

      {role !== 'admin' && (
          <Card className="mt-6 border-indigo-200 bg-gradient-to-r from-indigo-50 to-purple-50 dark:border-indigo-900/50 dark:from-indigo-950/30 dark:to-purple-950/30">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg gradient-bg shadow-sm">
                  <KeyRound className="size-4 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">{t('token.own_title')}</p>
                  <p className="text-sm text-muted-foreground">{t('token.own_desc')}</p>
                </div>
              </div>
              <div className="w-full max-w-sm">
                <TokenControl
                  token={ownToken}
                  onRegenerate={async () => {
                    const { api_token } = await api.regenerateToken()
                    setOwnToken(api_token)
                    return api_token
                  }}
                />
              </div>
            </CardContent>
          </Card>
        )}
    </div>
  )
}

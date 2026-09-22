import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { motion, useReducedMotion } from 'framer-motion'
import {
  ArrowRight,
  AudioWaveform,
  CircleAlert,
  Clock,
  FileAudio2,
  KeyRound,
  LayoutGrid,
  List,
  Loader2,
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
  const color = score >= 70 ? 'var(--color-score-good)' : score >= 40 ? 'var(--color-score-warn)' : 'var(--color-score-bad)'
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-muted)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
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
    <Link to={`/calls/${call.id}`} className="group block h-full rounded-2xl focus:outline-none cursor-pointer">
      <Card className="h-full overflow-hidden border border-border/70 bg-card rounded-2xl shadow-xs transition-all duration-200 group-hover:border-border group-hover:shadow-md">
        <div className={`h-1 w-full ${
          call.status === 'done' ? (overall != null && overall >= 70 ? 'bg-emerald-500' : overall != null && overall >= 40 ? 'bg-amber-500' : 'bg-red-500') :
          call.status === 'error' ? 'bg-destructive' :
          call.status === 'analyzing' ? 'bg-amber-500 animate-pulse' :
          'bg-primary'
        }`} />
        <CardHeader className="pb-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <CardTitle className="line-clamp-1 text-base font-semibold group-hover:text-primary transition-colors">{displayName}</CardTitle>
              <CardDescription className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Clock className="size-3" />
                  {formatDuration(call.duration_sec)}
                </span>
                <span className="text-muted-foreground">{formatDate(call.created_at)}</span>
                {call.language && (
                  <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 uppercase tracking-wider text-[10px] font-semibold bg-muted text-muted-foreground">
                    {call.language}
                  </span>
                )}
                {outcome && (
                  <span className="rounded-full bg-muted/80 px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
                    {outcome}
                  </span>
                )}
              </CardDescription>
            </div>
            <Badge variant={statusVariant(call.status)} className={`text-[11px] shrink-0 font-medium ${call.status === 'done' ? 'color-badge-good' : call.status === 'error' ? 'color-badge-bad' : ''}`}>
              {t('status.' + call.status)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          {processing && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                <span className="text-xs text-muted-foreground">
                  {t('status.' + call.status)} in background…
                </span>
              </div>
              <Progress
                value={call.status === 'analyzing' ? 70 : 40}
                className="h-1.5"
              />
              {analysisError && (
                <p className="line-clamp-2 font-mono text-[11px] leading-relaxed text-destructive/80">
                  {analysisError}
                </p>
              )}
            </div>
          )}
          {call.status === 'error' && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive">
              <CircleAlert className="size-3.5" /> {t('status.error')}
            </div>
          )}
          {call.status === 'done' && overall != null && (
            <div className="flex items-center gap-3.5">
              <ScoreRing score={overall} />
              <div className="min-w-0 space-y-1 flex-1">
                <p className={`text-xs font-bold uppercase tracking-wide ${scoreColor(overall)}`}>
                  {scoreLabel(overall)} · {overall}/100
                </p>
                {summary && (
                  <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
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
            <div className="flex items-start gap-2 rounded-xl border border-amber-200/60 bg-amber-50/40 px-3 py-2 dark:border-amber-800/30 dark:bg-amber-950/20">
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
                  className="rounded-full border border-border/80 bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground"
                >
                  {m.name}: {m.value}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center justify-end gap-1 text-xs text-primary font-medium pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            View details <ArrowRight className="size-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

function CallTableView({ calls }: { calls: Call[] }) {
  const { t } = useI18n()
  return (
    <div className="rounded-2xl border border-border/70 bg-card overflow-hidden shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/40 border-b border-border/60 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3">{t('calls.table.name')}</th>
              <th className="px-4 py-3">{t('calls.table.status')}</th>
              <th className="px-4 py-3">{t('calls.table.score')}</th>
              <th className="px-4 py-3">{t('calls.table.duration')}</th>
              <th className="px-4 py-3">{t('calls.table.type')}</th>
              <th className="px-4 py-3">{t('calls.table.date')}</th>
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {calls.map((call) => {
              const analysis = (call.analysis ?? {}) as Partial<Call['analysis']>
              const overall = analysis.scorecard?.overall
              const displayName = (call.status === 'done' && typeof analysis.topic === 'string' && analysis.topic) || call.name

              return (
                <tr key={call.id} className="hover:bg-muted/40 transition-colors group">
                  <td className="px-4 py-3 max-w-[260px]">
                    <Link to={`/calls/${call.id}`} className="font-semibold text-foreground hover:text-primary transition-colors block truncate">
                      {displayName}
                    </Link>
                    {call.client_name && (
                      <span className="text-[11px] text-muted-foreground truncate block mt-0.5">
                        {call.client_name}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Badge variant={statusVariant(call.status)} className={call.status === 'done' ? 'color-badge-good' : call.status === 'error' ? 'color-badge-bad' : ''}>
                      {t('status.' + call.status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {overall != null ? (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-bold text-xs ${
                        overall >= 70 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                        overall >= 40 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                        'bg-red-500/10 text-red-600 dark:text-red-400'
                      }`}>
                        {overall}/100
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground font-mono">
                    {formatDuration(call.duration_sec)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground capitalize">
                    {call.call_type}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {formatDate(call.created_at)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right">
                    <Link
                      to={`/calls/${call.id}`}
                      className="inline-flex items-center gap-1 text-primary hover:underline font-medium text-xs opacity-80 group-hover:opacity-100"
                    >
                      View <ArrowRight className="size-3" />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
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
      className={`flex w-full cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed px-6 py-10 text-center outline-none transition-all duration-300 focus-visible:border-indigo-500 focus-visible:ring-3 focus-visible:ring-indigo-500/40 ${
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
            <span className="max-w-full truncate text-sm font-medium" title={file.name}>{file.name}</span>
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

export function Calls() {
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
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid')
  const [statusFilter, setStatusFilter] = useState<'all' | 'done' | 'processing' | 'error'>('all')
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

  const filteredCalls = useMemo(() => {
    let result = calls
    if (statusFilter === 'done') {
      result = result.filter((c) => c.status === 'done')
    } else if (statusFilter === 'processing') {
      result = result.filter((c) => !['done', 'error'].includes(c.status))
    } else if (statusFilter === 'error') {
      result = result.filter((c) => c.status === 'error')
    }

    const q = search.trim().toLowerCase()
    if (!q) return result
    return result.filter(
      (c) => c.name?.toLowerCase().includes(q) || c.client_name?.toLowerCase().includes(q),
    )
  }, [calls, search, statusFilter])

  return (
    <div>
      {/* Calls toolbar */}
      <div className="mb-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('dashboard.title')}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {filteredCalls.length} {t('analytics.calls').toLowerCase()}
            </p>
          </div>

          <div className="flex items-center gap-2.5 ml-auto">
            {/* View toggle */}
            <div className="flex items-center rounded-xl border border-border/70 bg-card p-0.5 shadow-2xs">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                title={t('calls.view_grid')}
                className={`p-1.5 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <LayoutGrid className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                title={t('calls.view_table')}
                className={`p-1.5 rounded-lg transition-colors ${viewMode === 'table' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <List className="size-4" />
              </button>
            </div>

            {/* Upload dialog trigger */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs gap-2">
                  <Upload className="size-4" /> {t('dashboard.upload')}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t('dashboard.upload_dialog_title')}</DialogTitle>
                  <DialogDescription>
                    {t('dashboard.upload_dialog_desc')}
                  </DialogDescription>
                </DialogHeader>
                <Dropzone file={file} onFile={setFile} />
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="name" className="text-xs">{t('upload.name_optional')}</Label>
                    <Input
                       id="name"
                       value={name}
                       placeholder={file?.name ?? t('upload.name_placeholder')}
                       onChange={(e) => setName(e.target.value)}
                       autoFocus
                     />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t('upload.call_type')}</Label>
                    <TypeSegmented value={callType} onChange={setCallType} options={typeOptions} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t('upload.client_optional')}</Label>
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
                </div>
                <DialogFooter className="mt-2">
                  <Button onClick={handleUpload} disabled={uploading || !file} className="w-full gap-2">
                    {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                    {uploading ? t('dashboard.uploading') : t('dashboard.upload')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('dashboard.search_placeholder')}
              className="w-full pl-9 h-9 text-xs rounded-xl bg-card border-border/70"
            />
          </div>

          {/* Status filter tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
            {(['all', 'done', 'processing', 'error'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  statusFilter === s
                    ? 'bg-primary text-primary-foreground shadow-2xs font-semibold'
                    : 'bg-card border border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                {s === 'all' ? t('calls.all_statuses') :
                 s === 'done' ? t('status.done') :
                 s === 'processing' ? t('dashboard.stat.in_progress') :
                 t('status.error')}
              </button>
            ))}
          </div>

          {!loading && processing > 0 && (
            <Badge variant="secondary" className="gap-1.5 text-xs py-1">
              <span className="size-1.5 animate-pulse rounded-full bg-primary" />
              {t('dashboard.in_progress', { n: processing })}
            </Badge>
          )}
        </div>
      </div>

      {/* Live Stats */}
      {!loading && calls.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: t('analytics.total_calls'), value: calls.length, color: 'text-foreground', bg: 'bg-primary/10', icon: '📞' },
            { label: t('status.done'), value: calls.filter(c => c.status === 'done').length, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', icon: '✅' },
            { label: t('dashboard.stat.in_progress'), value: calls.filter(c => !['done','error'].includes(c.status)).length, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10', icon: '⏳' },
            { label: t('status.error'), value: calls.filter(c => c.status === 'error').length, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10', icon: '❌' },
          ].map((stat) => (
            <div key={stat.label} className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3.5 shadow-2xs">
              <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${stat.bg} text-lg`}>
                {stat.icon}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-muted-foreground truncate">{stat.label}</p>
                <p className={`text-xl font-bold tabular-nums leading-tight ${stat.color}`}>{stat.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : calls.length === 0 ? (
        <Card className="border-dashed border-2 border-border/70 rounded-2xl bg-card">
          <CardContent className="flex flex-col items-center gap-4 px-6 py-20 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-xs">
              <AudioWaveform className="size-7" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold text-foreground">{t('dashboard.no_calls')}</p>
              <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                {t('dashboard.no_calls_desc')}
              </p>
            </div>
            <Button onClick={() => setDialogOpen(true)} className="gap-2 shadow-xs">
              <Upload className="size-4" /> {t('dashboard.upload_first')}
            </Button>
          </CardContent>
        </Card>
      ) : filteredCalls.length === 0 ? (
        <Card className="border-dashed border-2 border-border/70 rounded-2xl bg-card">
          <CardContent className="flex flex-col items-center gap-4 px-6 py-16 text-center">
            <Search className="size-8 text-muted-foreground/50" />
            <div className="space-y-1">
              <p className="text-base font-semibold text-foreground">{t('dashboard.no_search_results')}</p>
              <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                {t('dashboard.no_search_results_desc')}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : viewMode === 'table' ? (
        <CallTableView calls={filteredCalls} />
      ) : reduceMotion ? (
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  ArrowRight,
  AudioWaveform,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  FileAudio2,
  Hourglass,
  KeyRound,
  LayoutGrid,
  List,
  Loader2,
  PhoneCall,
  Search,
  Upload,
  UploadCloud,
  X,
  type LucideIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { EmptyState, PageHeader } from '@/components/EmptyState'
import { ScoreRing } from '@/components/ScoreRing'
import { TokenControl } from '@/components/TokenControl'
import { Stagger, fadeUp, SPRING } from '@/lib/motion'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useI18n } from '@/i18n/i18n'
import {
  formatBytes,
  formatDate,
  formatDuration,
  isInFlight,
  matches,
  scoreColor,
  scoreLabel,
} from '@/lib/format'
import { analysisError, asAnalysis, callTitle, overallScore, type Call, type CallType, type Client } from '@/lib/types'
import { cn } from '@/lib/utils'

const NO_CLIENT = 'none'

const TYPE_OPTIONS: { value: CallType; labelKey: string }[] = [
  { value: 'manager', labelKey: 'upload.call_type.manager' },
  { value: 'receptionist', labelKey: 'upload.call_type.receptionist' },
]

type StatusFilter = 'all' | 'done' | 'processing' | 'error'
type ViewMode = 'grid' | 'table'

const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200 MB

/* ---------------------------------------------------------------------------
 * Polling.
 *
 * The old code started a 3s interval and then had a branch that was supposed
 * to slow it to 10s once nothing was processing — that branch could never run
 * (`hasProcessing` true + `pollTimer` set is the only reachable state), so the
 * list re-fetched every 3 seconds forever. This is a single self-adjusting
 * timer: 3s while work is in flight, 30s heartbeat once everything is settled,
 * stopped while the tab is hidden.
 * ------------------------------------------------------------------------- */
const POLL_ACTIVE_MS = 3000
const POLL_IDLE_MS = 30000

function usePolledCalls(intervalWhenBusy: number, intervalWhenIdle: number) {
  const [calls, setCalls] = useState<Call[]>([])
  const [loading, setLoading] = useState(true)
  const timer = useRef<number | null>(null)
  const fetching = useRef(false)
  const delay = useRef(intervalWhenBusy)

  const refresh = useCallback(async () => {
    if (fetching.current) return
    fetching.current = true
    try {
      setCalls(await api.listCalls())
    } catch {
      /* keep showing the last good list rather than emptying the page */
    } finally {
      fetching.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const tick = () => {
      // Skip the request while hidden, but always re-arm. Returning early used
      // to kill the chain for good: a throttled background-tab timeout fires,
      // hits the guard, and never schedules the next one — so the list froze
      // permanently once you switched tabs, and `loading` could stick at true.
      if (!document.hidden) void refresh()
      timer.current = window.setTimeout(tick, delay.current)
    }
    timer.current = window.setTimeout(tick, 0)
    const onVisible = () => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh, intervalWhenBusy, intervalWhenIdle])

  return { calls, loading, refresh, setDelay: (d: number) => void (delay.current = d) }
}

function ScoreStatusBar({ call, overall }: { call: Call; overall: number | null }) {
  if (call.status === 'done') {
    return (
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
    )
  }
  if (call.status === 'error') return <div aria-hidden="true" className="h-0.5 w-full bg-destructive" />
  if (call.status === 'analyzing') return <div aria-hidden="true" className="h-0.5 w-full animate-pulse-soft bg-primary" />
  return <div aria-hidden="true" className="h-0.5 w-full bg-border-strong" />
}

function CallCard({ call }: { call: Call }) {
  const { t, lang } = useI18n()
  const analysis = asAnalysis(call.analysis)
  const done = call.status === 'done'
  const overall = done ? overallScore(call.analysis) : null
  const summary = done && typeof analysis.summary === 'string' ? analysis.summary : ''
  const problem = done && typeof (analysis as { problem?: string }).problem === 'string'
    ? String((analysis as { problem?: string }).problem)
    : ''
  const outcome = done && typeof analysis.outcome === 'string' ? analysis.outcome : ''
  const keyMetrics = done && Array.isArray(analysis.key_metrics) ? analysis.key_metrics.slice(0, 3) : []
  const error = analysisError(call.analysis)
  const processing = isInFlight(call.status)

  return (
    <motion.div variants={fadeUp} className="h-full">
      <Link
        to={`/calls/${call.id}`}
        className="group/card block h-full rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Card interactive className="h-full">
          <ScoreStatusBar call={call} overall={overall} />

          <CardHeader className="gap-0 px-3.5 pt-3 pb-2">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="line-clamp-1 transition-colors group-hover/card:text-primary">
                {callTitle(call)}
              </CardTitle>
              <Badge
                variant={
                  call.status === 'done'
                    ? 'success'
                    : call.status === 'error'
                      ? 'destructive'
                      : 'secondary'
                }
                className="shrink-0"
              >
                {t(`status.${call.status}`)}
              </Badge>
            </div>
            <CardDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Clock aria-hidden="true" className="size-3" />
                {formatDuration(call.duration_sec)}
              </span>
              <span>{formatDate(call.created_at)}</span>
              {call.language && (
                <span className="rounded-sm bg-surface-sunken px-1 text-2xs font-semibold uppercase tracking-wider">
                  {call.language}
                </span>
              )}
              {outcome && (
                <span className="rounded-sm bg-surface-sunken px-1 text-2xs font-medium capitalize">
                  {outcome}
                </span>
              )}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-2.5 px-3.5 pb-3">
            {processing && (
              <div className="space-y-1.5">
                <Progress
                  value={call.status === 'analyzing' ? 70 : 40}
                  indicatorClassName={error ? 'bg-destructive' : undefined}
                />
                {error && (
                  <p className="line-clamp-2 font-mono text-2xs leading-relaxed text-destructive">
                    {error}
                  </p>
                )}
              </div>
            )}

            {call.status === 'error' && (
              <div className="flex items-center gap-2 rounded-md bg-destructive-soft px-2.5 py-1.5 text-xs text-destructive-soft-foreground">
                <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">{error || t('status.error')}</span>
              </div>
            )}

            {done && overall != null && (
              <div className="flex items-center gap-3">
                <ScoreRing score={overall} size={52} />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className={cn('text-xs font-semibold', scoreColor(overall))}>
                    {scoreLabel(overall, lang)}
                  </p>
                  {summary && (
                    <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {summary}
                    </p>
                  )}
                </div>
              </div>
            )}

            {done && overall == null && (
              <p className="text-xs text-muted-foreground">{t('dashboard.proc_short')}</p>
            )}

            {problem && (
              <div className="flex items-start gap-2 rounded-md bg-warning-soft px-2.5 py-1.5 text-warning-soft-foreground">
                <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                <p className="line-clamp-2 text-xs leading-relaxed">
                  <span className="font-semibold">{t('call.problem')}: </span>
                  {problem}
                </p>
              </div>
            )}

            {keyMetrics.length > 0 && (
              <ul className="flex flex-wrap gap-1">
                {keyMetrics.map((m, i) => (
                  <li
                    key={i}
                    className="rounded-sm bg-surface-sunken px-1.5 py-0.5 text-2xs ring-1 ring-border-subtle ring-inset"
                  >
                    <span className="text-muted-foreground">{m.name}:</span> {m.value}
                  </li>
                ))}
              </ul>
            )}

            <p className="flex items-center justify-end gap-1 text-2xs font-medium text-primary opacity-0 transition-opacity duration-150 group-hover/card:opacity-100 group-focus-visible/card:opacity-100">
              {t('common.view_details')}
              <ArrowRight aria-hidden="true" className="size-3" />
            </p>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  )
}

function CallTable({ calls }: { calls: Call[] }) {
  const { t } = useI18n()
  return (
    <div className="overflow-hidden rounded-lg bg-surface ring-1 ring-border">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{t('dashboard.title')}</caption>
          <thead className="border-b border-border-subtle bg-surface-sunken">
            <tr>
              {[t('calls.table.name'), t('calls.table.status'), t('calls.table.score'), t('calls.table.duration'), t('calls.table.type'), t('calls.table.date')].map((h, i) => (
                <th key={h} scope="col" className={cn('px-3 py-2 text-2xs font-semibold uppercase tracking-[0.06em] text-muted-foreground', i > 1 && 'w-px whitespace-nowrap')}>
                  {h}
                </th>
              ))}
              <th scope="col" className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {calls.map((call) => {
              const overall = call.status === 'done' ? overallScore(call.analysis) : null
              return (
                <tr key={call.id} className="group/row transition-colors hover:bg-surface-hover">
                  <td className="max-w-[280px] px-3 py-2">
                    <Link
                      to={`/calls/${call.id}`}
                      className="block truncate font-medium transition-colors hover:text-primary hover:underline"
                    >
                      {callTitle(call)}
                    </Link>
                    {call.client_name && (
                      <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
                        {call.client_name}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
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
                  </td>
                  <td className={cn('px-3 py-2 tabular-nums', overall == null && 'text-muted-foreground')}>
                    {overall != null ? (
                      <span className={cn('font-semibold', scoreColor(overall))}>{overall}/100</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums text-muted-foreground">
                    {formatDuration(call.duration_sec)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground capitalize">
                    {call.call_type}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {formatDate(call.created_at)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      to={`/calls/${call.id}`}
                      aria-label={`${t('common.view_details')}: ${callTitle(call)}`}
                      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    >
                      <ArrowRight aria-hidden="true" className="size-3" />
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

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  labelId,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; icon?: LucideIcon }[]
  label: string
  /** Id of the visible <Label>, so the tablist is tied to on-screen text. */
  labelId?: string
}) {
  return (
    <div
      role="tablist"
      {...(labelId ? { 'aria-labelledby': labelId } : { 'aria-label': label })}
      className="inline-flex rounded-md bg-surface-sunken p-0.5 ring-1 ring-border-subtle ring-inset"
    >
      {options.map((opt) => {
        const active = value === opt.value
        const Icon = opt.icon
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium outline-none',
              'transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${label}`}
                transition={SPRING.snappy}
                className="absolute inset-0 rounded-sm bg-surface shadow-e1 ring-1 ring-border"
                aria-hidden="true"
              />
            )}
            {Icon && <Icon aria-hidden="true" className="relative size-3.5" />}
            <span className="relative">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function Dropzone({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { t } = useI18n()

  const accept = (f: File | null) => {
    if (!f) return onFile(null)
    // Clear the input on every rejection. A browser only fires `change` when
    // the value actually changes, so keeping the rejected file pinned in the
    // input meant re-picking that same file did nothing — the user was stuck.
    const reject = (message: string) => {
      if (inputRef.current) inputRef.current.value = ''
      toast.error(message)
    }
    if (!(f.type.startsWith('audio/') || f.type.startsWith('video/'))) {
      reject(t('dashboard.invalid_file_type'))
      return
    }
    if (f.size > MAX_FILE_SIZE) {
      reject(t('dashboard.file_too_large', { size: formatBytes(f.size) }))
      return
    }
    onFile(f)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t('dashboard.dropzone_title')}
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
        accept(e.dataTransfer.files?.[0] ?? null)
      }}
      className={cn(
        'flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-6 py-8 text-center outline-none',
        'transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        dragOver
          ? 'border-primary bg-primary-soft/40'
          : 'border-border hover:border-border-strong hover:bg-surface-hover'
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/*"
        className="sr-only"
        onChange={(e) => accept(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <>
          <FileAudio2 aria-hidden="true" className="size-6 text-primary" />
          <span className="max-w-full truncate text-sm font-medium">{file.name}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{formatBytes(file.size)}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onFile(null)
              if (inputRef.current) inputRef.current.value = ''
            }}
            onKeyDown={(e) => {
              // The container is itself a role="button" that opens the file
              // picker on Enter/Space; without this, keyboard-activating
              // Cancel cleared the file and immediately reopened the dialog.
              if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
            }}
            className="mt-1"
          >
            <X aria-hidden="true" className="size-3.5" />
            {t('call.cancel')}
          </Button>
        </>
      ) : (
        <>
          <UploadCloud aria-hidden="true" className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">{t('dashboard.dropzone_title')}</p>
          <p className="text-xs text-muted-foreground">{t('dashboard.dropzone_desc')}</p>
        </>
      )}
    </div>
  )
}

function UploadDialog({
  open,
  onOpenChange,
  onUploaded,
  defaultType,
  showTypeChoice,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onUploaded: () => void
  defaultType: CallType
  showTypeChoice: boolean
}) {
  const { t } = useI18n()
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [callType, setCallType] = useState<CallType>(defaultType)
  const [clientId, setClientId] = useState<string>(NO_CLIENT)
  const [clients, setClients] = useState<Client[]>([])
  const [clientsLoading, setClientsLoading] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => setCallType(defaultType), [defaultType])

  useEffect(() => {
    if (!open) return
    setClientsLoading(true)
    api
      .listClients()
      .then(setClients)
      .catch(() => toast.error(t('dashboard.clients_load_failed')))
      .finally(() => setClientsLoading(false))
  }, [open, t])

  const reset = () => {
    setFile(null)
    setName('')
    setClientId(NO_CLIENT)
  }

  const submit = async () => {
    if (!file) {
      toast.error(t('dashboard.choose_first'))
      return
    }
    setUploading(true)
    try {
      await api.uploadCall(file, {
        name: name || file.name,
        call_type: callType,
        client_id: clientId === NO_CLIENT ? null : Number(clientId),
      })
      toast.success(t('dashboard.upload_success'))
      reset()
      onOpenChange(false)
      onUploaded()
    } catch (e) {
      toast.error(t('dashboard.upload_error', { error: (e as Error).message }))
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !uploading) {
          reset()
          onOpenChange(false)
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dashboard.upload_dialog_title')}</DialogTitle>
          <DialogDescription>{t('dashboard.upload_dialog_desc')}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Dropzone file={file} onFile={setFile} />

          <div className="space-y-1.5">
            <Label htmlFor="upload-name">{t('upload.name_optional')}</Label>
            <Input
              id="upload-name"
              value={name}
              placeholder={file?.name ?? t('upload.name_placeholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {showTypeChoice && (
            <div className="space-y-1.5">
              {/* Radix Select is not labelable by wrapping, so the label needs
                  an explicit association. */}
              <Label id="upload-call-type-label">{t('upload.call_type')}</Label>
              <SegmentedControl
                labelId="upload-call-type-label"
                label={t('upload.call_type')}
                value={callType}
                onChange={setCallType}
                options={TYPE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="upload-client">{t('upload.client_optional')}</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="upload-client" className="w-full" disabled={clientsLoading}>
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

          <DialogFooter className="mt-1">
            <Button type="submit" disabled={uploading || !file} className="w-full">
              {uploading ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Upload aria-hidden="true" className="size-4" />
              )}
              {uploading ? t('dashboard.uploading') : t('dashboard.upload')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LiveStat({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-surface px-3 py-2.5 ring-1 ring-border">
      <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset', tone)}>
        <Icon aria-hidden="true" className="size-3.5" />
      </span>
      <div className="min-w-0">
        <p className="eyebrow truncate">{label}</p>
        <p className="data-value text-lg leading-tight">{value}</p>
      </div>
    </div>
  )
}

export function Calls() {
  const { user } = useAuth()
  const { t } = useI18n()
  const role = user?.role
  const defaultCallType: CallType = role === 'receptionist' ? 'receptionist' : 'manager'

  const [ownToken, setOwnToken] = useState<string | null>(user?.api_token ?? null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const { calls, loading, refresh, setDelay } = usePolledCalls(POLL_ACTIVE_MS, POLL_IDLE_MS)

  useEffect(() => {
    if (user?.api_token) setOwnToken(user.api_token)
  }, [user?.api_token])

  const busyCount = useMemo(() => calls.filter((c) => isInFlight(c.status)).length, [calls])

  useEffect(() => {
    setDelay(busyCount > 0 ? POLL_ACTIVE_MS : POLL_IDLE_MS)
  }, [busyCount, setDelay])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return calls.filter((c) => {
      if (statusFilter === 'done' && c.status !== 'done') return false
      if (statusFilter === 'processing' && !isInFlight(c.status)) return false
      if (statusFilter === 'error' && c.status !== 'error') return false
      if (!q) return true
      return matches(c.name, q) || matches(c.client_name, q)
    })
  }, [calls, search, statusFilter])

  return (
    <div>
      <PageHeader
        title={t('dashboard.title')}
        description={`${filtered.length} ${t('analytics.calls').toLowerCase()}`}
        actions={
          <>
            <SegmentedControl
              label={t('calls.view_mode')}
              value={viewMode}
              onChange={setViewMode}
              options={[
                { value: 'grid', label: t('calls.view_grid'), icon: LayoutGrid },
                { value: 'table', label: t('calls.view_table'), icon: List },
              ]}
            />
            <Button onClick={() => setDialogOpen(true)}>
              <Upload aria-hidden="true" className="size-4" />
              {t('dashboard.upload')}
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('dashboard.search_placeholder')}
            aria-label={t('dashboard.search_placeholder')}
            className="pl-8"
          />
        </div>

        <SegmentedControl
          label={t('calls.all_statuses')}
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'all', label: t('calls.all_statuses') },
            { value: 'done', label: t('status.done') },
            { value: 'processing', label: t('dashboard.stat.in_progress') },
            { value: 'error', label: t('status.error') },
          ]}
        />

        {busyCount > 0 && (
          <Badge variant="default" className="gap-1.5">
            <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-current" />
            {t('dashboard.in_progress', { n: busyCount })}
          </Badge>
        )}
      </div>

      {!loading && calls.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <LiveStat icon={PhoneCall} label={t('analytics.total_calls')} value={calls.length} tone="bg-primary-soft text-primary-soft-foreground ring-primary/20" />
          <LiveStat icon={CircleCheck} label={t('status.done')} value={calls.filter((c) => c.status === 'done').length} tone="bg-success-soft text-success-soft-foreground ring-success/20" />
          <LiveStat icon={Hourglass} label={t('dashboard.stat.in_progress')} value={busyCount} tone="bg-primary-soft text-primary-soft-foreground ring-primary/20" />
          <LiveStat icon={CircleX} label={t('status.error')} value={calls.filter((c) => c.status === 'error').length} tone="bg-destructive-soft text-destructive-soft-foreground ring-destructive/20" />
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label={t('analytics.loading')}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-lg" />
          ))}
        </div>
      ) : calls.length === 0 ? (
        <EmptyState
          icon={AudioWaveform}
          title={t('dashboard.no_calls')}
          description={t('dashboard.no_calls_desc')}
          action={
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Upload aria-hidden="true" className="size-3.5" />
              {t('dashboard.upload_first')}
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t('dashboard.no_search_results')}
          description={t('dashboard.no_search_results_desc')}
          action={
            <Button size="sm" variant="outline" onClick={() => { setSearch(''); setStatusFilter('all') }}>
              {t('common.clear_filters')}
            </Button>
          }
        />
      ) : viewMode === 'table' ? (
        <CallTable calls={filtered} />
      ) : (
        <Stagger className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            <CallCard key={c.id} call={c} />
          ))}
        </Stagger>
      )}

      {role !== 'admin' && (
        <Card size="sm" className="mt-6">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-foreground ring-1 ring-primary/20 ring-inset">
                <KeyRound aria-hidden="true" className="size-3.5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold">{t('token.own_title')}</p>
                <p className="text-2xs text-muted-foreground">{t('token.own_desc')}</p>
              </div>
            </div>
            <div className="w-full max-w-xs">
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

      <UploadDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onUploaded={() => void refresh()}
        defaultType={defaultCallType}
        showTypeChoice={role === 'admin'}
      />
    </div>
  )
}

export default Calls

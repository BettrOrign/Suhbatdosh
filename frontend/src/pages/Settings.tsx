import { useEffect, useState } from 'react'
import {
  Bell,
  Building2,
  Cpu,
  Database,
  FileCode2,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Sliders,
  Trash2,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { PageHeader } from '@/components/EmptyState'
import { ModeSwitcher } from '@/components/ModeSwitcher'
import { PeopleDenied } from '@/components/people/PeopleDenied'
import { useAuth } from '@/lib/auth'
import { useMode } from '@/lib/mode'
import { useI18n } from '@/i18n/i18n'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { OrgProfile, OrgSearchResult, SettingsFlags } from '@/lib/types'

function Coming() {
  const { t } = useI18n()
  return (
    <Badge variant="outline" className="shrink-0 border-dashed text-2xs text-muted-foreground">
      {t('settings.coming')}
    </Badge>
  )
}

function Row({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-px flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-muted-foreground ring-1 ring-border-subtle">
          <Icon aria-hidden="true" className="size-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium">{title}</p>
          <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  )
}

const ORG_TEXT_FIELDS: { key: keyof OrgProfile; tkey: string; rows: number }[] = [
  { key: 'direction', tkey: 'settings.org.direction', rows: 2 },
  { key: 'services', tkey: 'settings.org.services', rows: 2 },
  { key: 'rules', tkey: 'settings.org.rules', rows: 4 },
  { key: 'flaws', tkey: 'settings.org.flaws', rows: 3 },
  { key: 'metrics', tkey: 'settings.org.metrics', rows: 2 },
  { key: 'custom_instructions', tkey: 'settings.org.custom_instructions', rows: 3 },
]

function OrgProfileCard() {
  const { t } = useI18n()
  const [profile, setProfile] = useState<OrgProfile>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptText, setPromptText] = useState<string | null>(null)

  // Find-automatically mode: search input, in-flight flag and the proposal
  // the backend returned. Nothing is saved until the admin confirms.
  const [mode, setMode] = useState<'manual' | 'search'>('manual')
  const [searchName, setSearchName] = useState('')
  const [searchDesc, setSearchDesc] = useState('')
  const [searching, setSearching] = useState(false)
  const [result, setResult] = useState<OrgSearchResult | null>(null)

  useEffect(() => {
    api
      .getOrgProfile()
      .then((r) => {
        setProfile(r.profile)
        setUpdatedAt(r.updated_at)
      })
      .catch(() => toast.error(t('settings.org.load_failed')))
      .finally(() => setLoading(false))
  }, [t])

  const save = async () => {
    setSaving(true)
    try {
      const r = await api.updateOrgProfile(profile)
      setProfile(r.profile)
      setUpdatedAt(r.updated_at)
      toast.success(t('settings.saved'))
    } catch (e) {
      toast.error(t('settings.org.save_failed', { error: (e as Error).message }))
    } finally {
      setSaving(false)
    }
  }

  const togglePrompt = async () => {
    const next = !promptOpen
    setPromptOpen(next)
    if (next && promptText === null) {
      try {
        const r = await api.getSystemPrompt()
        setPromptText(r.system_prompt)
      } catch {
        toast.error(t('settings.prompt.load_failed'))
        setPromptOpen(false)
      }
    }
  }

  const empty = Object.values(profile).every((v) => !String(v).trim())

  const runSearch = async () => {
    if (!searchName.trim()) {
      toast.error(t('settings.org.search_empty'))
      return
    }
    setSearching(true)
    setResult(null)
    try {
      const r = await api.searchOrgProfile({
        name: searchName.trim(),
        description: searchDesc.trim(),
      })
      setResult(r)
    } catch (e) {
      toast.error(t('settings.org.search_failed', { error: (e as Error).message }))
    } finally {
      setSearching(false)
    }
  }

  /** Put the found candidate into the form; optionally persist right away. */
  const applyCandidate = async (persist: boolean) => {
    if (!result?.found) return
    setProfile((p) => ({ ...p, ...result.profile }))
    if (!persist) {
      setMode('manual')
      toast(t('settings.org.applied_form'))
      return
    }
    setSaving(true)
    try {
      const resp = await api.updateOrgProfile(result.profile)
      setProfile(resp.profile)
      setUpdatedAt(resp.updated_at)
      toast.success(t('settings.saved'))
      setMode('manual')
    } catch (e) {
      toast.error(t('settings.org.save_failed', { error: (e as Error).message }))
    } finally {
      setSaving(false)
    }
  }

  const candidateEntries = result?.found
    ? [
        { label: t('settings.org.name'), value: result.profile.name },
        ...ORG_TEXT_FIELDS.map((f) => ({
          label: t(f.tkey),
          value: result.profile[f.key],
        })),
      ].filter((e) => String(e.value ?? '').trim())
    : []

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Building2 aria-hidden="true" className="size-3.5 text-primary" />
          {t('settings.section_org')}
        </CardTitle>
        <CardDescription>{t('settings.section_org_desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={mode === 'manual' ? 'default' : 'outline'}
            onClick={() => setMode('manual')}
          >
            {t('settings.org.tab_manual')}
          </Button>
          <Button
            size="sm"
            variant={mode === 'search' ? 'default' : 'outline'}
            onClick={() => setMode('search')}
          >
            <Search aria-hidden="true" className="size-3.5" />
            {t('settings.org.tab_search')}
          </Button>
        </div>

        {mode === 'search' && (
          <div className="space-y-2 rounded-md bg-surface-sunken p-3 ring-1 ring-border-subtle">
            <Input
              placeholder={t('settings.org.name')}
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              aria-label={t('settings.org.name')}
            />
            <Textarea
              placeholder={t('settings.org.search_desc')}
              value={searchDesc}
              onChange={(e) => setSearchDesc(e.target.value)}
              rows={2}
              aria-label={t('settings.org.search_desc')}
            />
            <Button
              size="sm"
              onClick={() => void runSearch()}
              disabled={searching || !searchName.trim()}
            >
              {searching ? (
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              ) : (
                <Search aria-hidden="true" className="size-3.5" />
              )}
              {t('settings.org.search_action')}
            </Button>

            {result?.found ? (
              <div className="space-y-2">
                <p className="text-2xs font-medium">{t('settings.org.found')}</p>
                <dl className="space-y-1.5">
                  {candidateEntries.map((e) => (
                    <div key={e.label} className="text-2xs">
                      <dt className="font-medium">{e.label}</dt>
                      <dd className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                        {e.value}
                      </dd>
                    </div>
                  ))}
                </dl>
                {result.sources.length > 0 && (
                  <p className="text-2xs leading-relaxed text-muted-foreground">
                    {t('settings.org.sources')}:{' '}
                    {result.sources.map((uri, i) => (
                      <span key={uri}>
                        {i > 0 && ', '}
                        <a
                          href={uri}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline underline-offset-2"
                          title={uri}
                        >
                          [{i + 1}]
                        </a>
                      </span>
                    ))}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void applyCandidate(true)} disabled={saving}>
                    {t('settings.org.apply_save')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void applyCandidate(false)}>
                    {t('settings.org.apply_form')}
                  </Button>
                </div>
              </div>
            ) : result ? (
              <p className="text-2xs leading-relaxed text-muted-foreground">
                {t('settings.org.not_found')}
              </p>
            ) : null}

            {result?.facts && (
              <details className="text-2xs">
                <summary className="cursor-pointer text-muted-foreground">
                  {t('settings.org.facts')}
                </summary>
                <pre className="mt-1 whitespace-pre-wrap font-sans leading-relaxed text-muted-foreground">
                  {result.facts}
                </pre>
              </details>
            )}
          </div>
        )}

        {mode === 'manual' && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="org-name">{t('settings.org.name')}</Label>
              <Input
                id="org-name"
                value={profile.name ?? ''}
                onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                disabled={loading}
              />
            </div>
            {ORG_TEXT_FIELDS.map(({ key, tkey, rows }) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`org-${key}`}>{t(tkey)}</Label>
                <Textarea
                  id={`org-${key}`}
                  value={profile[key] ?? ''}
                  onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))}
                  rows={rows}
                  disabled={loading}
                />
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => void save()} disabled={saving || loading}>
                {t('settings.save')}
              </Button>
              {updatedAt && (
                <span className="text-2xs text-muted-foreground">
                  {t('settings.last_updated', { date: formatDate(updatedAt) })}
                </span>
              )}
            </div>
          </>
        )}

        <p className="flex items-start gap-2 rounded-md bg-surface-sunken px-3 py-2 text-2xs leading-relaxed text-muted-foreground">
          <Bell aria-hidden="true" className="mt-px size-3 shrink-0" />
          {t('settings.org.telegram_hint')}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void togglePrompt()}>
            <FileCode2 aria-hidden="true" className="size-3.5" />
            {t(promptOpen ? 'settings.prompt.hide' : 'settings.prompt.view')}
          </Button>
        </div>

        {promptOpen && (
          <pre className="max-h-72 overflow-y-auto rounded-md bg-surface-sunken p-3 font-mono text-2xs leading-relaxed whitespace-pre-wrap text-muted-foreground ring-1 ring-border-subtle">
            {promptText ?? '…'}
          </pre>
        )}

        {empty && !loading && (
          <p className="text-2xs text-muted-foreground">{t('settings.org.empty_hint')}</p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Settings: every control here is wired to the backend — processing mode and
 * the transcription/data/notification toggles persist through
 * `GET|PATCH /api/settings`, the institution profile through
 * `GET|PATCH /api/settings/org`, and the prompt viewer shows the exact system
 * prompt the scoring agent runs with.
 */
export function SettingsPage() {
  const { user } = useAuth()
  const { t } = useI18n()
  const { settings, canEdit, refresh } = useMode()

  if (user?.role !== 'admin') {
    return (
      <PeopleDenied
        titleKey="settings.no_access"
        descriptionKey="settings.no_access_desc"
      />
    )
  }

  const flags = settings?.flags
  const retentionDays = settings?.retention_days ?? 0

  const updateFlag = async (key: keyof SettingsFlags, value: boolean) => {
    const patch: Partial<SettingsFlags> = {}
    patch[key] = value
    try {
      await api.updateSettings({ flags: patch })
      toast.success(t('settings.saved'))
      await refresh()
    } catch (e) {
      toast.error(t('settings.mode.switch_failed', { error: (e as Error).message }))
    }
  }

  const updateRetention = async (days: string) => {
    try {
      await api.updateSettings({ retention_days: Number(days) })
      toast.success(t('settings.saved'))
      await refresh()
    } catch (e) {
      toast.error(t('settings.mode.switch_failed', { error: (e as Error).message }))
    }
  }

  const reanalyzeAll = async () => {
    try {
      const r = await api.reanalyzeAll()
      toast.success(t('settings.reprocess_started', { count: r.queued }))
      await refresh()
    } catch (e) {
      toast.error(t('settings.action_failed', { error: (e as Error).message }))
    }
  }

  const purgeAudio = async () => {
    try {
      const r = await api.purgeAudio()
      toast.success(t('settings.purge_done', { count: r.purged }))
      await refresh()
    } catch (e) {
      toast.error(t('settings.action_failed', { error: (e as Error).message }))
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow={t('nav.settings')}
        title={t('settings.title')}
        description={t('settings.desc')}
        actions={
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw aria-hidden="true" className="size-3.5" />
            {t('settings.refresh')}
          </Button>
        }
      />

      <div className="grid gap-3 lg:grid-cols-2">
        {/* --- processing mode -------------------------- */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Sliders aria-hidden="true" className="size-3.5 text-primary" />
              {t('settings.section_mode')}
            </CardTitle>
            <CardDescription>{t('settings.section_mode_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ModeSwitcher />

            {!canEdit && (
              <p className="flex items-start gap-2 rounded-md bg-surface-sunken px-3 py-2 text-2xs leading-relaxed text-muted-foreground">
                <ShieldAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                {t('mode.read_only')}
              </p>
            )}

            <Separator />

            <Row
              icon={HardDrive}
              title={t('settings.row.stt_engine')}
              description={t('settings.row.stt_engine_desc')}
            >
              {settings?.stt ? (
                <span className="flex flex-col items-end gap-1">
                  <Badge variant={settings.stt.available ? 'success' : 'destructive'}>
                    {settings.stt.available ? t('mode.available') : t('mode.unavailable')}
                  </Badge>
                  <span className="font-mono text-2xs text-muted-foreground">{settings.stt.model}</span>
                </span>
              ) : (
                <Coming />
              )}
            </Row>

            <Separator />

            <Row
              icon={Cpu}
              title={t('settings.row.analysis_engine')}
              description={t('settings.row.analysis_engine_desc')}
            >
              {settings?.analysis ? (
                <span className="flex flex-col items-end gap-1">
                  <Badge variant="secondary">{settings.analysis.provider}</Badge>
                  <span className="font-mono text-2xs text-muted-foreground">{settings.analysis.model}</span>
                </span>
              ) : (
                <Coming />
              )}
            </Row>

            <Separator />

            <Row icon={Cpu} title={t('settings.row.use_gpu')} description={t('settings.row.use_gpu_desc')}>
              <Switch
                checked={flags?.gpu ?? false}
                disabled={!flags}
                onCheckedChange={(v) => void updateFlag('gpu', v)}
                aria-label={t('settings.row.use_gpu')}
              />
            </Row>

            {settings?.updated_at && (
              <p className="text-2xs text-muted-foreground">
                {t('settings.last_updated', { date: formatDate(settings.updated_at) })}
              </p>
            )}
          </CardContent>
        </Card>

        {/* --- institution profile + live system prompt --- */}
        <OrgProfileCard />

        {/* --- transcription -------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.section_transcription')}</CardTitle>
            <CardDescription>{t('settings.section_transcription_desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Row
              icon={Sliders}
              title={t('settings.row.punctuation')}
              description={t('settings.row.punctuation_desc')}
            >
              <Switch
                checked={flags?.punctuation ?? true}
                disabled={!flags}
                onCheckedChange={(v) => void updateFlag('punctuation', v)}
                aria-label={t('settings.row.punctuation')}
              />
            </Row>
            <Separator />
            <Row
              icon={Sliders}
              title={t('settings.row.speaker_labels')}
              description={t('settings.row.speaker_labels_desc')}
            >
              <Switch
                checked={flags?.speaker_labels ?? false}
                disabled={!flags}
                onCheckedChange={(v) => void updateFlag('speaker_labels', v)}
                aria-label={t('settings.row.speaker_labels')}
              />
            </Row>
          </CardContent>
        </Card>

        {/* --- data and retention -------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.section_data')}</CardTitle>
            <CardDescription>{t('settings.section_data_desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Row
              icon={Database}
              title={t('settings.row.auto_delete')}
              description={t('settings.row.auto_delete_desc')}
            >
              <Select
                value={String(retentionDays)}
                onValueChange={(v) => void updateRetention(v)}
                disabled={!settings}
              >
                <SelectTrigger className="w-28" aria-label={t('settings.row.auto_delete')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{t('settings.retention.off')}</SelectItem>
                  <SelectItem value="30">{t('settings.retention.30')}</SelectItem>
                  <SelectItem value="90">{t('settings.retention.90')}</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Separator />
            <Row
              icon={RefreshCw}
              title={t('settings.row.reprocess')}
              description={t('settings.row.reprocess_desc')}
            >
              <Button size="sm" variant="outline" onClick={() => void reanalyzeAll()}>
                {t('settings.row.reprocess_action')}
              </Button>
            </Row>
            <Separator />
            <Row icon={Trash2} title={t('settings.row.purge')} description={t('settings.row.purge_desc')}>
              <Button size="sm" variant="outline" onClick={() => void purgeAudio()}>
                {t('settings.row.purge_action')}
              </Button>
            </Row>
          </CardContent>
        </Card>

        {/* --- notifications -------------------------- */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Bell aria-hidden="true" className="size-3.5 text-primary" />
              {t('settings.section_notifications')}
            </CardTitle>
            <CardDescription>{t('settings.section_notifications_desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Row
              icon={Bell}
              title={t('settings.row.problem_alerts')}
              description={t('settings.row.problem_alerts_desc')}
            >
              <Switch
                checked={flags?.problem_alerts ?? true}
                disabled={!flags}
                onCheckedChange={(v) => void updateFlag('problem_alerts', v)}
                aria-label={t('settings.row.problem_alerts')}
              />
            </Row>
            <Separator />
            <Row icon={Wrench} title={t('settings.row.digest_time')} description={t('settings.row.digest_time_desc')}>
              <Coming />
            </Row>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default SettingsPage

import { useEffect, useState } from 'react'
import {
  Bell,
  Building2,
  Cpu,
  Database,
  FileCode2,
  HardDrive,
  Loader2,
  Mail,
  PhoneCall,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Sliders,
  Trash2,
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
import type { NotificationSettings, OrgProfile, OrgSearchResult, SettingsFlags } from '@/lib/types'

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

function NotificationsAndEscalationCard() {
  const { t } = useI18n()
  const [settings, setSettings] = useState<NotificationSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [password, setPassword] = useState('')
  const [testEmailLoading, setTestEmailLoading] = useState(false)
  const [testTgLoading, setTestTgLoading] = useState(false)
  const [testRecipient, setTestRecipient] = useState('')

  useEffect(() => {
    void api
      .getNotificationSettings()
      .then((s) => {
        setSettings(s)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const save = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const payload = {
        ...settings,
        ...(password.trim() ? { smtp_password: password.trim() } : {}),
      }
      const updated = await api.updateNotificationSettings(payload)
      setSettings(updated)
      setPassword('')
      toast.success(t('settings.notifications.saved'))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const sendTestEmail = async () => {
    setTestEmailLoading(true)
    try {
      const res = await api.testEmailSettings(
        testRecipient || undefined,
        password.trim() ? { smtp_password: password.trim() } : undefined,
      )
      toast.success(res.message || t('settings.notifications.test_email_success'))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setTestEmailLoading(false)
    }
  }

  const sendTestTelegram = async () => {
    if (!settings) return
    setTestTgLoading(true)
    try {
      const res = await api.testTelegramSettings({
        telegram_bot_token: settings.telegram_bot_token,
        telegram_default_chat_id: settings.telegram_default_chat_id,
      })
      toast.success(res.message || t('settings.notifications.test_tg_success'))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setTestTgLoading(false)
    }
  }

  if (loading || !settings) {
    return (
      <Card className="lg:col-span-2">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Bell aria-hidden="true" className="size-3.5 text-primary" />
          {t('settings.notifications.title')}
        </CardTitle>
        <CardDescription>{t('settings.notifications.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Avto-Eskalatsiya Qoidalari */}
        <div className="rounded-lg border border-border bg-surface-sunken p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">{t('settings.notifications.auto_escalate')}</p>
              <p className="text-xs text-muted-foreground">{t('settings.notifications.auto_escalate_desc')}</p>
            </div>
            <Switch
              checked={settings.auto_escalate_enabled}
              onCheckedChange={(v) => setSettings({ ...settings, auto_escalate_enabled: v })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t border-border">
            <div className="space-y-1.5">
              <Label htmlFor="threshold">{t('settings.notifications.threshold')}</Label>
              <Input
                id="threshold"
                type="number"
                min="0"
                max="100"
                value={settings.escalation_score_threshold}
                onChange={(e) => setSettings({ ...settings, escalation_score_threshold: Number(e.target.value) })}
              />
              <p className="text-2xs text-muted-foreground">{t('settings.notifications.threshold_desc')}</p>
            </div>
          </div>
        </div>

        {/* Gmail / SMTP Sozlamalari */}
        <div className="rounded-lg border border-border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="size-4 text-primary" />
              <div>
                <p className="text-sm font-semibold">{t('settings.notifications.smtp_title')}</p>
                <p className="text-xs text-muted-foreground">{t('settings.notifications.smtp_desc')}</p>
              </div>
            </div>
            <Switch
              checked={settings.smtp_enabled}
              onCheckedChange={(v) => setSettings({ ...settings, smtp_enabled: v })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="smtp-host">{t('settings.notifications.smtp_host')}</Label>
              <Input
                id="smtp-host"
                value={settings.smtp_host}
                onChange={(e) => setSettings({ ...settings, smtp_host: e.target.value })}
                placeholder="smtp.gmail.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-port">{t('settings.notifications.smtp_port')}</Label>
              <Input
                id="smtp-port"
                type="number"
                value={settings.smtp_port}
                onChange={(e) => setSettings({ ...settings, smtp_port: Number(e.target.value) })}
                placeholder="587"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-user">{t('settings.notifications.smtp_user')}</Label>
              <Input
                id="smtp-user"
                type="email"
                value={settings.smtp_user}
                onChange={(e) => setSettings({ ...settings, smtp_user: e.target.value })}
                placeholder="markaz@gmail.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-password">{t('settings.notifications.smtp_pass')}</Label>
              <Input
                id="smtp-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={settings.has_smtp_password ? "•••••••• (O'zgartirish uchun yangi parol kiriting)" : "Gmail App Password"}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="smtp-from">{t('settings.notifications.smtp_from')}</Label>
              <Input
                id="smtp-from"
                value={settings.smtp_from_name}
                onChange={(e) => setSettings({ ...settings, smtp_from_name: e.target.value })}
                placeholder="Suhbatdosh AI Nazoratchi"
              />
            </div>
          </div>

          {/* Test Email */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
            <Input
              className="max-w-xs"
              placeholder={t('settings.notifications.test_recipient_placeholder')}
              value={testRecipient}
              onChange={(e) => setTestRecipient(e.target.value)}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void sendTestEmail()}
              disabled={testEmailLoading || !settings.smtp_user}
            >
              {testEmailLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              {t('settings.notifications.send_test_email')}
            </Button>
          </div>
        </div>

        {/* Telegram Sozlamalari */}
        <div className="rounded-lg border border-border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Send className="size-4 text-primary" />
              <div>
                <p className="text-sm font-semibold">{t('settings.notifications.tg_title')}</p>
                <p className="text-xs text-muted-foreground">{t('settings.notifications.tg_desc')}</p>
              </div>
            </div>
            <Switch
              checked={settings.telegram_alerts_enabled}
              onCheckedChange={(v) => setSettings({ ...settings, telegram_alerts_enabled: v })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tg-token">{t('settings.notifications.tg_token')}</Label>
              <Input
                id="tg-token"
                type="password"
                value={settings.telegram_bot_token}
                onChange={(e) => setSettings({ ...settings, telegram_bot_token: e.target.value })}
                placeholder="123456789:ABCdefGhI..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tg-chat">{t('settings.notifications.tg_chat_id')}</Label>
              <Input
                id="tg-chat"
                value={settings.telegram_default_chat_id}
                onChange={(e) => setSettings({ ...settings, telegram_default_chat_id: e.target.value })}
                placeholder="-100123456789 yoki user_id"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void sendTestTelegram()}
              disabled={testTgLoading || !settings.telegram_bot_token || !settings.telegram_default_chat_id}
            >
              {testTgLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              {t('settings.notifications.send_test_tg')}
            </Button>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {t('common.save_changes')}
          </Button>
        </div>
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

        {/* --- notifications & outbound escalation -------------------------- */}
        <NotificationsAndEscalationCard />

        {/* --- Zadarma PBX -------------------------- */}
        <ZadarmaCard />
      </div>
    </div>
  )
}

function ZadarmaCard() {
  const { t } = useI18n()
  const [configured, setConfigured] = useState(false)
  const [balance, setBalance] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const loadStatus = () => {
    api
      .getZadarmaConfig()
      .then((r) => {
        setConfigured(r.configured)
        if (r.balance !== undefined && r.balance !== null) {
          setBalance(`${r.balance} ${r.currency ?? ''}`.trim())
        } else {
          setBalance(null)
        }
      })
      .catch(() => setConfigured(false))
  }

  useEffect(() => {
    loadStatus()
  }, [])

  const save = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) return
    setSaving(true)
    try {
      await api.saveZadarmaConfig({ api_key: apiKey.trim(), api_secret: apiSecret.trim() })
      setApiKey('')
      setApiSecret('')
      loadStatus()
      toast.success(t('settings.saved'))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const sync = async () => {
    setSyncing(true)
    try {
      await api.syncZadarma()
      toast.success(t('settings.zadarma.sync_started'))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-1.5">
              <PhoneCall aria-hidden="true" className="size-3.5 text-primary" />
              {t('settings.zadarma.title')}
            </CardTitle>
            <CardDescription>{t('settings.zadarma.desc')}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {balance && (
              <Badge variant="outline" className="font-mono text-2xs">
                {balance}
              </Badge>
            )}
            <Badge variant={configured ? 'default' : 'secondary'}>
              {configured ? t('settings.zadarma.configured') : t('settings.zadarma.not_configured')}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="zd-key">{t('settings.zadarma.api_key')}</Label>
            <Input
              id="zd-key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="••••••••••••••••"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="zd-secret">{t('settings.zadarma.api_secret')}</Label>
            <Input
              id="zd-secret"
              type="password"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder="••••••••••••••••"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!configured || syncing}
            onClick={() => void sync()}
          >
            {syncing && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            {t('settings.zadarma.sync')}
          </Button>
          <Button
            size="sm"
            disabled={saving || !apiKey.trim() || !apiSecret.trim()}
            onClick={() => void save()}
          >
            {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            {t('settings.zadarma.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default SettingsPage

import {
  Bell,
  Cpu,
  Database,
  HardDrive,
  RefreshCw,
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
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useState } from 'react'

import { PageHeader } from '@/components/EmptyState'
import { ModeSwitcher } from '@/components/ModeSwitcher'
import { PeopleDenied } from '@/components/people/PeopleDenied'
import { useAuth } from '@/lib/auth'
import { useMode } from '@/lib/mode'
import { useI18n } from '@/i18n/i18n'
import { formatDate } from '@/lib/format'

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

/**
 * The only page that can change processing mode, and it now reads and writes
 * the real API through `useMode`. Everything below the mode section is still
 * a placeholder — those toggles have no backend and are labelled as such
 * rather than pretending to persist.
 */
export function SettingsPage() {
  const { user } = useAuth()
  const { t } = useI18n()
  const { settings, canEdit, refresh } = useMode()

  const [punctuation, setPunctuation] = useState(true)
  const [speakerLabels, setSpeakerLabels] = useState(false)
  const [autoDelete, setAutoDelete] = useState(false)
  const [problemAlerts, setProblemAlerts] = useState(true)
  const [gpu, setGpu] = useState(false)

  if (user?.role !== 'admin') {
    return (
      <PeopleDenied
        titleKey="settings.no_access"
        descriptionKey="settings.no_access_desc"
      />
    )
  }

  const notImplemented = () => toast.info(t('settings.saved_soon'))

  return (
    <div>
      <PageHeader
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
        {/* --- processing mode: the real thing -------------------------- */}
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
                checked={gpu}
                onCheckedChange={(v) => {
                  setGpu(v)
                  notImplemented()
                }}
                aria-label={t('settings.row.use_gpu')}
              />
              <Coming />
            </Row>

            {settings?.updated_at && (
              <p className="text-2xs text-muted-foreground">
                {t('settings.last_updated', { date: formatDate(settings.updated_at) })}
              </p>
            )}
          </CardContent>
        </Card>

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
                checked={punctuation}
                onCheckedChange={(v) => {
                  setPunctuation(v)
                  notImplemented()
                }}
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
                checked={speakerLabels}
                onCheckedChange={(v) => {
                  setSpeakerLabels(v)
                  notImplemented()
                }}
                aria-label={t('settings.row.speaker_labels')}
              />
            </Row>
          </CardContent>
        </Card>

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
              <Switch
                checked={autoDelete}
                onCheckedChange={(v) => {
                  setAutoDelete(v)
                  notImplemented()
                }}
                aria-label={t('settings.row.auto_delete')}
              />
            </Row>
            <Separator />
            <Row
              icon={RefreshCw}
              title={t('settings.row.reprocess')}
              description={t('settings.row.reprocess_desc')}
            >
              <Button size="sm" variant="outline" onClick={notImplemented}>
                {t('settings.row.reprocess_action')}
              </Button>
            </Row>
            <Separator />
            <Row icon={Trash2} title={t('settings.row.purge')} description={t('settings.row.purge_desc')}>
              <Button size="sm" variant="outline" onClick={notImplemented}>
                {t('settings.row.purge_action')}
              </Button>
            </Row>
          </CardContent>
        </Card>

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
                checked={problemAlerts}
                onCheckedChange={(v) => {
                  setProblemAlerts(v)
                  notImplemented()
                }}
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

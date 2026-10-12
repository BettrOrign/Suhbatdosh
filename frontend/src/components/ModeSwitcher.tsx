import { motion, useReducedMotion } from 'framer-motion'
import { Cloud, Lock, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/i18n'
import { useMode, type Mode } from '@/lib/mode'
import { SPRING } from '@/lib/motion'
import { cn } from '@/lib/utils'

const OPTIONS: { value: Mode; icon: typeof Cloud; labelKey: string; hintKey: string }[] = [
  { value: 'online', icon: Cloud, labelKey: 'settings.mode.online', hintKey: 'settings.mode.online_hint' },
  { value: 'private', icon: Lock, labelKey: 'settings.mode.private', hintKey: 'settings.mode.private_hint' },
]

/**
 * Reads and writes `GET/PATCH /api/settings` through the `useMode` seam.
 * Non-admins get the same control, disabled, plus an explanation — they are
 * allowed to SEE the mode but must never be able to change it.
 */
export function ModeSwitcher() {
  const { t } = useI18n()
  const reduced = useReducedMotion()
  const { mode, setMode, canEdit, saving, sttUnavailable, fallBackToOnline } = useMode()

  const active = OPTIONS.find((o) => o.value === mode) ?? OPTIONS[0]
  const ActiveIcon = active.icon

  return (
    <div className="flex flex-col gap-2.5">
      <div
        role="radiogroup"
        aria-label={t('settings.mode.label')}
        aria-busy={saving}
        className={cn(
          'relative grid max-w-sm grid-cols-2 gap-1 rounded-lg border border-border bg-surface-sunken p-1',
          !canEdit && 'opacity-70'
        )}
      >
        {!reduced && (
          <motion.span
            layoutId="mode-switcher-thumb"
            transition={SPRING.snappy}
            className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-md bg-surface shadow-e1 ring-1 ring-border"
            style={{ left: mode === 'private' ? 'calc(50% + 0.125rem)' : '0.125rem' }}
            aria-hidden="true"
          />
        )}
        {reduced && (
          <span
            className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-md bg-surface shadow-e1 ring-1 ring-border"
            style={{ left: mode === 'private' ? 'calc(50% + 0.125rem)' : '0.125rem' }}
            aria-hidden="true"
          />
        )}

        {OPTIONS.map(({ value, icon: Icon, labelKey }) => {
          const isActive = value === mode
          const unavailable = value === 'private' && sttUnavailable
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={!canEdit}
              onClick={() => void setMode(value)}
              title={unavailable ? t('mode.stt_unavailable_title') : undefined}
              className={cn(
                'relative z-10 flex items-center justify-center gap-1.5 rounded-sm px-3 py-2 text-xs font-medium',
                'outline-none transition-colors duration-150',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                'disabled:cursor-not-allowed',
                isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{t(labelKey)}</span>
            </button>
          )
        })}
      </div>

      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <ActiveIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
        <span>{t(active.hintKey)}</span>
      </p>

      {sttUnavailable && (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning-soft-foreground"
        >
          <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="font-medium">{t('mode.stt_unavailable_title')}</p>
            <p className="leading-relaxed">{t('mode.stt_unavailable_desc')}</p>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => void fallBackToOnline()}>
                {t('mode.fallback_online')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

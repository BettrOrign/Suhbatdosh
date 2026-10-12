import { Globe } from 'lucide-react'

import { useI18n } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

/**
 * Single-language toggle button. The old `LanguageToggle` export (a two-up
 * EN / O'Z segmented control) had zero call sites and was dead code.
 */
export function LanguageToggleIcon() {
  const { lang, setLang, t } = useI18n()
  const next = lang === 'en' ? 'uz' : 'en'

  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      aria-label={t('common.toggle_language')}
      title={t('settings.language')}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground',
        'outline-none transition-colors duration-150',
        'hover:bg-surface-hover hover:text-foreground',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
      )}
    >
      <Globe aria-hidden="true" className="size-4" />
      <span className="sr-only">
        {t('settings.language')}: {lang.toUpperCase()}
      </span>
    </button>
  )
}

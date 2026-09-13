import { Globe } from 'lucide-react'
import { useI18n } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

export function LanguageToggle() {
  const { lang, setLang } = useI18n()
  return (
    <div className="flex items-center gap-0.5 overflow-hidden rounded-md border text-xs font-medium">
      <button
        type="button"
        onClick={() => setLang('en')}
        className={cn(
          'px-2.5 py-1 transition-colors',
          lang === 'en'
            ? 'bg-primary text-primary-foreground'
            : 'hover:bg-muted',
        )}
        aria-pressed={lang === 'en'}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLang('uz')}
        className={cn(
          'px-2.5 py-1 transition-colors',
          lang === 'uz'
            ? 'bg-primary text-primary-foreground'
            : 'hover:bg-muted',
        )}
        aria-pressed={lang === 'uz'}
      >
        O'Z
      </button>
    </div>
  )
}

export function LanguageToggleIcon() {
  const { lang, setLang, t } = useI18n()
  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'en' ? 'uz' : 'en')}
      aria-label={t('common.toggle_language')}
      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <Globe className="size-4" />
    </button>
  )
}

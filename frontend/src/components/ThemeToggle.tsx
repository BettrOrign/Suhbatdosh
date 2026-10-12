import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useI18n } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const { t } = useI18n()
  const isDark = resolvedTheme === 'dark'
  const label = isDark ? t('theme.light') : t('theme.dark')

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={label}
      title={label}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground',
        'outline-none transition-colors duration-150',
        'hover:bg-surface-hover hover:text-foreground',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
      )}
    >
      <Sun
        aria-hidden="true"
        className={cn(
          'size-4 transition-[opacity,transform] duration-200 ease-emphasized',
          isDark ? 'scale-75 rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100'
        )}
      />
      <Moon
        aria-hidden="true"
        className={cn(
          'absolute size-4 transition-[opacity,transform] duration-200 ease-emphasized',
          isDark ? 'scale-100 rotate-0 opacity-100' : 'scale-75 -rotate-90 opacity-0'
        )}
      />
    </button>
  )
}

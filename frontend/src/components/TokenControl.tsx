import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Copy, Eye, EyeOff, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

interface TokenControlProps {
  token: string | null
  onRegenerate: () => Promise<string>
  disabled?: boolean
}

function mask(token: string): string {
  if (token.length <= 8) return '•'.repeat(token.length)
  return `${token.slice(0, 4)}${'•'.repeat(12)}${token.slice(-4)}`
}

export function TokenControl({ token, onRegenerate, disabled }: TokenControlProps) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [visible, setVisible] = useState(false)
  const { t } = useI18n()

  const flash = () => {
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      flash()
    } catch {
      toast.error(t('token.copy_failed'))
    }
  }

  const regenerate = async () => {
    if (busy || !window.confirm(t('token.regenerate_confirm'))) return
    setBusy(true)
    try {
      const next = await onRegenerate()
      setVisible(true)
      try {
        await navigator.clipboard.writeText(next)
        toast.success(t('token.new_copied'))
      } catch {
        // Clipboard API is blocked in some contexts (insecure origin, iframe).
        const ta = document.createElement('textarea')
        ta.value = next
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        toast.success(t('token.new_copied'))
      }
    } catch (e) {
      toast.error(t('token.regenerate_failed', { error: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  const iconButton = (label: string, onClick: () => void, icon: React.ReactNode, extra?: string) => (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn('shrink-0', extra)}
    >
      {icon}
    </Button>
  )

  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5">
      <code
        data-numeric
        className="min-w-0 flex-1 truncate rounded-sm bg-surface-sunken px-1.5 py-1 font-mono text-2xs text-muted-foreground ring-1 ring-border-subtle ring-inset"
      >
        {token ? (visible ? token : mask(token)) : '—'}
      </code>
      {iconButton(
        visible ? t('token.hide') : t('token.reveal'),
        () => setVisible((v) => !v),
        visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />
      )}
      <div className="opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 focus-within:opacity-100 has-[button:focus-visible]:opacity-100">
        {iconButton(
          t('token.copy'),
          () => {
            if (token) void copy(token)
          },
          copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />
        )}
        {iconButton(t('token.regenerate'), () => void regenerate(), <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} />)}
      </div>
    </div>
  )
}

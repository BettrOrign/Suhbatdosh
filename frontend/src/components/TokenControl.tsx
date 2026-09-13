import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Copy, Eye, EyeOff, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/i18n'

interface TokenControlProps {
  token: string | null
  onRegenerate: () => Promise<string>
  disabled?: boolean
}

function mask(token: string): string {
  if (token.length <= 8) return '•'.repeat(token.length)
  return `${token.slice(0, 4)}${'•'.repeat(token.length - 8)}${token.slice(-4)}`
}

export function TokenControl({ token, onRegenerate, disabled }: TokenControlProps) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [visible, setVisible] = useState(false)
  const { t } = useI18n()

  const copy = async () => {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
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

  const display = token ? (visible ? token : mask(token)) : '—'

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground tabular-nums">
        {display}
      </code>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setVisible((v) => !v)}
        disabled={!token || disabled}
        aria-label={visible ? t('token.hide') : t('token.show')}
        title={visible ? t('token.hide') : t('token.reveal')}
      >
        {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </Button>
      <Button variant="ghost" size="icon" onClick={copy} disabled={!token || disabled} aria-label={t('token.copy')} title={t('token.copy')}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
      <Button variant="ghost" size="icon" onClick={regenerate} disabled={busy || disabled} aria-label={t('token.regenerate')} title={t('token.regenerate')}>
        <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
      </Button>
    </div>
  )
}

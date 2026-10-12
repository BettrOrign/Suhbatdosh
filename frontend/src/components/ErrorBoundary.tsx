import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { translations } from '@/i18n/translations'
import type { Lang } from '@/i18n/translations'
import { Card, CardContent } from '@/components/ui/card'

interface Props {
  children: ReactNode
  /** Current UI language, injected so the boundary can localise itself. */
  lang: Lang
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Previously hardcoded Uzbek in both languages. Now localised, and it offers
 * a real recovery action (reload) rather than only re-rendering the subtree
 * that already threw.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  override render() {
    if (!this.state.hasError) return this.props.children

    const t = (key: string) => translations[this.props.lang]?.[key] ?? translations.en[key] ?? key

    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="flex size-11 items-center justify-center rounded-lg bg-destructive-soft text-destructive-soft-foreground ring-1 ring-destructive/20 ring-inset">
              <TriangleAlert aria-hidden="true" className="size-5" />
            </div>
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">{t('error.title')}</h2>
              <p className="text-xs leading-relaxed text-muted-foreground">{t('error.desc')}</p>
              {this.state.error && (
                <p className="mt-2 rounded-md bg-surface-sunken px-3 py-2 font-mono text-2xs break-words text-muted-foreground">
                  {this.state.error.message}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => this.setState({ hasError: false, error: null })}>
                {t('error.retry')}
              </Button>
              <Button size="sm" onClick={() => window.location.reload()}>
                <RefreshCw aria-hidden="true" className="size-3.5" />
                {t('error.reload')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }
}

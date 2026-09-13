import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center p-6">
          <Card className="max-w-md border-destructive/20">
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10">
                <AlertTriangle className="size-7 text-destructive" />
              </div>
              <div className="space-y-1">
                <p className="text-lg font-semibold">Xatolik yuz berdi</p>
                <p className="text-sm text-muted-foreground">
                  Kutilmagan xatolik yuz berdi. Iltimos, qayta urinib ko'ring.
                </p>
                {this.state.error && (
                  <p className="mt-2 rounded-lg bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
                    {this.state.error.message}
                  </p>
                )}
              </div>
              <Button onClick={this.handleRetry} variant="outline" className="gap-2">
                <RefreshCw className="size-4" /> Qayta urinish
              </Button>
            </CardContent>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}

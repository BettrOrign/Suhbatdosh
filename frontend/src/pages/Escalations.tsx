import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { Escalation } from '@/lib/types'
import { useI18n } from '@/i18n/i18n'

export function EscalationsPage() {
  const { lang } = useI18n()
  const isUz = lang === 'uz'
  const [items, setItems] = useState<Escalation[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all')
  const [resolvingId, setResolvingId] = useState<number | null>(null)
  const [notes, setNotes] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const statusParam = filter === 'all' ? undefined : filter
      setItems(await api.listEscalations(statusParam))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  const handleResolve = async (id: number) => {
    try {
      await api.resolveEscalation(id, notes)
      toast.success(isUz ? 'Eskalatsiya hal qilindi' : 'Escalation resolved')
      setResolvingId(null)
      setNotes('')
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="space-y-4 pb-12">
      <PageHeader
        eyebrow={isUz ? 'Sifat va Nazorat' : 'Quality & Coaching'}
        title={isUz ? 'Eskalatsiyalar markazi' : 'Escalations Hub'}
        description={
          isUz
            ? 'Muammoli qoʻngʻiroqlar boʻyicha barcha ogohlantirishlar va ijro holati'
            : 'Org-wide queue of flagged calls, assigned owners, and resolution tracking'
        }
        actions={
          <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <TabsList>
              <TabsTrigger value="all">{isUz ? 'Barchasi' : 'All'}</TabsTrigger>
              <TabsTrigger value="open">{isUz ? 'Ochiq' : 'Open'}</TabsTrigger>
              <TabsTrigger value="resolved">{isUz ? 'Hal qilingan' : 'Resolved'}</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <CheckCircle2 className="size-8 text-success" />
            <p className="text-sm font-medium">
              {isUz ? 'Eskalatsiyalar topilmadi' : 'No escalations found'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((esc) => (
            <Card key={esc.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <AlertTriangle className="size-4 text-warning" />
                    <CardTitle className="text-sm font-semibold">
                      {esc.call_name || `Call #${esc.call_id}`}
                    </CardTitle>
                    <Badge variant={esc.status === 'resolved' ? 'success' : 'destructive'}>
                      {esc.status}
                    </Badge>
                    <Badge variant="outline">{esc.severity}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {isUz ? 'Masʼul:' : 'Assigned:'}{' '}
                    <span className="font-medium text-foreground">
                      {esc.assigned_user_name || '—'}
                    </span>{' '}
                    · {formatDate(esc.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/calls/${esc.call_id}`}>
                      <ExternalLink className="size-3.5" />
                      {isUz ? 'Qoʻngʻiroq' : 'Open Call'}
                    </Link>
                  </Button>
                  {esc.status !== 'resolved' && (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => {
                        setResolvingId(resolvingId === esc.id ? null : esc.id)
                        setNotes('')
                      }}
                    >
                      <CheckCircle2 className="size-3.5" />
                      {isUz ? 'Hal qilish' : 'Resolve'}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <p className="text-foreground">{esc.detected_problem}</p>
                {esc.assigned_reason && (
                  <p className="text-muted-foreground">{esc.assigned_reason}</p>
                )}
                {esc.resolution_notes && (
                  <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-xs">
                    <span className="font-medium text-success">
                      {isUz ? 'Yechim izohi:' : 'Resolution note:'}
                    </span>{' '}
                    {esc.resolution_notes}
                  </div>
                )}
                {resolvingId === esc.id && (
                  <div className="mt-2 flex items-center gap-2 pt-2">
                    <Input
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={
                        isUz ? 'Qanday hal qilindi? (izoh)' : 'How was this resolved?'
                      }
                    />
                    <Button size="sm" onClick={() => void handleResolve(esc.id)}>
                      {isUz ? 'Saqlash' : 'Confirm'}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export default EscalationsPage

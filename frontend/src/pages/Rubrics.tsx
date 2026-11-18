import { useCallback, useEffect, useState } from 'react'
import { ClipboardCheck, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { Rubric, RubricCriterion } from '@/lib/types'
import { useI18n } from '@/i18n/i18n'

const EMPTY_CRITERION: RubricCriterion = { key: '', label: '', weight: 25, description: '' }

export function RubricsPage() {
  const { lang } = useI18n()
  const isUz = lang === 'uz'
  const [rubrics, setRubrics] = useState<Rubric[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [callType, setCallType] = useState<'receptionist' | 'manager' | 'all'>('receptionist')
  const [description, setDescription] = useState('')
  const [criteria, setCriteria] = useState<RubricCriterion[]>([{ ...EMPTY_CRITERION }])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRubrics(await api.listRubrics())
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const valid = criteria.filter((c) => c.key.trim() && c.label.trim())
    if (!name.trim() || valid.length === 0) {
      toast.error(isUz ? 'Nom va kamida 1 mezon kiriting' : 'Provide a name and at least 1 criterion')
      return
    }
    try {
      await api.createRubric({ name, call_type: callType, description, criteria: valid })
      toast.success(isUz ? 'Mezon yaratildi' : 'Rubric created')
      setShowCreate(false)
      setName('')
      setDescription('')
      setCriteria([{ ...EMPTY_CRITERION }])
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const toggleActive = async (r: Rubric) => {
    try {
      await api.updateRubric(r.id, { active: !r.active })
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await api.deleteRubric(id)
      toast.success(isUz ? 'Oʻchirildi' : 'Deleted')
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="space-y-4 pb-12">
      <PageHeader
        eyebrow={isUz ? 'Sifat va Nazorat' : 'Quality & Coaching'}
        title={isUz ? 'Baholash mezonlari (Rubrikalar)' : 'Scoring Rubrics'}
        description={
          isUz
            ? 'Resepshn va menejerlar qoʻngʻiroqlarini AI qanday mezonlar boʻyicha baholashini boshqaring'
            : 'Configure AI scoring criteria per role (receptionist vs. admissions manager)'
        }
        actions={
          <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
            <Plus className="size-3.5" />
            {isUz ? 'Yangi mezon' : 'New Rubric'}
          </Button>
        }
      />

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {isUz ? 'Yangi baholash mezoni' : 'Create Custom Rubric'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleCreate(e)} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={isUz ? 'Mezon nomi (masalan: MBSI Resepshn)' : 'Rubric name'}
                />
                <select
                  value={callType}
                  onChange={(e) => setCallType(e.target.value as typeof callType)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="receptionist">{isUz ? 'Resepshn' : 'Receptionist'}</option>
                  <option value="manager">{isUz ? 'Menejer' : 'Manager'}</option>
                  <option value="all">{isUz ? 'Barchasi' : 'All'}</option>
                </select>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={isUz ? 'Qisqa tavsif' : 'Short description'}
                />
              </div>

              <div className="space-y-2">
                {criteria.map((c, idx) => (
                  <div key={idx} className="grid gap-2 sm:grid-cols-12">
                    <Input
                      className="sm:col-span-3"
                      value={c.key}
                      onChange={(e) => {
                        const next = [...criteria]
                        next[idx] = { ...c, key: e.target.value }
                        setCriteria(next)
                      }}
                      placeholder="key (e.g. test_date)"
                    />
                    <Input
                      className="sm:col-span-4"
                      value={c.label}
                      onChange={(e) => {
                        const next = [...criteria]
                        next[idx] = { ...c, label: e.target.value }
                        setCriteria(next)
                      }}
                      placeholder={isUz ? 'Nomi' : 'Label'}
                    />
                    <Input
                      className="sm:col-span-2"
                      type="number"
                      min={0}
                      max={100}
                      value={c.weight}
                      onChange={(e) => {
                        const next = [...criteria]
                        next[idx] = { ...c, weight: Number(e.target.value) || 0 }
                        setCriteria(next)
                      }}
                      placeholder="%"
                    />
                    <Input
                      className="sm:col-span-3"
                      value={c.description}
                      onChange={(e) => {
                        const next = [...criteria]
                        next[idx] = { ...c, description: e.target.value }
                        setCriteria(next)
                      }}
                      placeholder={isUz ? 'Izoh' : 'Description'}
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCriteria([...criteria, { ...EMPTY_CRITERION }])}
                >
                  + {isUz ? 'Kriteriy qoʻshish' : 'Add criterion'}
                </Button>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                  {isUz ? 'Bekor qilish' : 'Cancel'}
                </Button>
                <Button type="submit" size="sm">
                  {isUz ? 'Saqlash' : 'Save Rubric'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rubrics.map((r) => (
            <Card key={r.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="size-4 text-primary" />
                    <CardTitle className="text-sm font-semibold">{r.name}</CardTitle>
                    <Badge variant="outline">{r.call_type}</Badge>
                    <Badge variant={r.active ? 'success' : 'secondary'}>
                      {r.active ? (isUz ? 'Faol' : 'Active') : isUz ? 'Nofaol' : 'Inactive'}
                    </Badge>
                  </div>
                  {r.description && (
                    <p className="text-xs text-muted-foreground">{r.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => void toggleActive(r)}>
                    {r.active ? (isUz ? 'Oʻchirish' : 'Disable') : isUz ? 'Yoqish' : 'Enable'}
                  </Button>
                  {!r.is_default && (
                    <Button variant="ghost" size="sm" onClick={() => void handleDelete(r.id)}>
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-1.5 text-xs">
                {r.criteria.map((c) => (
                  <div
                    key={c.key}
                    className="flex items-start justify-between gap-2 rounded-md bg-surface-sunken/70 px-3 py-2"
                  >
                    <div>
                      <p className="font-medium text-foreground">{c.label}</p>
                      {c.description && (
                        <p className="text-2xs text-muted-foreground">{c.description}</p>
                      )}
                    </div>
                    <Badge variant="secondary" className="shrink-0 tabular-nums">
                      {c.weight}%
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export default RubricsPage

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { motion, useReducedMotion } from 'framer-motion'
import { Building2, Mail, Pencil, Phone, Plus, Search, Trash2, UserRound } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { Stagger, fadeUp } from '@/lib/motion'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/i18n/i18n'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { Client, User } from '@/lib/types'

const NO_MANAGER = '__none__'

interface ClientDialogProps {
  mode: 'create' | 'edit'
  client: Client | null
  managers: User[]
  showManagerField: boolean
  onClose: () => void
  onSaved: () => void
}

function ClientDialog({ mode, client, managers, showManagerField, onClose, onSaved }: ClientDialogProps) {
  const [name, setName] = useState(client?.name ?? '')
  const [phone, setPhone] = useState(client?.phone ?? '')
  const [company, setCompany] = useState(client?.company ?? '')
  const [email, setEmail] = useState(client?.email ?? '')
  const [notes, setNotes] = useState(client?.notes ?? '')
  const [manager, setManager] = useState<string>(
    client?.manager_id != null ? String(client.manager_id) : NO_MANAGER,
  )
  const [saving, setSaving] = useState(false)
  const { t } = useI18n()

  const canSave = name.trim().length > 0 && !saving

  const payload = () => {
    const base = {
      name: name.trim(),
      phone: phone.trim(),
      company: company.trim(),
      email: email.trim(),
      notes: notes.trim(),
    }
    if (!showManagerField) return base
    return {
      ...base,
      manager_id: manager === NO_MANAGER ? null : Number(manager),
    }
  }

  const submit = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      if (mode === 'create') {
        await api.createClient(payload())
        toast.success(t('clients.added'))
      } else if (client) {
        await api.updateClient(client.id, payload())
        toast.success(t('clients.updated'))
      }
      onSaved()
      onClose()
    } catch (e) {
      toast.error(t('clients.save_failed', { error: (e as Error).message }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => {
      if (!o && !saving) onClose()
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? t('clients.add_dialog') : t('clients.edit_dialog')}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? t('clients.add_desc')
              : t('clients.edit_desc')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="client-name">
              {t('clients.name')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="client-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('clients.name_placeholder')}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="client-phone">{t('clients.phone')}</Label>
              <Input
                id="client-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 0100"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-email">{t('clients.email')}</Label>
              <Input
                id="client-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="budget@acme.com"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="client-company">{t('clients.company')}</Label>
            <Input
              id="client-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder={t('clients.company_placeholder')}
            />
          </div>
          {showManagerField && (
            <div className="space-y-2">
              <Label>{t('clients.manager')}</Label>
              <Select value={manager} onValueChange={setManager}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('clients.unassigned')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_MANAGER}>{t('clients.unassigned')}</SelectItem>
                  {managers.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="client-notes">{t('clients.notes')}</Label>
            <Textarea
              id="client-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('clients.notes_placeholder')}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!canSave}>
            {saving ? t('clients.saving') : mode === 'create' ? t('clients.add') : t('common.save_changes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ClientRow({ client, onEdit, onChanged }: {
  client: Client
  onEdit: (c: Client) => void
  onChanged: () => void
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { t } = useI18n()

  const remove = async () => {
    if (!window.confirm(t('clients.delete_confirm', { name: client.name }))) return
    try {
      await api.deleteClient(client.id)
      toast.success(t('clients.deleted'))
      onChanged()
    } catch (e) {
      toast.error(t('clients.delete_failed', { error: (e as Error).message }))
    }
  }

  return (
    <motion.div variants={fadeUp}>
      <Card className="transition-all duration-200 ease-smooth hover:shadow-lg hover:shadow-foreground/5">
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <UserRound className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{client.name}</p>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {client.company && (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <Building2 className="size-3 shrink-0" />
                    <span className="truncate">{client.company}</span>
                  </span>
                )}
                {client.phone && (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <Phone className="size-3 shrink-0" />
                    <span className="truncate">{client.phone}</span>
                  </span>
                )}
                {client.email && (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <Mail className="size-3 shrink-0" />
                    <span className="truncate">{client.email}</span>
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="secondary" className="max-w-40 truncate">
              {client.manager_name ?? t('clients.unassigned')}
            </Badge>
            <div className="hidden items-baseline gap-1.5 text-right md:flex">
              <p className="text-sm font-semibold tabular-nums">{client.call_count}</p>
              <p className="text-xs text-muted-foreground">
                {client.call_count === 1 ? t('clients.singular') : t('clients.plural')}
              </p>
            </div>
            <p className="hidden text-xs text-muted-foreground lg:block">
              {formatDate(client.created_at)}
            </p>
          </div>
           <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="outline" size="icon-sm" onClick={() => onEdit(client)} aria-label={t('clients.edit_btn')}>
                <Pencil className="size-4" />
              </Button>
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={remove}
                  aria-label={t('clients.delete_btn')}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

export function Clients() {
  const { user } = useAuth()
  const { t } = useI18n()
  const isAdmin = user?.role === 'admin'
  const isManager = user?.role === 'manager'
  const showManagerField = isAdmin || user?.role === 'receptionist'
  const reduceMotion = useReducedMotion()

  const [clients, setClients] = useState<Client[]>([])
  const [managers, setManagers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; client: Client } | null>(null)

  const refresh = useCallback(async () => {
    try {
      setClients(await api.listClients())
    } catch (e) {
      toast.error(t('clients.load_failed', { error: (e as Error).message }))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!showManagerField) return
    api
      .listUsers()
      .then((us) => setManagers(us.filter((u) => u.role === 'manager')))
      .catch(() => setManagers([]))
  }, [showManagerField])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clients
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q) ||
        (c.email?.toLowerCase().includes(q) ?? false),
    )
  }, [clients, search])

  const openCreate = () => setDialog({ mode: 'create' })
  const openEdit = (client: Client) => setDialog({ mode: 'edit', client })

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('clients.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {isManager
              ? t('clients.manager_desc')
              : isAdmin
                ? t('clients.all_desc')
                : t('clients.generic_desc')}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:flex-nowrap">
          <div className="relative min-w-0 flex-1 basis-48 sm:flex-none">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('clients.search_placeholder')}
              className="w-full pl-8 sm:w-56"
            />
          </div>
          <Button onClick={openCreate} className="shrink-0">
            <Plus /> {t('clients.add')}
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
              <Building2 className="size-6 text-muted-foreground" />
            </div>
            <p className="text-base font-semibold">
              {search ? t('clients.no_match') : t('clients.no_clients')}
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {search
                ? t('clients.no_match_desc')
                : t('clients.no_clients_desc')}
            </p>
            {!search && (
              <Button onClick={openCreate}>
                <Plus /> {t('clients.add_first')}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : reduceMotion ? (
        <div className="space-y-3">
          {filtered.map((c) => (
            <ClientRow
              key={c.id}
              client={c}
              onEdit={openEdit}
              onChanged={refresh}
            />
          ))}
        </div>
      ) : (
        <Stagger className="space-y-3">
          {filtered.map((c) => (
            <ClientRow
              key={c.id}
              client={c}
              onEdit={openEdit}
              onChanged={refresh}
            />
          ))}
        </Stagger>
      )}

      {dialog && (
        <ClientDialog
          key={dialog.mode === 'create' ? 'create' : `edit-${dialog.client.id}`}
          mode={dialog.mode}
          client={dialog.mode === 'edit' ? dialog.client : null}
          managers={managers}
          showManagerField={showManagerField}
          onClose={() => setDialog(null)}
          onSaved={refresh}
        />
      )}
    </div>
  )
}

export default Clients
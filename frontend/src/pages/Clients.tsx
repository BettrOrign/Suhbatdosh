import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, Mail, Pencil, Phone, Plus, Search, Trash2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import { EmptyState, PageHeader } from '@/components/EmptyState'
import { Stagger, fadeUp } from '@/lib/motion'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useI18n } from '@/i18n/i18n'
import { formatDate, matches } from '@/lib/format'
import type { Client } from '@/lib/types'

const NO_MANAGER = '__none__'

/** `/api/managers/options` projection — deliberately not a full User. */
interface ManagerOption {
  id: number
  name: string
}

function ClientDialog({
  mode,
  client,
  managers,
  showManagerField,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  client: Client | null
  managers: ManagerOption[]
  showManagerField: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [form, setForm] = useState({
    name: client?.name ?? '',
    phone: client?.phone ?? '',
    company: client?.company ?? '',
    email: client?.email ?? '',
    notes: client?.notes ?? '',
  })
  const [manager, setManager] = useState<string>(
    client?.manager_id != null ? String(client.manager_id) : NO_MANAGER,
  )
  const [saving, setSaving] = useState(false)

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const canSave = form.name.trim().length > 0 && !saving

  const submit = async () => {
    if (!canSave) return
    setSaving(true)
    const payload = {
      ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])),
      ...(showManagerField ? { manager_id: manager === NO_MANAGER ? null : Number(manager) } : {}),
    }
    try {
      if (mode === 'create') {
        await api.createClient(payload)
        toast.success(t('clients.added'))
      } else if (client) {
        await api.updateClient(client.id, payload)
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
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? t('clients.add_dialog') : t('clients.edit_dialog')}</DialogTitle>
          <DialogDescription>
            {mode === 'create' ? t('clients.add_desc') : t('clients.edit_desc')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="client-name">
              {t('clients.name')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="client-name"
              value={form.name}
              onChange={set('name')}
              placeholder={t('clients.name_placeholder')}
              autoFocus
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="client-phone">{t('clients.phone')}</Label>
              <Input
                id="client-phone"
                value={form.phone}
                onChange={set('phone')}
                placeholder="+998 90 000 00 00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-email">{t('clients.email')}</Label>
              <Input id="client-email" type="email" value={form.email} onChange={set('email')} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-company">{t('clients.company')}</Label>
            <Input
              id="client-company"
              value={form.company}
              onChange={set('company')}
              placeholder={t('clients.company_placeholder')}
            />
          </div>
          {showManagerField && (
            <div className="space-y-1.5">
              <Label htmlFor="client-manager">{t('clients.manager')}</Label>
              <Select value={manager} onValueChange={setManager}>
                <SelectTrigger id="client-manager" className="w-full">
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
          <div className="space-y-1.5">
            <Label htmlFor="client-notes">{t('clients.notes')}</Label>
            <Textarea
              id="client-notes"
              value={form.notes}
              onChange={set('notes')}
              placeholder={t('clients.notes_placeholder')}
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!canSave} className="w-full">
              {saving
                ? t('clients.saving')
                : mode === 'create'
                  ? t('clients.add')
                  : t('common.save_changes')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ClientRow({
  client,
  canEdit,
  canDelete,
  onEdit,
  onChanged,
}: {
  client: Client
  canEdit: boolean
  canDelete: boolean
  onEdit: (c: Client) => void
  onChanged: () => void
}) {
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
    <motion.div
      variants={fadeUp}
      className="group/row flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-surface px-3 py-2.5 ring-1 ring-border transition-colors duration-150 hover:ring-border-strong"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{client.name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-muted-foreground">
          {client.company && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Building2 aria-hidden="true" className="size-3 shrink-0" />
              <span className="truncate">{client.company}</span>
            </span>
          )}
          {client.phone && (
            <span className="inline-flex min-w-0 items-center gap-1 tabular-nums">
              <Phone aria-hidden="true" className="size-3 shrink-0" />
              <span className="truncate">{client.phone}</span>
            </span>
          )}
          {client.email && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Mail aria-hidden="true" className="size-3 shrink-0" />
              <span className="truncate">{client.email}</span>
            </span>
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <Badge variant="outline" className="max-w-40 truncate">
          {client.manager_name ?? t('clients.unassigned')}
        </Badge>
        <span className="hidden items-baseline gap-1 text-xs md:flex">
          <span className="data-value text-sm">{client.call_count}</span>
          <span className="text-muted-foreground">
            {client.call_count === 1 ? t('clients.singular') : t('clients.plural')}
          </span>
        </span>
        <span className="hidden w-32 text-right text-xs text-muted-foreground lg:block">
          {formatDate(client.created_at)}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {canEdit && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onEdit(client)}
            aria-label={`${t('clients.edit_btn')}: ${client.name}`}
          >
            <Pencil aria-hidden="true" className="size-3.5" />
          </Button>
        )}
        {canDelete && (
          <Button
            variant="destructive-ghost"
            size="icon-sm"
            onClick={() => void remove()}
            aria-label={`${t('clients.delete_btn')}: ${client.name}`}
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
          </Button>
        )}
      </div>
    </motion.div>
  )
}

export function Clients() {
  const { user } = useAuth()
  const { t } = useI18n()
  const role = user?.role
  const isAdmin = role === 'admin'
  const showManagerField = isAdmin || role === 'receptionist'
  // routes_clients.py allows writes for admin/manager/receptionist only. The
  // nav still shows /clients to yonalish, so without this they filled the whole
  // dialog and got a 403 on save.
  const canWrite = isAdmin || role === 'manager' || role === 'receptionist'

  const [clients, setClients] = useState<Client[]>([])
  const [managers, setManagers] = useState<ManagerOption[]>([])
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
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!showManagerField) return
    // Not listUsers(): that endpoint is admin/yonalish only, so a receptionist
    // got a 403, it was swallowed, and the "Manager" select offered nothing
    // but "Unassigned" while still being sent on save.
    api
      .listManagerOptions()
      .then(setManagers)
      .catch(() => setManagers([]))
  }, [showManagerField])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clients
    return clients.filter(
      (c) => matches(c.name, q) || matches(c.company, q) || matches(c.email, q) || matches(c.phone, q)
    )
  }, [clients, search])

  const searching = search.trim().length > 0
  const description =
    role === 'manager' ? t('clients.manager_desc') : isAdmin ? t('clients.all_desc') : t('clients.generic_desc')

  return (
    <div>
      <PageHeader
        title={t('clients.title')}
        description={description}
        actions={
          <>
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('clients.search_placeholder')}
                aria-label={t('clients.search_placeholder')}
                className="w-56 pl-8"
              />
            </div>
            {canWrite && (
              <Button onClick={() => setDialog({ mode: 'create' })}>
                <Plus aria-hidden="true" className="size-3.5" />
                {t('clients.add')}
              </Button>
            )}
          </>
        }
      />

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label={t('analytics.loading')}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={searching ? t('clients.no_match') : t('clients.no_clients')}
          description={searching ? t('clients.no_match_desc') : t('clients.no_clients_desc')}
          action={
            !searching ? (
              <Button size="sm" onClick={() => setDialog({ mode: 'create' })}>
                <Plus aria-hidden="true" className="size-3.5" />
                {t('clients.add_first')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Stagger className="space-y-2">
          {filtered.map((c) => (
            <ClientRow
              key={c.id}
              client={c}
              canEdit={canWrite}
              canDelete={isAdmin}
              onEdit={(client) => setDialog({ mode: 'edit', client })}
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

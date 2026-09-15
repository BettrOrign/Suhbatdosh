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

interface AdminManagerDialogProps {
  mode: 'create' | 'edit'
  adminManager: Client | null
  managers: Client[]
  showManagerField: boolean
  onClose: () => void
  onSaved: () => void
}

function AdminManagerDialog({ mode, adminManager, managers, showManagerField, onClose, onSaved }: AdminManagerDialogProps) {
  const [name, setName] = useState(adminManager?.name ?? '')
  const [phone, setPhone] = useState(adminManager?.phone ?? '')
  const [company, setCompany] = useState(adminManager?.company ?? '')
  const [email, setEmail] = useState(adminManager?.email ?? '')
  const [notes, setNotes] = useState(adminManager?.notes ?? '')
  const [manager, setManager] = useState<string>(
    adminManager?.manager_id != null ? String(adminManager.manager_id) : NO_MANAGER,
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
        toast.success(t('managers.added'))
      } else if (adminManager) {
        await api.updateClient(adminManager.id, payload())
        toast.success(t('managers.updated'))
      }
      onSaved()
      onClose()
    } catch (e) {
      toast.error(t('managers.save_failed', { error: (e as Error).message }))
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
          <DialogTitle>{mode === 'create' ? t('managers.add') : t('managers.edit')}</DialogTitle>
          <DialogDescription>
            {mode === 'create' ? t('managers.add_desc') : t('managers.edit_desc')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="mgr-name">{t('users.name')}</Label>
            <Input id="mgr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('users.name_placeholder')} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="mgr-phone">{t('users.phone')}</Label>
              <Input id="mgr-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 0100" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mgr-email">{t('users.email')}</Label>
              <Input id="mgr-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="budget@acme.com" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mgr-company">{t('users.company')}</Label>
            <Input id="mgr-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder={t('users.company_placeholder')} />
          </div>
          {showManagerField && (
            <div className="space-y-2">
              <Label>{t('users.role')}</Label>
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
            <Label htmlFor="mgr-notes">{t('users.notes')}</Label>
            <Textarea id="mgr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('users.notes_placeholder')} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!canSave}>
            {saving ? t('managers.saving') : mode === 'create' ? t('managers.add') : t('common.save_changes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AdminManagerRow({ adminManager, onEdit, onChanged }: {
  adminManager: Client
  onEdit: (a: Client) => void
  onChanged: () => Promise<void>
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { t } = useI18n()

  const remove = async () => {
    if (!window.confirm(t('managers.delete_confirm', { name: adminManager.name }))) return
    try {
      await api.deleteUser(adminManager.id)
      toast.success(t('managers.deleted'))
      await onChanged()
    } catch (e) {
      toast.error(t('managers.delete_failed', { error: (e as Error).message }))
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
              <p className="truncate text-sm font-medium">{adminManager.name}</p>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {adminManager.company && (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <Building2 className="size-3 shrink-0" />
                    <span className="truncate">{adminManager.company}</span>
                  </span>
                )}
                {adminManager.phone && (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <Phone className="size-3 shrink-0" />
                    <span className="truncate">{adminManager.phone}</span>
                  </span>
                )}
                {adminManager.email && (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <Mail className="size-3 shrink-0" />
                    <span className="truncate">{adminManager.email}</span>
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="secondary" className="capitalize">{adminManager.role}</Badge>
            <Badge variant="secondary" className="max-w-40 truncate">
              {adminManager.manager_name ?? t('clients.unassigned')}
            </Badge>
            <div className="hidden items-baseline gap-1.5 text-right md:flex">
              <p className="text-sm font-semibold tabular-nums">{adminManager.call_count}</p>
              <p className="text-xs text-muted-foreground">
                {adminManager.call_count === 1 ? t('clients.singular') : t('clients.plural')}
              </p>
            </div>
            <p className="hidden text-xs text-muted-foreground lg:block">
              {formatDate(adminManager.created_at)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="icon-sm" onClick={() => onEdit(adminManager)} aria-label={t('managers.edit_btn')}>
              <Pencil className="size-4" />
            </Button>
            {isAdmin && (
              <Button variant="ghost" size="icon-sm" onClick={remove} aria-label={t('managers.delete_btn')} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

export function ManagersAdminPage() {
  const { user } = useAuth()
  const { t } = useI18n()
  const isAdmin = user?.role === 'admin'
  const isManager = user?.role === 'manager'
  const showManagerField = isAdmin || user?.role === 'receptionist'
  const reduceMotion = useReducedMotion()

  const [adminManagers, setAdminManagers] = useState<Client[]>([])
  const [managers, setManagers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; adminManager: Client } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await api.listUsers() as unknown as Client[]
      setAdminManagers(data.filter((a) => a.role === 'admin'))
    } catch (e) {
      toast.error(t('managers.load_failed', { error: (e as Error).message }))
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
      .then((us) => setManagers(us.filter((u) => u.role === 'manager') as User[]))
      .catch(() => setManagers([]))
  }, [showManagerField])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return adminManagers.filter((a) => a.role === 'admin')
    return adminManagers.filter(
      (a) => a.role === 'admin' &&
        a.name.toLowerCase().includes(q) ||
        a.company.toLowerCase().includes(q) ||
        (a.email?.toLowerCase().includes(q) ?? false),
    )
  }, [adminManagers, search])

  const openCreate = () => setDialog({ mode: 'create' })
  const openEdit = (a: Client) => setDialog({ mode: 'edit', adminManager: a })

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('managers.admin_section')}</h1>
          <p className="text-sm text-muted-foreground">
            {isManager
              ? t('managers.manager_desc')
              : isAdmin
                ? t('managers.all_desc')
                : t('managers.generic_desc')}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:flex-nowrap">
          <div className="relative min-w-0 flex-1 basis-48 sm:flex-none">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('clients.search_placeholder')} className="w-full pl-8 sm:w-56" />
          </div>
          <Button onClick={openCreate} className="shrink-0">
            <Plus /> {t('managers.add')}
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
              {search ? t('clients.no_match') : t('managers.no_managers')}
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {search ? t('clients.no_match_desc') : t('managers.no_managers_desc')}
            </p>
            {!search && (
              <Button onClick={openCreate}>
                <Plus /> {t('managers.add_first')}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : reduceMotion ? (
        <div className="space-y-3">
          {filtered.map((a) => (
            <AdminManagerRow key={a.id} adminManager={a} onEdit={openEdit} onChanged={refresh} />
          ))}
        </div>
      ) : (
        <Stagger className="space-y-3">
          {filtered.map((a) => (
            <AdminManagerRow key={a.id} adminManager={a} onEdit={openEdit} onChanged={refresh} />
          ))}
        </Stagger>
      )}

      {dialog && (
        <AdminManagerDialog
          key={dialog.mode === 'create' ? 'create' : `edit-${dialog.adminManager.id}`}
          mode={dialog.mode}
          adminManager={dialog.mode === 'edit' ? dialog.adminManager : null}
          managers={managers as unknown as Client[]}
          showManagerField={showManagerField}
          onClose={() => setDialog(null)}
          onSaved={refresh}
        />
      )}
    </div>
  )
}

export default ManagersAdminPage


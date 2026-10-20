import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Trash2, UserRound } from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { api } from '@/lib/api'
import { useI18n } from '@/i18n/i18n'
import { ListItem } from '@/lib/motion'
import { TokenControl } from '@/components/TokenControl'
import type { ManagedUser, Role } from '@/lib/types'

/** All four roles the backend supports. `yonalish` was missing from the UI. */
export const ALL_ROLES: Role[] = ['admin', 'manager', 'yonalish', 'receptionist']

export function roleBadgeVariant(role: Role): 'default' | 'secondary' | 'outline' | 'success' {
  switch (role) {
    case 'admin':
      return 'default'
    case 'manager':
      return 'success'
    case 'yonalish':
      return 'outline'
    default:
      return 'secondary'
  }
}

/* ---------------------------------------------------------------------------
 * Person dialog — creates/edits a USER ACCOUNT.
 *
 * This is the fix for the ManagersAdmin bug: that page was calling
 * `api.createClient` / `api.updateClient` while collecting user fields, so
 * creating an admin actually created a client. One dialog, correct endpoint.
 * ------------------------------------------------------------------------- */
export function PersonDialog({
  mode,
  person,
  lockRoleTo,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  person: ManagedUser | null
  lockRoleTo?: Role
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState(person?.name ?? '')
  const [email, setEmail] = useState(person?.email ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>(lockRoleTo ?? person?.role ?? 'manager')
  const [active, setActive] = useState(person?.active ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave =
    name.trim().length > 0 && email.trim().length > 0 && !saving && (mode === 'edit' || !!password)

  const submit = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      if (mode === 'create') {
        await api.createUser({ name: name.trim(), email: email.trim(), password, role })
        toast.success(t('users.created'))
      } else if (person) {
        await api.updateUser(person.id, {
          name: name.trim(),
          email: email.trim(),
          role,
          active,
          ...(password.trim() ? { password: password.trim() } : {}),
        })
        toast.success(t('users.updated'))
      }
      onSaved()
      onClose()
    } catch (e) {
      const message = (e as Error).message
      setError(t('users.save_failed', { error: message }))
      toast.error(t('users.save_failed', { error: message }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !saving) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? t('users.add_dialog') : t('users.edit_dialog')}</DialogTitle>
          <DialogDescription>
            {mode === 'create' ? t('users.add_desc') : t('users.edit_desc')}
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
            <Label htmlFor="person-name">{t('users.name')}</Label>
            <Input
              id="person-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('users.name_placeholder')}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="person-email">{t('users.email')}</Label>
            <Input
              id="person-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('users.email_placeholder')}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="person-password">
                {mode === 'create' ? t('users.password') : t('users.password_optional')}
              </Label>
              <Input
                id="person-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'create' ? t('app.password_placeholder') : t('users.password_leave')}
              />
            </div>
            <div className="space-y-1.5">
              {/* When the role is locked there is no control to point at, so a
                  `htmlFor` here labelled nothing — every "add person" dialog on
                  the Admins and Employees pages renders it that way. */}
              {lockRoleTo ? (
                <>
                  <Label>{t('users.role')}</Label>
                  <div className="flex h-8 items-center">
                    <Badge variant={roleBadgeVariant(lockRoleTo)}>{t(`nav.role.${lockRoleTo}`)}</Badge>
                  </div>
                </>
              ) : (
                <>
                  <Label htmlFor="person-role">{t('users.role')}</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                    <SelectTrigger id="person-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ALL_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {t(`nav.role.${r}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
          </div>

          {mode === 'edit' && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-sunken px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-medium">{t('users.active')}</p>
                <p className="text-2xs text-muted-foreground">{t('users.active_desc')}</p>
              </div>
              <Switch checked={active} onCheckedChange={setActive} aria-label={t('users.active')} />
            </div>
          )}

          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={!canSave} className="w-full">
              {saving
                ? t('users.saving')
                : mode === 'create'
                  ? t('users.add')
                  : t('common.save_changes')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ---------------------------------------------------------------------------
 * Row
 * ------------------------------------------------------------------------- */

export function PersonRow({
  person,
  self,
  onEdit,
  onChanged,
}: {
  person: ManagedUser
  self: boolean
  onEdit: (p: ManagedUser) => void
  onChanged: () => void
}) {
  const { t } = useI18n()

  const remove = useCallback(async () => {
    if (!window.confirm(t('users.delete_confirm', { name: person.name }))) return
    try {
      await api.deleteUser(person.id)
      toast.success(t('users.deleted'))
      onChanged()
    } catch (e) {
      toast.error(t('users.delete_failed', { error: (e as Error).message }))
    }
  }, [person.id, person.name, onChanged, t])

  return (
    <ListItem className="group/row relative flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-surface px-3 py-2.5 ring-1 ring-border transition-colors duration-150 hover:ring-border-strong">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-muted-foreground ring-1 ring-border-subtle">
          <UserRound className="size-3.5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium">{person.name}</p>
            {self && (
              <Badge variant="secondary" className="text-2xs">
                {t('users.you')}
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">{person.email}</p>
        </div>
      </div>

      <div className="order-last flex w-full min-w-0 items-center gap-2 sm:order-none sm:w-64 sm:flex-none">
        <TokenControl
          token={person.api_token ?? null}
          onRegenerate={async () => {
            const { api_token } = await api.regenerateToken(person.id)
            onChanged()
            return api_token
          }}
        />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Badge variant={roleBadgeVariant(person.role)}>{t(`nav.role.${person.role}`)}</Badge>
        <span className="inline-flex items-center gap-1.5 text-xs" title={t('users.active_desc')}>
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${person.active ? 'bg-success' : 'bg-muted-foreground/40'}`}
          />
          <span className={person.active ? 'text-foreground' : 'text-muted-foreground'}>
            {person.active ? t('users.active') : t('users.inactive')}
          </span>
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onEdit(person)}
          aria-label={`${t('users.edit_btn')}: ${person.name}`}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="destructive-ghost"
          size="icon-sm"
          onClick={() => void remove()}
          disabled={self}
          aria-label={`${t('users.delete_btn')}: ${person.name}`}
          title={self ? t('users.cant_delete_self') : t('users.delete_btn')}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </ListItem>
  )
}

/* ---------------------------------------------------------------------------
 * Search
 * ------------------------------------------------------------------------- */

export function usePeopleSearch(people: ManagedUser[]) {
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return people
    return people.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        p.role.toLowerCase().includes(q)
    )
  }, [people, search])
  return { search, setSearch, filtered }
}

/** Loads the user list. Shared by every directory so failures surface once. */
export function usePeopleDirectory(failureKey: string) {
  const { t } = useI18n()
  const [people, setPeople] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setPeople(await api.listUsers())
    } catch (e) {
      toast.error(t(failureKey, { error: (e as Error).message }))
    } finally {
      setLoading(false)
    }
  }, [failureKey, t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { people, loading, refresh }
}

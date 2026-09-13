import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { motion, useReducedMotion } from 'framer-motion'
import { KeyRound, Pencil, Plus, ShieldAlert, Trash2, UserRound } from 'lucide-react'

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
import { Switch } from '@/components/ui/switch'
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
import { api } from '@/lib/api'
import { useI18n } from '@/i18n/i18n'
import { TokenControl } from '@/components/TokenControl'
import type { Role, User } from '@/lib/types'

type ManagedUser = User & { active: boolean }

const ROLES: Role[] = ['admin', 'manager', 'receptionist']

function roleVariant(role: Role): 'default' | 'secondary' | 'outline' {
  if (role === 'admin') return 'default'
  if (role === 'manager') return 'secondary'
  return 'outline'
}

interface UserDialogProps {
  mode: 'create' | 'edit'
  user: ManagedUser | null
  onClose: () => void
  onSaved: () => void
}

function UserDialog({ mode, user, onClose, onSaved }: UserDialogProps) {
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>(user?.role ?? 'manager')
  const [active, setActive] = useState(user?.active ?? true)
  const [saving, setSaving] = useState(false)
  const { t } = useI18n()

  const canSave = name.trim().length > 0 && email.trim().length > 0 && !saving

  const submit = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      if (mode === 'create') {
        if (!password) {
          toast.error(t('users.password_required'))
          return
        }
        await api.createUser({ name: name.trim(), email: email.trim(), password, role })
        toast.success(t('users.created'))
      } else if (user) {
        await api.updateUser(user.id, {
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
      toast.error(t('users.save_failed', { error: (e as Error).message }))
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
          <DialogTitle>{mode === 'create' ? t('users.add') : t('users.edit_dialog')}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? t('users.add_desc')
              : t('users.edit_desc')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="user-name">{t('users.name')}</Label>
            <Input
              id="user-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('users.name_placeholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-email">{t('users.email')}</Label>
            <Input
              id="user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('users.email_placeholder')}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="user-password">
                {mode === 'create' ? t('users.password') : t('users.password_optional')}
              </Label>
              <Input
                id="user-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'create' ? t('app.password_placeholder') : t('users.password_leave')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('users.role')}</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {mode === 'edit' && (
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <p className="text-sm font-medium">{t('users.active')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('users.active_desc')}
                </p>
              </div>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!canSave}>
            {saving ? t('users.saving') : mode === 'create' ? t('users.add') : t('common.save_changes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function UserRow({ user, self, onEdit, onChanged }: {
  user: ManagedUser
  self: boolean
  onEdit: (u: ManagedUser) => void
  onChanged: () => void
}) {
  const { t } = useI18n()
  const remove = async () => {
    if (!window.confirm(t('users.delete_confirm', { name: user.name }))) return
    try {
      await api.deleteUser(user.id)
      toast.success(t('users.deleted'))
      onChanged()
    } catch (e) {
      toast.error(t('users.delete_failed', { error: (e as Error).message }))
    }
  }

  return (
    <motion.div variants={fadeUp}>
      <Card className="transition-all duration-200 ease-smooth hover:-translate-y-0.5 hover:shadow-lg hover:shadow-foreground/5">
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <UserRound className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium">{user.name}</p>
                {self && (
                  <Badge variant="secondary" className="text-[10px]">
                    {t('users.you')}
                  </Badge>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <div className="order-last flex w-full min-w-0 items-center gap-2 sm:order-none sm:w-auto sm:flex-1 lg:w-72 lg:flex-none">
            <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
            <TokenControl
              token={user.api_token ?? null}
              onRegenerate={async () => {
                const { api_token } = await api.regenerateToken(user.id)
                onChanged()
                return api_token
              }}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={roleVariant(user.role)} className="capitalize">
              {t(`nav.role.${user.role}`)}
            </Badge>
            <span className="inline-flex items-center gap-1.5 text-xs">
              <span
                className={`size-1.5 rounded-full ${user.active ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`}
              />
              <span className={user.active ? 'text-foreground' : 'text-muted-foreground'}>
                {user.active ? t('users.active') : t('users.inactive')}
              </span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
             <Button variant="ghost" size="icon-sm" onClick={() => onEdit(user)} aria-label={t('users.edit_btn')}>
               <Pencil className="size-4" />
             </Button>
             <Button
               variant="ghost"
               size="icon-sm"
               onClick={remove}
              disabled={self}
              aria-label={t('users.delete_btn')}
              title={self ? t('users.cant_delete_self') : undefined}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

export function UsersPage() {
  const { user } = useAuth()
  const { t } = useI18n()
  const isAdmin = user?.role === 'admin'
  const reduceMotion = useReducedMotion()

  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; user: ManagedUser } | null>(null)

  const refresh = useCallback(async () => {
    try {
      setUsers(await api.listUsers())
    } catch (e) {
      toast.error(t('users.load_failed', { error: (e as Error).message }))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md pt-16">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
              <ShieldAlert className="size-6 text-muted-foreground" />
            </div>
            <p className="text-base font-semibold">{t('users.no_access')}</p>
            <p className="text-sm text-muted-foreground">
              {t('users.no_access_desc')}
            </p>
            <Button variant="outline" asChild>
              <Link to="/">{t('users.back')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('users.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('users.desc')}
          </p>
        </div>
        <Button onClick={() => setDialog({ mode: 'create' })}>
          <Plus /> {t('users.add')}
        </Button>
      </header>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
              <KeyRound className="size-6 text-muted-foreground" />
            </div>
            <p className="text-base font-semibold">{t('users.no_team')}</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {t('users.no_team_desc')}
            </p>
            <Button onClick={() => setDialog({ mode: 'create' })}>
              <Plus /> {t('users.add_first')}
            </Button>
          </CardContent>
        </Card>
      ) : reduceMotion ? (
        <div className="space-y-3">
          {users.map((u) => (
            <UserRow key={u.id} user={u} self={u.id === user?.id} onEdit={(usr) => setDialog({ mode: 'edit', user: usr })} onChanged={refresh} />
          ))}
        </div>
      ) : (
        <Stagger className="space-y-3">
          {users.map((u) => (
            <UserRow key={u.id} user={u} self={u.id === user?.id} onEdit={(usr) => setDialog({ mode: 'edit', user: usr })} onChanged={refresh} />
          ))}
        </Stagger>
      )}

      {dialog && (
        <UserDialog
          key={dialog.mode === 'create' ? 'create' : `edit-${dialog.user.id}`}
          mode={dialog.mode}
          user={dialog.mode === 'edit' ? dialog.user : null}
          onClose={() => setDialog(null)}
          onSaved={refresh}
        />
      )}
    </div>
  )
}

export default UsersPage
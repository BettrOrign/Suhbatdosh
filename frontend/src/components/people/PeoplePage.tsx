import { useCallback, useEffect, useState } from 'react'
import { Copy, KeyRound, Link2, Loader2, Search, Trash2, UsersRound } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/EmptyState'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { Stagger } from '@/lib/motion'
import { useI18n } from '@/i18n/i18n'
import type { Invite, Role } from '@/lib/types'

import {
  ALL_ROLES,
  PersonDialog,
  PersonRow,
  roleBadgeVariant,
  usePeopleDirectory,
  usePeopleSearch,
} from './PersonDialog'

export interface PeoplePageConfig {
  /** i18n keys for the masthead. */
  titleKey: string
  eyebrowKey?: string
  descriptionKey: string
  /** Which roles this page lists. */
  roles: Role[]
  /** Force the created account to this role (admins page). */
  lockRoleTo?: Role
  emptyTitleKey: string
  emptyDescriptionKey: string
  addLabelKey: string
  addFirstLabelKey: string
  /** Key used in the toast when listing fails. */
  failureKey: string
  showSearch?: boolean
}

export function PeoplePage({
  config,
  currentUserId,
}: {
  config: PeoplePageConfig
  currentUserId: number | undefined
}) {
  const { t } = useI18n()
  const { people, loading, refresh } = usePeopleDirectory(config.failureKey)
  const scoped = people.filter((p) => config.roles.includes(p.role))
  const { search, setSearch, filtered } = usePeopleSearch(scoped)
  const [dialog, setDialog] = useState<
    { mode: 'create' } | { mode: 'edit'; person: (typeof scoped)[number] } | null
  >(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>(config.lockRoleTo ?? 'manager')
  const [inviting, setInviting] = useState(false)
  const [invites, setInvites] = useState<Invite[]>([])

  const loadInvites = useCallback(async () => {
    try {
      const all = await api.listInvites()
      setInvites(all.filter((inv) => !inv.accepted_at && config.roles.includes(inv.role)))
    } catch {
      /* ignore if non-admin */
    }
  }, [config.roles])

  useEffect(() => {
    void loadInvites()
  }, [loadInvites])

  const copyInviteUrl = async (token: string) => {
    const url = `${window.location.origin}/invite/${token}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('invites.copied'))
    } catch {
      toast.error(url)
    }
  }

  const createInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteEmail.trim() || inviting) return
    setInviting(true)
    try {
      const inv = await api.createInvite({
        email: inviteEmail.trim(),
        role: config.lockRoleTo ?? inviteRole,
      })
      toast.success(t('invites.created'))
      await copyInviteUrl(inv.token)
      setInviteEmail('')
      setInviteOpen(false)
      await loadInvites()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setInviting(false)
    }
  }

  const revokeInvite = async (id: number) => {
    try {
      await api.deleteInvite(id)
      toast.success(t('invites.revoked'))
      await loadInvites()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const searching = search.trim().length > 0

  return (
    <div>
      <PageHeader
        eyebrow={config.eyebrowKey ? t(config.eyebrowKey) : undefined}
        title={t(config.titleKey)}
        description={t(config.descriptionKey)}
        actions={
          <>
            {config.showSearch !== false && (
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('people.search_placeholder')}
                  aria-label={t('people.search_placeholder')}
                  className="w-52 pl-8"
                />
              </div>
            )}
            <Button type="button" variant="outline" onClick={() => setInviteOpen(true)}>
              <Link2 className="size-3.5" />
              {t('invites.btn')}
            </Button>
            <Button type="button" onClick={() => setDialog({ mode: 'create' })}>
              <KeyRound className="size-3.5" />
              {t(config.addLabelKey)}
            </Button>
          </>
        }
      />

      {invites.length > 0 && (
        <div className="mb-5 rounded-xl border border-primary/20 bg-surface p-4 shadow-e1">
          <p className="text-xs font-semibold">{t('invites.pending_title')}</p>
          <p className="text-2xs text-muted-foreground">{t('invites.pending_desc')}</p>
          <div className="mt-3 divide-y divide-border-subtle">
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2 text-xs first:pt-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{inv.email}</span>
                  <Badge variant={roleBadgeVariant(inv.role)}>{t(`nav.role.${inv.role}`)}</Badge>
                  <span className="text-2xs text-muted-foreground">
                    {t('invites.expires', { date: formatDate(inv.expires_at) })}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyInviteUrl(inv.token)}
                  >
                    <Copy className="size-3.5" />
                    {t('invites.copy_link')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void revokeInvite(inv.id)}
                    aria-label={t('invites.revoke')}
                    title={t('invites.revoke')}
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label={t('analytics.loading')}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-surface-sunken ring-1 ring-border">
            <UsersRound className="size-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">
              {searching ? t('clients.no_match') : t(config.emptyTitleKey)}
            </p>
            <p className="mx-auto max-w-sm text-xs text-muted-foreground">
              {searching ? t('clients.no_match_desc') : t(config.emptyDescriptionKey)}
            </p>
          </div>
          {!searching && (
            <Button size="sm" onClick={() => setDialog({ mode: 'create' })}>
              {t(config.addFirstLabelKey)}
            </Button>
          )}
        </div>
      ) : (
        <Stagger className="space-y-2">
          {filtered.map((p) => (
            <PersonRow
              key={p.id}
              person={p}
              self={p.id === currentUserId}
              onEdit={(person) => setDialog({ mode: 'edit', person })}
              onChanged={refresh}
            />
          ))}
        </Stagger>
      )}

      {dialog && (
        <PersonDialog
          key={dialog.mode === 'create' ? 'create' : `edit-${dialog.person.id}`}
          mode={dialog.mode}
          person={dialog.mode === 'edit' ? dialog.person : null}
          lockRoleTo={config.lockRoleTo}
          onClose={() => setDialog(null)}
          onSaved={refresh}
        />
      )}

      {inviteOpen && (
        <Dialog open onOpenChange={(o) => !inviting && setInviteOpen(o)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('invites.dialog_title')}</DialogTitle>
              <DialogDescription>{t('invites.dialog_desc')}</DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={createInvite}>
              <div className="space-y-1.5">
                <Label htmlFor="invite-member-email">{t('users.email')}</Label>
                <Input
                  id="invite-member-email"
                  type="email"
                  required
                  autoFocus
                  spellCheck={false}
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder={t('users.email_placeholder')}
                />
              </div>
              {!config.lockRoleTo && (
                <div className="space-y-1.5">
                  <Label htmlFor="invite-member-role">{t('users.role')}</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
                    <SelectTrigger id="invite-member-role" className="w-full">
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
                </div>
              )}
              <DialogFooter>
                <Button type="submit" disabled={inviting || !inviteEmail.trim()} className="w-full">
                  {inviting && <Loader2 className="size-3.5 animate-spin" />}
                  {inviting ? t('invites.creating') : t('invites.create_btn')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

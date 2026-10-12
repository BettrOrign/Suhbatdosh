import { useState } from 'react'
import { KeyRound, Search, UsersRound } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/EmptyState'
import { Stagger } from '@/lib/motion'
import { useI18n } from '@/i18n/i18n'
import type { Role } from '@/lib/types'

import {
  PersonDialog,
  PersonRow,
  usePeopleDirectory,
  usePeopleSearch,
} from './PersonDialog'

export interface PeoplePageConfig {
  /** i18n keys for the masthead. */
  titleKey: string
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

  const searching = search.trim().length > 0

  return (
    <div>
      <PageHeader
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
            <Button onClick={() => setDialog({ mode: 'create' })}>
              <KeyRound className="size-3.5" />
              {t(config.addLabelKey)}
            </Button>
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
    </div>
  )
}

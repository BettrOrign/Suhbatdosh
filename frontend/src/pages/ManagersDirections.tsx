import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { motion, useReducedMotion } from 'framer-motion'
import { UserRound, TrendingUp, Headphones, Megaphone, ShieldCheck } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Stagger, fadeUp } from '@/lib/motion'
import { useI18n } from '@/i18n/i18n'
import { api } from '@/lib/api'
import type { User as ManagedUser } from '@/lib/types'

const directions = [
  { nameKey: 'managers.direction_sales', icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30' },
  { nameKey: 'managers.direction_support', icon: Headphones, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-950/30' },
  { nameKey: 'managers.direction_marketing', icon: Megaphone, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950/30' },
  { nameKey: 'managers.direction_masul', icon: ShieldCheck, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950/30' },
]

export function ManagersDirectionsPage() {
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)

  const loadUsers = useCallback(async () => {
    try {
      const all = await api.listUsers()
      setUsers(all.filter((u) => u.role === 'yonalish'))
    } catch (e) {
      toast.error(t('managers.load_failed', { error: (e as Error).message }))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t('managers.directions_section')}</h1>
        <p className="text-sm text-muted-foreground">{t('managers.directions_section_desc')}</p>
      </header>

      {/* Direction cards */}
      <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {directions.map((dir) => {
          const Icon = dir.icon
          return (
            <Card key={dir.nameKey} className="hover:shadow-md transition-shadow">
              <CardContent className="flex items-center gap-4 p-5">
                <div className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${dir.bg}`}>
                  <Icon className={`size-6 ${dir.color}`} />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold">{t(dir.nameKey)}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Yonalish masullari list */}
      <h2 className="mb-4 text-lg font-semibold">{t('managers.directions_section')}</h2>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : users.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t('managers.no_managers')}
          </CardContent>
        </Card>
      ) : reduceMotion ? (
        <div className="space-y-2">
          {users.map((u) => (
            <Card key={u.id}>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <UserRound className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{u.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Stagger className="space-y-2">
          {users.map((u) => (
            <motion.div key={u.id} variants={fadeUp}>
              <Card>
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <UserRound className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{u.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </Stagger>
      )}
    </div>
  )
}

export default ManagersDirectionsPage

import { useAuth } from '@/lib/auth'
import { useI18n } from '@/i18n/i18n'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Crown, UserRound } from 'lucide-react'

export function ManagersAdminPage() {
  const { user } = useAuth()
  const { t } = useI18n()

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t('managers.admin_section')}</h1>
        <p className="text-sm text-muted-foreground">{t('managers.admin_section_desc')}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-muted">
              <UserRound className="size-7 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold">{user?.name}</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
              <Badge variant="default" className="mt-2">{t('nav.role.admin')}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-amber-50">
              <Crown className="size-7 text-amber-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('managers.total_system_calls')}</p>
              <p className="text-3xl font-bold">—</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default ManagersAdminPage

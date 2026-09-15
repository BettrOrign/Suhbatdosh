import { useI18n } from '@/i18n/i18n'
import { Card, CardContent } from '@/components/ui/card'
import { TrendingUp, Headphones, Megaphone, Users } from 'lucide-react'

const directions = [
  { nameKey: 'managers.direction_sales', icon: TrendingUp, count: 12, color: 'text-blue-600' },
  { nameKey: 'managers.direction_support', icon: Headphones, count: 8, color: 'text-green-600' },
  { nameKey: 'managers.direction_marketing', icon: Megaphone, count: 6, color: 'text-purple-600' },
  { nameKey: 'managers.direction_hr', icon: Users, count: 4, color: 'text-orange-600' },
]

export function ManagersDirectionsPage() {
  const { t } = useI18n()

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t('managers.directions_section')}</h1>
        <p className="text-sm text-muted-foreground">{t('managers.directions_section_desc')}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {directions.map((dir) => {
          const Icon = dir.icon
          return (
            <Card key={dir.nameKey}>
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted">
                  <Icon className={`size-6 ${dir.color}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{t(dir.nameKey)}</p>
                  <p className="text-sm text-muted-foreground">{dir.count} {t('managers.responsible_managers')}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

export default ManagersDirectionsPage

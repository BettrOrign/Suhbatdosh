import { useState } from 'react'
import { useI18n } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { TrendingUp, Headphones, Megaphone, Users } from 'lucide-react'

const directions = [
  { nameKey: 'managers.direction_sales', icon: TrendingUp, count: 12, color: 'text-blue-600', bg: 'bg-blue-50' },
  { nameKey: 'managers.direction_support', icon: Headphones, count: 8, color: 'text-green-600', bg: 'bg-green-50' },
  { nameKey: 'managers.direction_marketing', icon: Megaphone, count: 6, color: 'text-purple-600', bg: 'bg-purple-50' },
  { nameKey: 'managers.direction_hr', icon: Users, count: 4, color: 'text-orange-600', bg: 'bg-orange-50' },
]

export function ManagersDirectionsPage() {
  const { t } = useI18n()
  const [selectedDir, setSelectedDir] = useState<string | null>(null)

  const filtered = selectedDir ? directions.filter((d) => d.nameKey === selectedDir) : directions

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t('managers.directions_section')}</h1>
        <p className="text-sm text-muted-foreground">{t('managers.directions_section_desc')}</p>
      </header>

      <div className="mb-4 flex gap-2 flex-wrap">
        <Button variant={selectedDir === null ? 'default' : 'outline'} onClick={() => setSelectedDir(null)}>
          Barchasi
        </Button>
        {directions.map((d) => (
          <Button
            key={d.nameKey}
            variant={selectedDir === d.nameKey ? 'default' : 'outline'}
            onClick={() => setSelectedDir(d.nameKey)}
            className={selectedDir === d.nameKey ? '' : ''}
          >
            {t(d.nameKey)}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {filtered.map((dir) => {
          const Icon = dir.icon
          return (
            <Card key={dir.nameKey} className="hover:shadow-lg transition-shadow">
              <CardContent className="flex items-center gap-4 p-6">
                <div className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${dir.bg}`}>
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

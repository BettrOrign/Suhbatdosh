import { useMemo } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/i18n/i18n'
import type { Call } from '@/lib/types'

const COLORS = ['var(--color-chart-1)', 'var(--color-chart-2)']

export function CallTypePieChart({ calls }: { calls: Call[] }) {
  const { t } = useI18n()

  const data = useMemo(() => {
    const manager = calls.filter((c) => c.call_type === 'manager').length
    const receptionist = calls.filter((c) => c.call_type === 'receptionist').length
    return [
      { name: t('upload.call_type.manager'), value: manager },
      { name: t('upload.call_type.receptionist'), value: receptionist },
    ].filter((d) => d.value > 0)
  }, [calls, t])

  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('dashboard.chart.call_types')}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {total > 0 ? (
          <div className="flex items-center gap-4">
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={60}
                  paddingAngle={4}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {data.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.85} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-card)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {data.map((d, i) => (
                <div key={d.name} className="flex items-center gap-2 text-sm">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: COLORS[i % COLORS.length] }}
                  />
                  <span className="text-muted-foreground">{d.name}</span>
                  <span className="font-semibold tabular-nums">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex h-[140px] items-center justify-center text-sm text-muted-foreground">
            {t('dashboard.chart.no_data')}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

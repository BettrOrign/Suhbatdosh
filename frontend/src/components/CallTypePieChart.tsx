import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/i18n/i18n'
import type { Call } from '@/lib/types'

const COLORS = ['var(--color-chart-1)', 'var(--color-chart-6)']

/**
 * Manager vs receptionist split, rendered as a donut with an explicit legend
 * rather than a floating pie with a recharts tooltip — the numbers are the
 * point and they should be readable without hovering.
 */
export function CallTypePieChart({ calls }: { calls: Call[] }) {
  const { t } = useI18n()

  const data = useMemo(() => {
    const count = (type: Call['call_type']) => calls.filter((c) => c.call_type === type).length
    return [
      { name: t('upload.call_type.manager'), value: count('manager') },
      { name: t('upload.call_type.receptionist'), value: count('receptionist') },
    ].filter((d) => d.value > 0)
  }, [calls, t])

  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <Card size="sm" className="h-full">
      <CardHeader className="pb-1">
        <CardTitle>{t('dashboard.chart.call_types')}</CardTitle>
      </CardHeader>
      <CardContent>
        {total > 0 ? (
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <ResponsiveContainer width={110} height={110}>
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={34}
                    outerRadius={52}
                    paddingAngle={2}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {data.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="data-value text-lg leading-none">{total}</span>
                <span className="text-2xs text-muted-foreground">{t('analytics.calls')}</span>
              </div>
            </div>
            <ul className="min-w-0 flex-1 space-y-2">
              {data.map((d, i) => (
                <li key={d.name} className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: COLORS[i % COLORS.length] }}
                    />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{d.name}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{d.value}</span>
                    <span className="w-9 shrink-0 text-right text-2xs tabular-nums text-muted-foreground">
                      {Math.round((d.value / total) * 100)}%
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex h-[190px] items-center justify-center text-xs text-muted-foreground">
            {t('dashboard.chart.no_data')}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

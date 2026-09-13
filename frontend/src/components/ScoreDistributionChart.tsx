import { useMemo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/i18n/i18n'
import type { Call } from '@/lib/types'

const BUCKETS = [
  { range: '0–20', min: 0, max: 20, color: 'var(--color-score-bad)' },
  { range: '20–40', min: 20, max: 40, color: 'var(--color-score-bad)' },
  { range: '40–60', min: 40, max: 60, color: 'var(--color-score-warn)' },
  { range: '60–80', min: 60, max: 80, color: 'var(--color-score-warn)' },
  { range: '80–100', min: 80, max: 101, color: 'var(--color-score-good)' },
]

export function ScoreDistributionChart({ calls }: { calls: Call[] }) {
  const { t } = useI18n()

  const data = useMemo(() => {
    const done = calls.filter(
      (c) => c.status === 'done' && typeof c.analysis?.scorecard?.overall === 'number',
    )
    return BUCKETS.map((b) => ({
      name: b.range,
      count: done.filter(
        (c) => c.analysis.scorecard!.overall >= b.min && c.analysis.scorecard!.overall < b.max,
      ).length,
      color: b.color,
    }))
  }, [calls])

  const hasData = data.some((d) => d.count > 0)

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('dashboard.chart.score_dist')}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {hasData ? (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: 'var(--color-muted)', opacity: 0.5 }}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-card)',
                }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={40}>
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.color} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
            {t('dashboard.chart.no_data')}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

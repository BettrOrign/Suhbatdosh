import { useMemo } from 'react'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/i18n/i18n'
import { scoreColorVar } from '@/lib/format'
import { overallScore, type Call } from '@/lib/types'

/**
 * Score histogram. Band colours come from the same `scoreBand()` used by
 * every other score surface, so a call that reads "good" here also reads
 * "good" on its card, in the table, and on CallDetail.
 */
const BUCKETS = [
  { range: '0–19', min: 0, max: 20 },
  { range: '20–39', min: 20, max: 40 },
  { range: '40–59', min: 40, max: 60 },
  { range: '60–79', min: 60, max: 80 },
  { range: '80–100', min: 80, max: 101 },
]

export function ScoreDistributionChart({ calls }: { calls: Call[] }) {
  const { t } = useI18n()

  const data = useMemo(() => {
    const scores = calls
      .filter((c) => c.status === 'done')
      .map((c) => overallScore(c.analysis))
      .filter((s): s is number => s != null)
    return BUCKETS.map((b) => ({
      name: b.range,
      count: scores.filter((s) => s >= b.min && s < b.max).length,
      // Representative low end of the bucket, so the histogram reads as the same
      // red -> amber -> green bands used everywhere else.
      color: scoreColorVar(b.min + 5),
    }))
  }, [calls])

  const hasData = data.some((d) => d.count > 0)

  return (
    <Card size="sm" className="h-full">
      <CardHeader className="pb-1">
        <CardTitle>{t('dashboard.chart.score_dist')}</CardTitle>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <XAxis dataKey="name" axisLine={false} tickLine={false} dy={4} />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={28} />
              <Tooltip
                cursor={{ fill: 'var(--color-surface-sunken)' }}
                contentStyle={{
                  fontSize: 11,
                  borderRadius: 6,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface-elevated)',
                }}
              />
              <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={44}>
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.color} fillOpacity={0.55} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-[190px] items-center justify-center text-xs text-muted-foreground">
            {t('dashboard.chart.no_data')}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

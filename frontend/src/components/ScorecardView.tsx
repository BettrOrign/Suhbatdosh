import { motion, useReducedMotion } from 'framer-motion'
import {
  MessageSquare,
  Shield,
  Sparkles,
  Target,
  ThumbsUp,
  TrendingUp,
  Zap,
  type LucideIcon,
} from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/i18n/i18n'
import { fadeUp } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { scoreColor, scoreColorVar } from '@/lib/format'
import type { Scorecard } from '@/lib/types'

/**
 * The rubric breakdown. Each dimension gets one icon and one thin bar.
 * The old version gave every dimension a saturated gradient tile, which made
 * the row read as a marketing card rather than a measurement.
 */
const METRICS: { key: keyof Scorecard; tkey: string; icon: LucideIcon }[] = [
  { key: 'opening', tkey: 'call.metric.opening', icon: Sparkles },
  { key: 'discovery', tkey: 'call.metric.discovery', icon: MessageSquare },
  { key: 'objection_handling', tkey: 'call.metric.objections', icon: Shield },
  { key: 'value_prop', tkey: 'call.metric.value_prop', icon: Zap },
  { key: 'closing', tkey: 'call.metric.closing', icon: Target },
  { key: 'rapport', tkey: 'call.metric.rapport', icon: ThumbsUp },
  { key: 'talk_ratio', tkey: 'call.metric.talk_ratio', icon: TrendingUp },
]

export function ScorecardView({ scorecard }: { scorecard: Scorecard }) {
  const { t } = useI18n()
  const reduced = useReducedMotion()

  return (
    <Card>
      <CardHeader className="border-b border-border-subtle pb-2.5">
        <CardTitle>{t('call.metrics')}</CardTitle>
      </CardHeader>
      <CardContent className="pt-3">
        <ul className="grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {METRICS.map(({ key, tkey, icon: Icon }) => {
            const value = scorecard[key] ?? 0
            const color = scoreColorVar(value)
            return (
              <motion.li
                key={key}
                variants={fadeUp}
                initial="hidden"
                animate="visible"
                className="space-y-1.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon aria-hidden="true" className="size-3 shrink-0" />
                    <span className="truncate">{t(tkey)}</span>
                  </span>
                  <span className={cn(scoreColor(value), 'text-sm font-semibold tabular-nums')}>
                    {value}
                  </span>
                </div>
                <div
                  className="h-1 w-full overflow-hidden rounded-full bg-surface-sunken"
                  role="meter"
                  aria-valuenow={value}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={t(tkey)}
                >
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: color }}
                    initial={reduced ? false : { width: 0 }}
                    animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
              </motion.li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
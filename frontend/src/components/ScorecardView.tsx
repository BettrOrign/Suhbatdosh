import { motion } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/i18n/i18n'
import type { Scorecard } from '@/lib/types'
import {
  Sparkles,
  MessageSquare,
  Shield,
  Zap,
  Target,
  ThumbsUp,
  TrendingUp,
} from 'lucide-react'

const METRICS: { key: keyof Scorecard; tkey: string; icon: typeof Target; gradient: string }[] = [
  { key: 'opening', tkey: 'call.metric.opening', icon: Sparkles, gradient: 'from-amber-400 to-orange-500' },
  { key: 'discovery', tkey: 'call.metric.discovery', icon: MessageSquare, gradient: 'from-blue-400 to-cyan-500' },
  { key: 'objection_handling', tkey: 'call.metric.objections', icon: Shield, gradient: 'from-purple-400 to-violet-500' },
  { key: 'value_prop', tkey: 'call.metric.value_prop', icon: Zap, gradient: 'from-yellow-400 to-amber-500' },
  { key: 'closing', tkey: 'call.metric.closing', icon: Target, gradient: 'from-emerald-400 to-green-500' },
  { key: 'rapport', tkey: 'call.metric.rapport', icon: ThumbsUp, gradient: 'from-pink-400 to-rose-500' },
  { key: 'talk_ratio', tkey: 'call.metric.talk_ratio', icon: TrendingUp, gradient: 'from-indigo-400 to-blue-500' },
]

const COLOR = (v: number) =>
  v >= 70 ? 'var(--color-score-good)' : v >= 40 ? 'var(--color-score-warn)' : 'var(--color-score-bad)'

export function ScorecardView({ scorecard }: { scorecard: Scorecard }) {
  const { t } = useI18n()

  return (
    <Card className="overflow-hidden border-border/70 bg-card shadow-xs">
      <CardHeader className="pb-3 border-b border-border/50">
        <CardTitle className="text-base font-bold text-foreground">{t('call.metrics')}</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {METRICS.map(({ key, tkey, icon: Icon, gradient }, i) => {
            const v = scorecard[key] ?? 0
            return (
              <motion.div
                key={key}
                className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-all hover:shadow-md"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
              >
                {/* Subtle gradient accent */}
                <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-[0.03] group-hover:opacity-[0.07] transition-opacity`} />

                <div className="relative flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`flex size-9 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} shadow-sm`}>
                      <Icon className="size-4 text-white" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">{t(tkey)}</p>
                      <p className="text-xl font-bold" style={{ color: COLOR(v) }}>
                        {v}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: COLOR(v) }}
                    initial={{ width: 0 }}
                    animate={{ width: `${v}%` }}
                    transition={{ delay: 0.3 + i * 0.05, duration: 0.8, ease: 'easeOut' }}
                  />
                </div>
              </motion.div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

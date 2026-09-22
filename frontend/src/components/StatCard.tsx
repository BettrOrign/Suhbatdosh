import { type ComponentType } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { AnimatedNumber } from '@/components/AnimatedNumber'

interface StatCardProps {
  icon: ComponentType<{ className?: string }>
  label: string
  value: number
  hint?: string
  valueClass?: string
  iconGradient?: string
  variant?: 'solid' | 'outline' | 'gradient' | 'accent'
  decimals?: number
  progress?: number | null
  progressClass?: string
}

const VARIANT_STYLES = {
  solid: 'bg-primary/10 text-primary border border-primary/20',
  outline: 'bg-background border border-border text-foreground',
  gradient: 'bg-gradient-to-br from-indigo-500/15 to-violet-500/15 text-primary border border-primary/20',
  accent: 'bg-muted text-foreground border border-border/60',
}

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  valueClass,
  variant = 'solid',
  decimals = 0,
  progress,
  progressClass,
}: StatCardProps) {
  const reduceMotion = useReducedMotion()
  const style = VARIANT_STYLES[variant]

  return (
    <motion.div
      whileHover={reduceMotion ? undefined : { y: -2 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="h-full"
    >
      <Card className="h-full overflow-hidden border-border/70 bg-card shadow-xs transition-all duration-200 hover:shadow-md hover:border-border">
        <CardContent className="flex items-center gap-3.5 p-4">
          <div className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${style} shadow-xs`}>
            <Icon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className={`text-2xl font-bold leading-tight tabular-nums tracking-tight mt-0.5 ${valueClass ?? 'text-foreground'}`}>
              <AnimatedNumber value={value} decimals={decimals} />
            </p>
            {hint && <p className="truncate text-xs text-muted-foreground mt-0.5">{hint}</p>}
            {progress != null && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <motion.div
                  className={`h-full rounded-full ${progressClass ?? 'bg-primary'}`}
                  initial={reduceMotion ? false : { width: 0 }}
                  animate={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
import { useMemo, type ComponentType } from 'react'
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
  solid: 'bg-primary text-primary-foreground',
  outline: 'bg-background border-2 border-primary text-primary',
  gradient: 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white',
  accent: 'bg-muted text-muted-foreground',
}

const ICON_SHAPES = ['rounded-xl', 'rounded-2xl', 'rounded-full']

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
  const shape = useMemo(() => ICON_SHAPES[Math.floor(Math.random() * ICON_SHAPES.length)], [])

  return (
    <motion.div
      whileHover={reduceMotion ? undefined : { y: -3, scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="h-full"
    >
      <Card className={`h-full overflow-hidden border-border/50 transition-all duration-300 hover:shadow-lg ${
        variant === 'gradient' ? 'hover:shadow-indigo-500/20' :
        'hover:shadow-indigo-500/10'
      }`}>
        <CardContent className={`flex items-center gap-3 p-4 ${
          variant === 'gradient' ? 'bg-gradient-to-br from-indigo-500/5 to-purple-500/5' :
          ''
        }`}>
          <div className={`flex size-11 shrink-0 items-center justify-center ${shape} ${style} shadow-sm`}>
            <Icon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className={`text-2xl font-bold leading-tight tabular-nums ${valueClass ?? 'text-foreground'}`}>
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
import type { ComponentType } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

import { Card, CardContent } from '@/components/ui/card'
import { AnimatedNumber } from '@/components/AnimatedNumber'
import { cn } from '@/lib/utils'

export interface StatCardProps {
  icon: ComponentType<{ className?: string }>
  label: string
  value: number
  hint?: string
  valueClass?: string
  /** Optional trailing element, e.g. a delta chip. */
  trailing?: React.ReactNode
  decimals?: number
  progress?: number | null
  progressClass?: string
}

/**
 * The KPI tile. Restraint is the point: a small icon well, an uppercase
 * micro-label, one big tabular number. The old variants (solid / outline /
 * gradient / accent) all differed only in background colour and made the row
 * look arbitrary.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  valueClass,
  trailing,
  decimals = 0,
  progress,
  progressClass,
}: StatCardProps) {
  const reduced = useReducedMotion()

  return (
    <motion.div
      whileHover={reduced ? undefined : { y: -2 }}
      transition={{ type: 'spring', stiffness: 400, damping: 26, mass: 0.7 }}
      className="h-full"
    >
      <Card size="sm" className="h-full transition-shadow duration-150 hover:shadow-e2">
        <CardContent className="flex items-start gap-3 p-3.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-muted-foreground ring-1 ring-border-subtle">
            <Icon aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="eyebrow truncate">{label}</p>
              {trailing}
            </div>
            <p
              className={cn(
                'mt-1 text-2xl leading-none font-semibold tracking-[-0.02em] tabular-nums',
                valueClass ?? 'text-foreground'
              )}
            >
              <AnimatedNumber value={value} decimals={decimals} />
            </p>
            {hint && <p className="mt-1 truncate text-2xs text-muted-foreground">{hint}</p>}
            {progress != null && (
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-sunken">
                <motion.div
                  className={cn('h-full rounded-full', progressClass ?? 'bg-primary')}
                  initial={reduced ? false : { width: 0 }}
                  animate={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                  transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

/** Small `+12 / -4` chip used for day-over-day deltas. */
export function DeltaChip({
  delta,
  className,
  invert = false,
}: {
  delta: number | string | null
  className?: string
  /**
   * For metrics where *down* is the good direction (average call duration):
   * a rise is a regression and must not be painted green.
   */
  invert?: boolean
}) {
  if (delta == null || delta === '' || delta === '0') return null
  const numeric = typeof delta === 'number' ? delta : Number.parseFloat(delta)
  // Zero means "unchanged" for every metric. Deciding it with the string `0`
  // comparison only caught the number 0, so a formatted delta like "0s" fell
  // through to `numeric > 0` and rendered a red regression.
  if (!Number.isFinite(numeric) || numeric === 0) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full bg-surface-sunken px-1.5 py-px text-2xs font-medium tabular-nums text-muted-foreground ring-1 ring-border-subtle ring-inset',
          className
        )}
      >
        {delta}
      </span>
    )
  }
  const up = (numeric > 0) !== invert
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-1.5 py-px text-2xs font-semibold tabular-nums ring-1 ring-inset',
        up
          ? 'bg-success-soft text-success-soft-foreground ring-success/25'
          : 'bg-destructive-soft text-destructive-soft-foreground ring-destructive/25',
        className
      )}
    >
      {typeof delta === 'number' && up ? `+${delta}` : delta}
    </span>
  )
}

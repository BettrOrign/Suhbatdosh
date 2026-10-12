import { motion, useReducedMotion } from 'framer-motion'

import { cn } from '@/lib/utils'
import { scoreBand, scoreBgVar, scoreColorVar } from '@/lib/format'

/**
 * The score ring is the single most-repeated visual in the product. It used
 * to be reimplemented twice (Calls.tsx and CallDetail.tsx) with its own
 * hardcoded hex thresholds. One component, one source of truth.
 */
export function ScoreRing({
  score,
  size = 56,
  stroke = 5,
  delay = 0,
  className,
}: {
  score: number
  size?: number
  stroke?: number
  delay?: number
  className?: string
}) {
  const reduced = useReducedMotion()
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, score))
  const color = scoreColorVar(score)
  const track = scoreBgVar(score)

  return (
    <div
      className={cn('relative shrink-0', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${score} / 100`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={track}
          strokeWidth={stroke}
        />
        {!reduced && (
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference * (1 - clamped / 100) }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay }}
          />
        )}
        {reduced && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - clamped / 100)}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="font-semibold tabular-nums tracking-tight"
          style={{ fontSize: size / 3.4, color }}
        >
          {score}
        </span>
      </div>
    </div>
  )
}

/** Compact `NN/100` chip coloured by band. Replaces the old inline ternaries. */
export function ScoreChip({ score, className }: { score: number | null | undefined; className?: string }) {
  const band = scoreBand(score)
  if (score == null) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <span
      data-band={band}
      className={cn(
        'inline-flex items-center rounded-full px-1.5 py-0.5 text-2xs font-semibold tabular-nums',
        'data-[band=good]:bg-success-soft data-[band=good]:text-success-soft-foreground',
        'data-[band=warn]:bg-warning-soft data-[band=warn]:text-warning-soft-foreground',
        'data-[band=bad]:bg-destructive-soft data-[band=bad]:text-destructive-soft-foreground',
        className
      )}
    >
      {score}
    </span>
  )
}

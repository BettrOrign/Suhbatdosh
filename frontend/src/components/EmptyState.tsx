import type { ComponentType, ReactNode } from 'react'
import { motion } from 'framer-motion'

import { SPRING, fadeUp } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Every async surface in this app needs an empty state, and there was no
 * shared one — each page reinvented a slightly different version. This is
 * that version.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface text-center',
        compact ? 'px-6 py-10' : 'px-6 py-16',
        className
      )}
    >
      {Icon && (
        <div className="flex size-10 items-center justify-center rounded-lg bg-surface-sunken ring-1 ring-border">
          <Icon className="size-5 text-muted-foreground" />
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-semibold tracking-[-0.01em]">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </motion.div>
  )
}

/** The standard page masthead: h1 + description, with right-aligned actions. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string
  description?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <motion.header
      initial="hidden"
      animate="visible"
      variants={{
        hidden: { opacity: 0, y: -6 },
        visible: { opacity: 1, y: 0, transition: SPRING.standard },
      }}
      className={cn('mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3', className)}
    >
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-balance">{title}</h1>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </motion.header>
  )
}

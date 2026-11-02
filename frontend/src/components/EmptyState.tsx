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
        <div className="icon-well size-10 rounded-lg">
          <Icon className="size-5" />
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

/** The standard page masthead: eyebrow + display title + lede, actions right. */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
}: {
  title: string
  eyebrow?: string
  description?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <motion.header
      initial="hidden"
      animate="visible"
      variants={{
        hidden: { opacity: 0, y: -8 },
        visible: { opacity: 1, y: 0, transition: SPRING.standard },
      }}
      className={cn('mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4', className)}
    >
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}
        <h1 className="page-title text-balance">{title}</h1>
        {description && <p className="page-lede mt-2.5">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </motion.header>
  )
}

import { motion, useReducedMotion, type Transition, type Variants } from 'framer-motion'
import type { ComponentProps, ReactNode } from 'react'

/**
 * Motion is a token, not a magic number. Every transition in the app comes
 * from this file so timing stays coherent across 9 pages.
 *
 * Spring configs mirror the intent of the `--ease-*` / `--duration-*` CSS
 * tokens in `index.css`. Anything that needs an eased (non-spring) tween
 * should use the CSS token via a Tailwind `ease-*` class, not a literal.
 */
/** Spring configs by intent. Snappy = UI feedback, soft = layout, gentle = large. */
export const SPRING = {
  snappy: { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 },
  standard: { type: 'spring', stiffness: 380, damping: 32, mass: 0.8 },
  soft: { type: 'spring', stiffness: 260, damping: 30, mass: 1 },
  gentle: { type: 'spring', stiffness: 190, damping: 26, mass: 1 },
} as const satisfies Record<string, Transition>

/** Resolve the right spring for the current motion preference. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: SPRING.standard },
}

/** List/grid reveal. Children must be motion elements using these variants. */
export const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.035, delayChildren: 0.02 } },
}

interface RevealProps extends ComponentProps<typeof motion.div> {
  children: ReactNode
}

/**
 * Fades + slides content up on first scroll into view.
 * A no-op when the user has asked for reduced motion.
 */
export function Reveal({ children, ...props }: RevealProps) {
  const reduced = useReducedMotion()
  if (reduced) {
    const { variants: _v, initial: _i, whileInView: _w, viewport: _vp, ...rest } = props
    return <div {...(rest as ComponentProps<'div'>)}>{children}</div>
  }
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-32px' }}
      {...props}
    >
      {children}
    </motion.div>
  )
}

interface StaggerProps extends ComponentProps<typeof motion.div> {
  children: ReactNode
}

/** Container that staggers its motion children. Collapses to a plain div under
 *  reduced motion so no layout thrash happens at all. */
export function Stagger({ children, ...props }: StaggerProps) {
  const reduced = useReducedMotion()
  if (reduced) {
    const { variants: _variants, initial: _initial, animate: _animate, ...rest } = props
    return <div {...(rest as ComponentProps<'div'>)}>{children}</div>
  }
  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" {...props}>
      {children}
    </motion.div>
  )
}

/**
 * A single list row that animates in on mount / reorder. Use with `Stagger`
 * as the parent, or standalone for a re-keyed list.
 */
export function ListItem({ children, ...props }: ComponentProps<typeof motion.div>) {
  return <motion.div variants={fadeUp} {...props}>{children}</motion.div>
}

import { useEffect, useRef, useState } from 'react'
import { animate, useReducedMotion } from 'framer-motion'

interface AnimatedNumberProps {
  value: number
  duration?: number
  className?: string
  decimals?: number
}

export function AnimatedNumber({ value, duration = 0.7, className, decimals = 0 }: AnimatedNumberProps) {
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(reduced ? value : 0)
  // Read the previous value through a ref so the animation never restarts just
  // because the component re-rendered (the old `display` dep caused that).
  const fromRef = useRef(reduced ? value : 0)
  // `display` in the cleanup closure is the value from the render the effect
  // last ran on, not the frame we ended on: `setDisplay` re-renders without
  // re-running the effect. Reading it there restarted the count from 0 on
  // every 3s poll. This ref is written on every frame instead.
  const shownRef = useRef(reduced ? value : 0)

  useEffect(() => {
    if (reduced) {
      fromRef.current = value
      shownRef.current = value
      setDisplay(value)
      return
    }
    const controls = animate(fromRef.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        shownRef.current = v
        setDisplay(v)
      },
      onComplete: () => {
        fromRef.current = value
        shownRef.current = value
      },
    })
    return () => {
      controls.stop()
      // Resume from wherever the animation actually got to.
      fromRef.current = shownRef.current
    }
  }, [value, duration, reduced])

  return (
    <span className={className} data-numeric>
      {decimals > 0 ? display.toFixed(decimals) : Math.round(display)}
    </span>
  )
}

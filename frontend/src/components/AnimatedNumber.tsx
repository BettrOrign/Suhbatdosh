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

  useEffect(() => {
    if (reduced) {
      fromRef.current = value
      setDisplay(value)
      return
    }
    const controls = animate(fromRef.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: setDisplay,
      onComplete: () => {
        fromRef.current = value
      },
    })
    return () => {
      controls.stop()
      fromRef.current = display
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, reduced])

  return (
    <span className={className} data-numeric>
      {decimals > 0 ? display.toFixed(decimals) : Math.round(display)}
    </span>
  )
}

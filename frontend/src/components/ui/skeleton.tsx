import { cn } from "@/lib/utils"

/**
 * Skeletons use the well token and a sweeping highlight rather than a pulse,
 * so a list of them reads as one surface rather than a flashing grid.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "relative overflow-hidden rounded-md bg-surface-sunken",
        "after:absolute after:inset-0 after:animate-shimmer after:bg-[linear-gradient(90deg,transparent,color-mix(in_oklch,var(--foreground)_6%,transparent),transparent)] after:bg-[length:200%_100%]",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }

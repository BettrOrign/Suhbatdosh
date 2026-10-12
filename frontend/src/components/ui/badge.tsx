import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Badges are labels, not buttons. They are low-contrast by default and only
 * reach for colour when the colour carries meaning (status, score band).
 */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2 text-2xs font-medium whitespace-nowrap transition-colors duration-150 ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary-soft text-primary-soft-foreground ring-1 ring-primary/20 ring-inset",
        secondary: "bg-surface-sunken text-muted-foreground ring-1 ring-border-subtle ring-inset",
        success: "bg-success-soft text-success-soft-foreground ring-1 ring-success/25 ring-inset",
        warning: "bg-warning-soft text-warning-soft-foreground ring-1 ring-warning/25 ring-inset",
        destructive: "bg-destructive-soft text-destructive-soft-foreground ring-1 ring-destructive/25 ring-inset",
        outline: "bg-transparent text-foreground ring-1 ring-border",
        ghost: "bg-transparent text-muted-foreground hover:bg-surface-hover",
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  }
)

function Badge({
  className,
  variant = "secondary",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }

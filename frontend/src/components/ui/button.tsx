import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Buttons carry two signals: fill (primary/secondary/outline) and size.
 * Depth is restrained — a hairline ring plus a 1px inset highlight on fills,
 * never a coloured drop shadow.
 */
const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md",
    "text-sm font-medium whitespace-nowrap select-none outline-none",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-standard",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "active:not-aria-[haspopup]:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
    "aria-invalid:border-destructive aria-invalid:outline-destructive",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default: [
          "bg-primary text-primary-foreground ring-1 ring-primary",
          "shadow-[inset_0_1px_0_0_color-mix(in_oklch,white_18%,transparent),var(--shadow-e1)]",
          "hover:bg-primary-hover",
        ],
        outline:
          "bg-surface text-foreground ring-1 ring-border hover:bg-surface-hover hover:ring-border-strong",
        secondary:
          "bg-surface-sunken text-secondary-foreground ring-1 ring-border-subtle ring-inset hover:bg-surface-active",
        ghost:
          "text-muted-foreground hover:bg-surface-hover hover:text-foreground aria-expanded:bg-surface-active aria-expanded:text-foreground",
        destructive:
          "bg-destructive text-destructive-foreground ring-1 ring-destructive hover:opacity-90",
        "destructive-ghost":
          "text-destructive hover:bg-destructive-soft hover:text-destructive-soft-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 text-sm",
        xs:
          "h-7 gap-1 rounded-sm px-2 text-2xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm:
          "h-8 gap-1.5 rounded-sm px-3 text-2xs has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-5 text-base",
        icon: "size-9",
        "icon-xs": "size-7 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8 rounded-sm",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

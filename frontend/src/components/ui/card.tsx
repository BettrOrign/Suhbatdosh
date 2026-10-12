import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The house card. Depth comes from a hairline ring + a 1px inner highlight,
 * not a drop shadow — `shadow-2xs` scattered across the old pages was the main
 * reason the UI read as dated.
 */
function Card({
  className,
  size = "default",
  interactive = false,
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm"; interactive?: boolean }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-lg bg-surface text-sm text-card-foreground",
        "ring-1 ring-border shadow-[inset_0_1px_0_0_color-mix(in_oklch,white_60%,transparent),var(--shadow-e1)]",
        "transition-[transform,box-shadow,background-color,ring-color] duration-150 ease-standard",
        "dark:shadow-[inset_0_1px_0_0_color-mix(in_oklch,white_6%,transparent),var(--shadow-e1)]",
        "has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0",
        "*:[img:first-child]:rounded-t-lg *:[img:last-child]:rounded-b-lg",
        "[--card-spacing:--spacing(4)]",
        "data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0",
        interactive &&
          "cursor-pointer hover:ring-border-strong hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min items-start gap-1 rounded-t-lg px-(--card-spacing)",
        "has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto]",
        "[.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

/** Card titles are `h3` by default so page heading order stays h1 > h2 > h3. */
function CardTitle({ className, as: As = "h3", ...props }: React.ComponentProps<"h3"> & { as?: "h3" | "h2" | "div" }) {
  return (
    <As
      data-slot="card-title"
      className={cn(
        "text-sm leading-snug font-semibold tracking-[-0.01em]",
        "group-data-[size=sm]/card:text-2xs",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-xs leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("px-(--card-spacing)", className)} {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-lg border-t bg-surface-sunken px-(--card-spacing) py-2",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}

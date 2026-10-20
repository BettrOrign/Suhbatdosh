import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-content min-h-20 w-full rounded-md border border-input bg-surface px-3 py-2.5 text-sm",
        "transition-[color,background-color,border-color,box-shadow] duration-150 ease-standard outline-none",
        "placeholder:text-muted-foreground/70",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
        "disabled:cursor-not-allowed disabled:bg-surface-sunken",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/25",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent",
        "transition-colors duration-150 ease-standard outline-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "aria-invalid:outline-destructive",
        "data-[size=default]:h-[18px] data-[size=default]:w-8",
        "data-[size=sm]:h-[14px] data-[size=sm]:w-6",
        "data-checked:bg-primary data-unchecked:bg-surface-active",
        "data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-3.5 rounded-full bg-white shadow-e1",
          "transition-transform duration-200 ease-emphasized",
          "group-data-[size=default]/switch:data-checked:translate-x-[calc(100%+2px)]",
          "group-data-[size=sm]/switch:size-3 group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%+2px)]",
          "group-data-[size=default]/switch:data-unchecked:translate-x-[2px]",
          "group-data-[size=sm]/switch:data-unchecked:translate-x-[2px]"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }

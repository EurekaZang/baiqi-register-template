import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Native <select> styled like shadcn Input/Trigger.
 * Used for dense header controls where full Select popup is heavier than needed.
 */
export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    data-slot="native-select"
    className={cn(
      'flex h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-foreground shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
      className,
    )}
    {...props}
  >
    {children}
  </select>
))
NativeSelect.displayName = 'NativeSelect'

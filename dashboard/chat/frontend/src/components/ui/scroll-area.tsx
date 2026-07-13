import * as React from 'react'
import { cn } from '../../lib/utils'

export function ScrollArea({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('relative min-h-0 overflow-auto', className)} {...props}>
      {children}
    </div>
  )
}

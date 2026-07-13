import * as React from 'react'
import { cn } from '../../lib/utils'

type Props = {
  content: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
  children: React.ReactElement
}

/**
 * Lightweight CSS tooltip (no portal). Good enough for dense chat chrome.
 * Usage: <Tooltip content="Pin"><Button>...</Button></Tooltip>
 */
export function Tooltip({
  content,
  side = 'top',
  className,
  children,
}: Props) {
  return (
    <span className={cn('ui-tooltip', `side-${side}`, className)}>
      {children}
      <span className="ui-tooltip-content" role="tooltip">
        {content}
      </span>
    </span>
  )
}

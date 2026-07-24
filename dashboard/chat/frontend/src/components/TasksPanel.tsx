import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  ListTodo,
  Loader2,
  X,
} from 'lucide-react'
import type { AgentTask } from '../api'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { ScrollArea } from './ui/scroll-area'
import { Separator } from './ui/separator'
import { Tooltip } from './ui/tooltip'
import { MobileSheet } from './MobileSheet'
import { cn } from '../lib/utils'

type Props = {
  tasks: AgentTask[]
  open: boolean
  onOpenChange: (open: boolean) => void
  className?: string
  presentation?: 'popover' | 'sheet'
}

function statusMeta(status?: string): {
  label: string
  short: string
  variant: 'default' | 'accent' | 'success' | 'warn' | 'danger'
  icon: ReactNode
} {
  switch ((status || 'pending').toLowerCase()) {
    case 'in_progress':
      return {
        label: 'In progress',
        short: 'Run',
        variant: 'accent',
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      }
    case 'completed':
      return {
        label: 'Completed',
        short: 'Done',
        variant: 'success',
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      }
    case 'deleted':
      return {
        label: 'Deleted',
        short: 'Del',
        variant: 'danger',
        icon: <Circle className="h-3.5 w-3.5" />,
      }
    default:
      return {
        label: 'Pending',
        short: 'Todo',
        variant: 'default',
        icon: <Circle className="h-3.5 w-3.5" />,
      }
  }
}

export function TasksPanel({
  tasks,
  open,
  onOpenChange,
  className,
  presentation = 'popover',
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [listParent] = useAutoAnimate({ duration: 180, easing: 'ease-out' })
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const visible = useMemo(
    () => tasks.filter((t) => (t.status || 'pending') !== 'deleted'),
    [tasks],
  )
  const completed = visible.filter((t) => t.status === 'completed').length
  const running = visible.filter((t) => t.status === 'in_progress')
  const pending = visible.filter(
    (t) => (t.status || 'pending') === 'pending' || t.provisional,
  )
  const total = visible.length
  const pct = total ? Math.round((completed / total) * 100) : 0
  const focus =
    running[0] ||
    pending[0] ||
    visible.find((t) => t.status !== 'completed') ||
    visible[0] ||
    null

  useEffect(() => {
    if (presentation === 'sheet') return
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    const onPointer = (e: MouseEvent) => {
      const el = rootRef.current
      if (!el) return
      if (e.target instanceof Node && !el.contains(e.target)) {
        onOpenChange(false)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointer)
    }
  }, [open, onOpenChange, presentation])

  const listBody =
    total === 0 ? (
      <p className="text-xs leading-relaxed text-slate-500">
        When the agent calls TaskCreate / TaskUpdate, tasks show here as a
        compact checklist without covering the chat.
      </p>
    ) : (
      <div className="tasks-sheet-body">
        <div className="space-y-2 pb-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-800">Checklist</span>
            <Badge variant="accent" className="text-[10px]">
              {completed}/{total}
            </Badge>
          </div>
          <div className="tasks-progress h-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-sky-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          {focus ? (
            <div className="rounded-md border border-sky-100 bg-sky-50/70 px-2 py-1.5 text-[11px] text-sky-800">
              <span className="font-semibold">Now: </span>
              {focus.status === 'in_progress' && focus.activeForm
                ? focus.activeForm
                : focus.subject || `Task ${focus.id}`}
            </div>
          ) : null}
        </div>
        <ul className="divide-y divide-slate-100" ref={listParent}>
          {visible.map((task) => {
            const meta = statusMeta(task.status)
            const isOpen = expandedId === String(task.id)
            return (
              <li key={task.id} className="task-item">
                <button
                  type="button"
                  className="task-row"
                  onClick={() => setExpandedId(isOpen ? null : String(task.id))}
                >
                  <span className="task-row-icon">{meta.icon}</span>
                  <span className="task-row-main">
                    <span className="task-row-title">
                      {task.subject || `Task ${task.id}`}
                    </span>
                    {task.status === 'in_progress' && task.activeForm ? (
                      <span className="task-row-sub">{task.activeForm}</span>
                    ) : null}
                  </span>
                  <Badge variant={meta.variant} className="shrink-0 text-[10px]">
                    {meta.short}
                  </Badge>
                </button>
                {isOpen ? (
                  <div className="task-details">
                    {task.description ? (
                      <p>{task.description}</p>
                    ) : (
                      <p className="text-slate-400">No description</p>
                    )}
                    <div className="task-meta-line">
                      #{task.id}
                      {task.provisional ? ' · provisional' : ''}
                      {task.updated_at
                        ? ` · ${new Date(task.updated_at).toLocaleTimeString()}`
                        : ''}
                    </div>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      </div>
    )

  if (presentation === 'sheet') {
    return (
      <MobileSheet
        open={open}
        onClose={() => onOpenChange(false)}
        title="Tasks"
        height="tall"
      >
        {listBody}
      </MobileSheet>
    )
  }

  if (total === 0) {
    return (
      <div className={cn('tasks-rail empty', className)} ref={rootRef}>
        <Tooltip content="No agent tasks yet">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="tasks-chip h-8 px-2.5 text-xs text-slate-500"
            onClick={() => onOpenChange(!open)}
          >
            <ListTodo className="h-3.5 w-3.5" />
            Tasks
          </Button>
        </Tooltip>
        {open ? (
          <Card className="tasks-popover shadow-lg">
            <CardHeader className="flex-row items-center justify-between space-y-0 p-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ListTodo className="h-4 w-4 text-sky-600" />
                Tasks
              </CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </CardHeader>
            <CardContent className="px-3 pb-3 pt-0">{listBody}</CardContent>
          </Card>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn('tasks-rail', className)} ref={rootRef}>
      <Tooltip content={open ? 'Collapse tasks' : 'Expand task checklist'}>
        <Button
          type="button"
          variant={open ? 'secondary' : 'outline'}
          size="sm"
          className="tasks-chip h-8 gap-1.5 px-2.5 text-xs"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
        >
          <ListTodo className="h-3.5 w-3.5 text-sky-600" />
          <span className="font-medium">Tasks</span>
          <Badge variant="accent" className="h-5 px-1.5 text-[10px]">
            {completed}/{total}
          </Badge>
          {running.length > 0 ? (
            <span className="tasks-chip-live">
              <Loader2 className="h-3 w-3 animate-spin" />
              {running.length}
            </span>
          ) : null}
          <span className="tasks-chip-meter" aria-hidden>
            <span style={{ width: `${pct}%` }} />
          </span>
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 text-slate-400 transition-transform',
              open ? 'rotate-180' : '',
            )}
          />
        </Button>
      </Tooltip>

      {!open && focus ? (
        <div className="tasks-focus-line" title={focus.description || focus.subject}>
          <span className="tasks-focus-dot" data-status={focus.status || 'pending'} />
          <span className="tasks-focus-text">
            {focus.status === 'in_progress' && focus.activeForm
              ? focus.activeForm
              : focus.subject || `Task ${focus.id}`}
          </span>
        </div>
      ) : null}

      {open ? (
        <Card className="tasks-popover shadow-lg">
          <CardHeader className="space-y-2 p-3 pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ListTodo className="h-4 w-4 text-sky-600" />
                Checklist
              </CardTitle>
              <div className="flex items-center gap-1.5">
                <Badge variant="accent" className="text-[10px]">
                  {completed}/{total}
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onOpenChange(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="tasks-progress h-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-sky-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            {focus ? (
              <div className="rounded-md border border-sky-100 bg-sky-50/70 px-2 py-1.5 text-[11px] text-sky-800">
                <span className="font-semibold">Now: </span>
                {focus.status === 'in_progress' && focus.activeForm
                  ? focus.activeForm
                  : focus.subject || `Task ${focus.id}`}
              </div>
            ) : null}
          </CardHeader>
          <Separator />
          <CardContent className="p-0">
            <ScrollArea className="max-h-56">
              <ul className="divide-y divide-slate-100" ref={listParent}>
                {visible.map((task) => {
                  const meta = statusMeta(task.status)
                  const isOpen = expandedId === String(task.id)
                  return (
                    <li key={task.id} className="task-item">
                      <button
                        type="button"
                        className="task-row"
                        onClick={() =>
                          setExpandedId(isOpen ? null : String(task.id))
                        }
                      >
                        <span className="task-row-icon">{meta.icon}</span>
                        <span className="task-row-main">
                          <span className="task-row-title">
                            {task.subject || `Task ${task.id}`}
                          </span>
                          {task.status === 'in_progress' && task.activeForm ? (
                            <span className="task-row-sub">{task.activeForm}</span>
                          ) : null}
                        </span>
                        <Badge variant={meta.variant} className="shrink-0 text-[10px]">
                          {meta.short}
                        </Badge>
                      </button>
                      {isOpen ? (
                        <div className="task-details">
                          {task.description ? (
                            <p>{task.description}</p>
                          ) : (
                            <p className="text-slate-400">No description</p>
                          )}
                          <div className="task-meta-line">
                            #{task.id}
                            {task.provisional ? ' · provisional' : ''}
                            {task.updated_at
                              ? ` · ${new Date(task.updated_at).toLocaleTimeString()}`
                              : ''}
                          </div>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </ScrollArea>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

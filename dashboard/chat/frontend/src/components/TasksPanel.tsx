import type { ReactNode } from 'react'
import { CheckCircle2, Circle, Loader2, ListTodo } from 'lucide-react'
import type { AgentTask } from '../api'
import { Badge } from './ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { ScrollArea } from './ui/scroll-area'
import { Separator } from './ui/separator'
import { cn } from '../lib/utils'

type Props = {
  tasks: AgentTask[]
  className?: string
  compact?: boolean
}

function statusMeta(status?: string): {
  label: string
  variant: 'default' | 'accent' | 'success' | 'warn' | 'danger'
  icon: ReactNode
} {
  switch ((status || 'pending').toLowerCase()) {
    case 'in_progress':
      return {
        label: 'In progress',
        variant: 'accent',
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      }
    case 'completed':
      return {
        label: 'Completed',
        variant: 'success',
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      }
    case 'deleted':
      return {
        label: 'Deleted',
        variant: 'danger',
        icon: <Circle className="h-3.5 w-3.5" />,
      }
    default:
      return {
        label: 'Pending',
        variant: 'default',
        icon: <Circle className="h-3.5 w-3.5" />,
      }
  }
}

export function TasksPanel({ tasks, className, compact }: Props) {
  const visible = tasks.filter((t) => (t.status || 'pending') !== 'deleted')
  const completed = visible.filter((t) => t.status === 'completed').length
  const total = visible.length

  if (total === 0) {
    return (
      <Card className={cn('tasks-panel empty', className)}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ListTodo className="h-4 w-4 text-sky-600" />
            Tasks
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs text-slate-500">
            Agent tasks will appear here when TaskCreate / TaskUpdate tools run.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={cn('tasks-panel', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ListTodo className="h-4 w-4 text-sky-600" />
            Tasks
          </CardTitle>
          <Badge variant="accent">
            {completed}/{total}
          </Badge>
        </div>
        <div className="tasks-progress mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-sky-500 transition-all"
            style={{ width: `${total ? Math.round((completed / total) * 100) : 0}%` }}
          />
        </div>
      </CardHeader>
      <Separator />
      <CardContent className={cn('p-0', compact ? 'max-h-48' : 'max-h-72')}>
        <ScrollArea className={cn(compact ? 'max-h-48' : 'max-h-72')}>
          <ul className="divide-y divide-slate-100">
            {visible.map((task) => {
              const meta = statusMeta(task.status)
              return (
                <li key={task.id} className="task-item px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-slate-500">{meta.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-900">
                          {task.subject || `Task ${task.id}`}
                        </span>
                        <Badge variant={meta.variant} className="shrink-0">
                          {meta.label}
                        </Badge>
                      </div>
                      {task.activeForm && task.status === 'in_progress' ? (
                        <div className="mt-0.5 text-xs text-sky-700">
                          {task.activeForm}
                        </div>
                      ) : null}
                      {task.description ? (
                        <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                          {task.description}
                        </p>
                      ) : null}
                      <div className="mt-1 font-mono text-[10px] text-slate-400">
                        #{task.id}
                        {task.provisional ? ' · provisional' : ''}
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

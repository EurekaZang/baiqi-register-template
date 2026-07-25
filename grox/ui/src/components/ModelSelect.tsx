import { useEffect, useMemo, useState } from 'react'
import { listModels, type ModelItem } from '../api'
import {
  contextTag,
  displayLabel,
  groupModels,
  vendorOf,
} from '../lib/model-meta'
import { cn } from '../lib/utils'
import { ModelLogo } from './ModelLogo'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from './ui/select'

type Props = {
  value: string
  onChange: (model: string) => void
  disabled?: boolean
  compact?: boolean
}

const FALLBACK_DEFAULT = 'grok-4.5'

function ModelOptionRow({
  model,
  showTag = true,
}: {
  model: ModelItem
  showTag?: boolean
}) {
  const vendor = vendorOf(model.id)
  const tag = showTag ? contextTag(model.id) : null
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ModelLogo vendor={vendor} />
      <span className="truncate text-left text-xs font-medium">
        {displayLabel(model)}
      </span>
      {tag ? (
        <span className="ml-auto shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400">
          {tag}
        </span>
      ) : null}
    </span>
  )
}

export function ModelSelect({ value, onChange, disabled, compact }: Props) {
  const [models, setModels] = useState<ModelItem[]>([])
  const [stale, setStale] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listModels()
      .then((res) => {
        if (cancelled) return
        setModels(res.data || [])
        setStale(!!res.stale)
        setError(null)
        if (!value) onChange(res.default || FALLBACK_DEFAULT)
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(err.message)
        setModels((prev) =>
          prev.length
            ? prev
            : [{ id: FALLBACK_DEFAULT, display_name: FALLBACK_DEFAULT }],
        )
        if (!value) onChange(FALLBACK_DEFAULT)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const options = useMemo(() => {
    const base: ModelItem[] =
      models.length > 0
        ? [...models]
        : [
            {
              id: value || FALLBACK_DEFAULT,
              display_name: value || FALLBACK_DEFAULT,
            },
          ]
    if (value && !base.some((m) => m.id === value)) {
      base.unshift({ id: value, display_name: value })
    }
    return base
  }, [models, value])

  const groups = useMemo(() => groupModels(options), [options])
  const currentId = value || FALLBACK_DEFAULT
  const current =
    options.find((m) => m.id === currentId) || {
      id: currentId,
      display_name: currentId,
    }
  const currentTag = contextTag(current.id)
  const currentTitle = currentTag
    ? `${displayLabel(current)} [${currentTag}]`
    : displayLabel(current)

  return (
    <div
      className={cn(
        'model-select',
        compact !== false && 'compact',
        'inline',
      )}
      title={
        error
          ? `Models: ${error}`
          : stale
            ? 'Stale model list'
            : currentTitle
      }
    >
      <Select
        value={currentId}
        onValueChange={(v) => {
          if (typeof v === 'string' && v) onChange(v)
        }}
        disabled={disabled}
      >
        <SelectTrigger
          size="sm"
          className={cn(
            'model-select-trigger h-8 min-w-[168px] max-w-[260px] gap-1.5 rounded-full border-neutral-700 bg-neutral-950 px-2.5 shadow-sm',
            'text-xs font-medium text-neutral-100',
          )}
          aria-label="Model"
        >
          <SelectValue>
            <span className="flex min-w-0 items-center gap-1.5">
              <ModelLogo vendor={vendorOf(current.id)} />
              <span className="truncate">{displayLabel(current)}</span>
              {currentTag ? (
                <span className="shrink-0 rounded bg-neutral-800 px-1 py-px font-mono text-[10px] font-normal text-neutral-400">
                  {currentTag}
                </span>
              ) : null}
            </span>
          </SelectValue>
          {stale ? (
            <span
              className="size-1.5 shrink-0 rounded-full bg-neutral-400"
              title="Stale model list"
              aria-hidden
            />
          ) : null}
        </SelectTrigger>
        <SelectContent
          align="end"
          alignItemWithTrigger={false}
          className="model-select-content min-w-[260px] max-w-[320px]"
        >
          {groups.map((g) => (
            <SelectGroup key={g.vendor}>
              <SelectLabel>{g.label}</SelectLabel>
              {g.items.map((m) => {
                const tag = contextTag(m.id)
                const itemLabel = tag
                  ? `${displayLabel(m)} ${tag}`
                  : displayLabel(m)
                return (
                  <SelectItem
                    key={m.id}
                    value={m.id}
                    label={itemLabel}
                    className="text-xs"
                  >
                    <ModelOptionRow model={m} />
                  </SelectItem>
                )
              })}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

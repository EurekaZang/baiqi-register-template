# Model Select Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chat header native model `<select>` with a compact shadcn Select that shows vendor logos and groups models by OpenAI / Anthropic / xAI / DeepSeek / Other.

**Architecture:** Keep `listModels()` and `ModelSelect` props. Add pure helpers in `lib/model-meta.ts` (vendor, groups, labels, context tags), a `ModelLogo` SVG component, and rewrite `ModelSelect.tsx` to compose official shadcn Select primitives. Thin CSS updates for the pill host.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind v4, shadcn base-nova (`@base-ui/react` Select), existing `listModels` API.

## Global Constraints

- Do not change backend `/api/models` or session patch behavior
- Do not kill/restart model_router on port 8088
- Logos must be inline SVG only (no CDN)
- Public props stay: `value`, `onChange`, `disabled?`, `compact?`
- Fallback default model id remains `grok-4.5`
- Vendor order fixed: OpenAI → Anthropic → xAI → DeepSeek → Other
- Within a group, preserve API list order
- Prefer UI sans for display names; no separate "Model" label on trigger

**Spec:** `docs/superpowers/specs/2026-07-14-model-select-redesign.md`

---

## File map

| Path | Role |
|------|------|
| Create `dashboard/chat/frontend/src/lib/model-meta.ts` | `VendorId`, `vendorOf`, `contextTag`, `displayLabel`, `groupModels` |
| Create `dashboard/chat/frontend/src/components/ModelLogo.tsx` | Vendor → 16px SVG |
| Modify `dashboard/chat/frontend/src/components/ModelSelect.tsx` | shadcn Select UI |
| Modify `dashboard/chat/frontend/src/App.css` | Host/pill styles; drop native-select-only rules that fight the new control |
| Optional create `dashboard/chat/frontend/src/lib/model-meta.test.ts` only if a test runner exists — **this package has no vitest**; verify via `npm run build` + manual check |

---

### Task 1: `model-meta` helpers

**Files:**
- Create: `dashboard/chat/frontend/src/lib/model-meta.ts`
- Modify: none

**Interfaces:**
- Consumes: `ModelItem` shape `{ id: string; display_name: string }` (mirror locally or import type from `../api`)
- Produces:
  - `export type VendorId = 'openai' | 'anthropic' | 'xai' | 'deepseek' | 'other'`
  - `export type VendorGroup = { vendor: VendorId; label: string; items: ModelItem[] }`
  - `export function vendorOf(id: string): VendorId`
  - `export function vendorLabel(vendor: VendorId): string`
  - `export function contextTag(id: string): string | null`
  - `export function displayLabel(model: { id: string; display_name?: string | null }): string`
  - `export function groupModels(models: ModelItem[]): VendorGroup[]`

- [ ] **Step 1: Add `model-meta.ts` with the full implementation**

```ts
import type { ModelItem } from '../api'

export type VendorId = 'openai' | 'anthropic' | 'xai' | 'deepseek' | 'other'

export type VendorGroup = {
  vendor: VendorId
  label: string
  items: ModelItem[]
}

const VENDOR_ORDER: VendorId[] = [
  'openai',
  'anthropic',
  'xai',
  'deepseek',
  'other',
]

const VENDOR_LABELS: Record<VendorId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  xai: 'xAI',
  deepseek: 'DeepSeek',
  other: 'Other',
}

export function vendorOf(id: string): VendorId {
  const key = (id || '').toLowerCase()
  if (key.startsWith('gpt-') || key.startsWith('codex-') || key === 'codex-auto-review') {
    return 'openai'
  }
  if (key.startsWith('claude-')) return 'anthropic'
  if (key.startsWith('grok-')) return 'xai'
  if (key.startsWith('deepseek-')) return 'deepseek'
  return 'other'
}

export function vendorLabel(vendor: VendorId): string {
  return VENDOR_LABELS[vendor]
}

/** Trailing `[1m]` / `[500k]` / `[0.5m]` style context markers. */
export function contextTag(id: string): string | null {
  const m = (id || '').match(/\[([^\]]+)\]\s*$/)
  if (!m) return null
  const tag = m[1].trim()
  if (!tag) return null
  // Keep short size-like tags; drop garbage
  if (/^[\d.]+(k|m|b)?$/i.test(tag) || /^(k|m|b)$/i.test(tag)) return tag
  if (tag.length <= 8) return tag
  return null
}

export function displayLabel(model: {
  id: string
  display_name?: string | null
}): string {
  const name = (model.display_name || '').trim()
  if (name) return name
  const id = model.id || ''
  return id.replace(/\[[^\]]+\]\s*$/, '') || id || 'model'
}

export function groupModels(models: ModelItem[]): VendorGroup[] {
  const buckets = new Map<VendorId, ModelItem[]>()
  for (const v of VENDOR_ORDER) buckets.set(v, [])
  for (const m of models) {
    const v = vendorOf(m.id)
    buckets.get(v)!.push(m)
  }
  const groups: VendorGroup[] = []
  for (const v of VENDOR_ORDER) {
    const items = buckets.get(v) || []
    if (!items.length) continue
    groups.push({ vendor: v, label: vendorLabel(v), items })
  }
  return groups
}
```

- [ ] **Step 2: Sanity-check helpers in Node (no vitest in package)**

Run from `dashboard/chat/frontend`:

```bash
node --input-type=module -e "
import { createRequire } from 'module';
// quick pure reimplementation check by reading file is overkill; use tsc later
console.log('helpers file present');
"
test -f src/lib/model-meta.ts && echo OK
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add dashboard/chat/frontend/src/lib/model-meta.ts
git commit -m "feat(chat): add model vendor meta helpers"
```

---

### Task 2: `ModelLogo` component

**Files:**
- Create: `dashboard/chat/frontend/src/components/ModelLogo.tsx`

**Interfaces:**
- Consumes: `VendorId` from `../lib/model-meta`
- Produces: `export function ModelLogo(props: { vendor: VendorId; className?: string; title?: string }): JSX.Element`

- [ ] **Step 1: Implement inline SVGs**

Use simplified 16×16 marks. Decorative: `aria-hidden` unless `title` provided.

```tsx
import type { VendorId } from '../lib/model-meta'
import { cn } from '../lib/utils'

type Props = {
  vendor: VendorId
  className?: string
  /** Optional accessible name; otherwise decorative */
  title?: string
}

export function ModelLogo({ vendor, className, title }: Props) {
  const common = cn('model-logo size-4 shrink-0', className)
  const a11y = title
    ? ({ role: 'img' as const, 'aria-label': title })
    : ({ 'aria-hidden': true as const })

  switch (vendor) {
    case 'openai':
      return (
        <svg viewBox="0 0 24 24" className={common} fill="currentColor" {...a11y}>
          {/* OpenAI-style bloom — simplified monochrome */}
          <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.01l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.387-.676zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.229V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
        </svg>
      )
    case 'anthropic':
      return (
        <svg viewBox="0 0 24 24" className={cn(common, 'text-[#D97757]')} fill="currentColor" {...a11y}>
          <path d="M17.304 3h-3.671l6.696 18h3.671L17.304 3zM6.696 3 0 21h3.744l1.37-3.552h7.051L13.535 21h3.751L10.392 3H6.696zm-.518 11.346L8.97 7.145l2.79 7.201H6.178z" />
        </svg>
      )
    case 'xai':
      return (
        <svg viewBox="0 0 24 24" className={common} fill="currentColor" {...a11y}>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      )
    case 'deepseek':
      return (
        <svg viewBox="0 0 24 24" className={cn(common, 'text-[#4D6BFE]')} fill="currentColor" {...a11y}>
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3.5c1.93 0 3.5 1.57 3.5 3.5S13.93 12.5 12 12.5 8.5 10.93 8.5 9 10.07 5.5 12 5.5zM12 20c-2.7 0-5.08-1.35-6.56-3.41C6.2 14.7 9.9 14 12 14s5.8.7 6.56 2.59C17.08 18.65 14.7 20 12 20z" />
        </svg>
      )
    default:
      return (
        <span
          className={cn(
            common,
            'inline-flex items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold uppercase text-slate-600',
          )}
          {...a11y}
        >
          ?
        </span>
      )
  }
}
```

Notes for implementer:
- If OpenAI path looks too heavy at 16px, swap to a simpler circle+node mark; visual fidelity at small size wins over path completeness.
- `other` letter avatar can use first char of model id when caller passes `title` or extend props later; `?` is fine for v1.

- [ ] **Step 2: Commit**

```bash
git add dashboard/chat/frontend/src/components/ModelLogo.tsx
git commit -m "feat(chat): add vendor ModelLogo SVGs"
```

---

### Task 3: Rewrite `ModelSelect` with shadcn Select

**Files:**
- Modify: `dashboard/chat/frontend/src/components/ModelSelect.tsx` (full rewrite)
- Reference: `dashboard/chat/frontend/src/components/ui/select.tsx` (do not change unless SelectValue children fail to render custom content — prefer wrapping in trigger)

**Interfaces:**
- Consumes: `listModels`, `ModelItem`; `groupModels`, `displayLabel`, `contextTag`, `vendorOf`; `ModelLogo`; Select primitives
- Produces: same exported `ModelSelect` component and props

- [ ] **Step 1: Replace component body**

Full target file:

```tsx
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
        <span className="ml-auto shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
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
            : displayLabel(current)
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
            'model-select-trigger h-8 min-w-[168px] max-w-[240px] gap-1.5 rounded-full border-slate-200 bg-white px-2.5 shadow-sm',
            'text-xs font-medium text-slate-800',
            disabled && 'opacity-60',
          )}
          aria-label="Model"
        >
          <SelectValue>
            <span className="flex min-w-0 items-center gap-1.5">
              <ModelLogo vendor={vendorOf(current.id)} />
              <span className="truncate">{displayLabel(current)}</span>
              {stale ? (
                <span
                  className="ml-0.5 size-1.5 shrink-0 rounded-full bg-amber-500"
                  title="Stale model list"
                />
              ) : null}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          align="end"
          className="model-select-content min-w-[260px] max-w-[320px]"
        >
          {groups.map((g) => (
            <SelectGroup key={g.vendor}>
              <SelectLabel>{g.label}</SelectLabel>
              {g.items.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs">
                  <ModelOptionRow model={m} />
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
```

Implementer notes:
- base-ui Select `onValueChange` may pass `string | null` — guard null.
- If `SelectValue` children do not show custom logo (some versions only show selected item text), put logo **outside** `SelectValue` as siblings inside `SelectTrigger`:

```tsx
<SelectTrigger ...>
  <ModelLogo vendor={vendorOf(current.id)} />
  <SelectValue />
  {stale ? <span className="size-1.5 rounded-full bg-amber-500" /> : null}
</SelectTrigger>
```

and ensure each `SelectItem` children text is the display label so the closed value string is sensible. Prefer custom children if it works after build.

- [ ] **Step 2: Build**

```bash
cd dashboard/chat/frontend && npm run build
```

Expected: `tsc -b && vite build` exit 0. Fix any type errors (often Select `onValueChange` signature or unused imports).

- [ ] **Step 3: Commit**

```bash
git add dashboard/chat/frontend/src/components/ModelSelect.tsx
git commit -m "feat(chat): redesign ModelSelect with logos and vendor groups"
```

---

### Task 4: CSS host polish + responsive

**Files:**
- Modify: `dashboard/chat/frontend/src/App.css` (sections `.model-select-host`, `.model-select`, native select rules ~553–562, ~898–936, ~980–992)

- [ ] **Step 1: Update styles**

Replace/augment model-select CSS so:

```css
.model-select-host {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  min-width: 0;
}

.model-select {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  margin: 0;
}

.model-select.compact {
  gap: 0;
}

/* New shadcn trigger — kill old native select force styles */
.model-select-trigger {
  height: 32px !important;
}

.model-select-content [data-slot='select-label'] {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

@media (max-width: 900px) {
  .model-select-host {
    width: 100%;
  }

  .model-select,
  .model-select-trigger {
    width: 100%;
    max-width: none;
  }
}
```

Remove or neutralize rules that only target `.model-select select` / `.model-select-input` if they no longer apply (keep if `NativeSelect` still used elsewhere — CwdPicker uses NativeSelect, not these classes).

- [ ] **Step 2: Build again**

```bash
cd dashboard/chat/frontend && npm run build
```

Expected: success; new hashed assets under `dist/assets/`.

- [ ] **Step 3: Manual smoke (browser)**

1. Hard-refresh `http://127.0.0.1:8090/chat/`
2. Header shows pill with logo + name (no "Model" label)
3. Open dropdown → groups OpenAI / Anthropic / xAI / DeepSeek
4. Each row has logo; `[1m]` models show tag
5. Select another model → trigger updates
6. While agent running → disabled
7. ChatView tooltip still wraps host

- [ ] **Step 4: Commit**

```bash
git add dashboard/chat/frontend/src/App.css
git commit -m "style(chat): align model select pill with header toolbar"
```

---

### Task 5: Final verification

- [ ] **Step 1: Full frontend build**

```bash
cd dashboard/chat/frontend && npm run build
```

Expected: exit 0

- [ ] **Step 2: Confirm served assets are fresh**

```bash
ls -lt dashboard/chat/frontend/dist/assets | head -5
# optional: curl -sS http://127.0.0.1:8091/ | head  (or 8090 /chat/) and check index-*.js hash matches dist
```

- [ ] **Step 3: No further commits unless fixes needed**

If SelectValue custom render fails at runtime, fix per Task 3 note and commit:

```bash
git add dashboard/chat/frontend/src/components/ModelSelect.tsx
git commit -m "fix(chat): ModelSelect trigger logo rendering"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Compact pill trigger with logo + name | 3, 4 |
| No "Model" label | 3 |
| shadcn Select | 3 |
| Groups OpenAI/Anthropic/xAI/DeepSeek/Other | 1, 3 |
| Inline SVG logos | 2 |
| Context tags from id suffix | 1, 3 |
| Stale amber indicator | 3 |
| Disabled while running (caller) | 3 (props) |
| Props / listModels / fallback unchanged | 3 |
| App.css host alignment | 4 |
| Build + manual verify | 5 |

## Self-review notes

- No vitest in frontend package — helpers verified via TypeScript build, not unit tests
- SelectValue custom children may need fallback pattern documented in Task 3
- CwdPicker remains NativeSelect; do not break its CSS

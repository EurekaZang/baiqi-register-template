# Model Select Redesign

Date: 2026-07-14  
Status: approved direction (user chose A grouping, A compact pill, approach 1)

## Goal

Replace the plain native `<select>` model picker in the 8090 chat header with a compact, shadcn-based control that shows each model's vendor logo and groups options by vendor. Keep existing session/model wiring unchanged.

## Non-goals

- No backend `/models` API changes
- No Command/search palette (deferred)
- No model capability badges (vision/tools) unless already on `ModelItem`
- No dark-mode-only redesign; light header chrome stays primary

## Current state

- `ModelSelect.tsx` uses `NativeSelect` + text options
- Models from `listModels()` → `{ id, display_name }[]` + `default` + `stale`
- Live catalog includes OpenAI (`gpt-*`, `codex-*`), Anthropic (`claude-*`), xAI (`grok-*`), DeepSeek (`deepseek-*`), plus context-window suffixes like `[1m]`, `[500k]`, `[0.5m]`
- Mounted in `ChatView` header toolbar next to `CwdPicker` (32px control strip)
- While agent is running, select is disabled

## UX

### Trigger (collapsed)

Compact pill, ~32px height, aligned with Cwd control:

```
[logo 16px]  Claude Sonnet 4.6  ▾
```

- No separate "Model" label
- White/transparent field surface, thin border, rounded-lg
- Mono or UI sans for name (prefer UI sans for display_name; id only in tooltip)
- Tooltip retains existing ChatView copy (running / next-turn / fresh session)
- `stale`: small amber dot after chevron (keep optional `Badge` only if space allows; prefer dot)
- `disabled`: opacity + no pointer
- Fallback when list empty: show current `value` or `grok-4.5`

### Dropdown

- shadcn `Select` (base-ui) with `SelectGroup` + `SelectLabel` + `SelectItem`
- Min width ~260px, max height via existing scroll primitives
- Groups in fixed order:
  1. OpenAI
  2. Anthropic
  3. xAI
  4. DeepSeek
  5. Other (only if any unmatched ids)
- Empty groups omitted
- Each item: `[logo] display_name` + optional context tag (`1m`, `500k`, `0.5m`) parsed from id suffix
- Selected item shows check indicator (existing SelectItem)
- Preserve API order within each group (no alphabetical reshuffle unless ties)

### Vendor + logo mapping

Resolve vendor from **model id** (not display_name):

| Match (first wins) | Vendor label | Logo |
|--------------------|--------------|------|
| `gpt-`, `codex-`, or id `codex-auto-review` | OpenAI | OpenAI mark (near-black) |
| `claude-` | Anthropic | Anthropic asterisk mark (warm brown `#D97757` family) |
| `grok-` | xAI | xAI / Grok simple mark (near-black) |
| `deepseek-` | DeepSeek | DeepSeek whale/circle mark (blue) |
| else | Other | Letter avatar from first char of id |

Logos are **inline SVG components** (no external CDN, no emoji). Size 16px in trigger and items; `currentColor` or fixed brand fill as appropriate on light bg.

### Display helpers

- `displayLabel(model)`: `display_name` if present/non-empty, else raw `id` without bracket suffix
- `contextTag(id)`: extract trailing `[…]` token if it looks like a context size (`1m`, `0.5m`, `500k`, `200k`, etc.); render as muted micro badge on the item only (not required on trigger if display_name already unique)
- Trigger text: prefer `display_name`; if missing, humanize id by stripping bracket suffix

## Architecture

```
ModelSelect.tsx          # data fetch + Select composition (public API unchanged)
lib/model-meta.ts        # vendorOf, groupModels, contextTag, displayLabel
components/ModelLogo.tsx # vendor → SVG
```

### Public props (unchanged)

```ts
type Props = {
  value: string
  onChange: (model: string) => void
  disabled?: boolean
  compact?: boolean  // keep for callers; compact is default visual
}
```

### Data flow

1. Mount → `listModels()` once (same as today)
2. Build `options` including orphan `value` not in list
3. `groupModels(options)` → ordered groups
4. `Select value={value} onValueChange={onChange}`
5. Errors: keep previous list or single fallback option; tooltip/title may mention error; no blocking modal

### ChatView

- Keep wrapper `Tooltip` + `model-select-host`
- No prop API changes; only visual host CSS if needed for pill alignment

## Styling

- Prefer Tailwind + shadcn tokens on SelectTrigger/Item
- Thin App.css updates for `.model-select-host` / remove obsolete native-select-only rules that conflict
- Do not reintroduce product-token collisions with shadcn `--muted` / `--accent` (already renamed to `--text-muted` / `--brand` in App.css)

## Accessibility

- Trigger is a real button (SelectTrigger)
- Groups labeled via SelectLabel
- Keyboard: open, arrow, typeahead if base-ui provides, Enter/Space select
- Disabled state exposed to a11y tree
- Logos decorative: `aria-hidden` on SVG; name text remains accessible

## Testing / verification

- `npm run build` in chat frontend
- Manual: open header select → groups + logos visible
- Manual: switch model in draft and existing session
- Manual: while streaming, control disabled
- Manual: unknown id shows Other letter avatar and still selectable

## Implementation notes

- Official OpenAI/Anthropic/xAI/DeepSeek marks: use simplified, recognizable monochrome/brand-tint SVG paths suitable for 16px (not full marketing logos if path weight fails at small size)
- Do not fetch logo URLs
- Keep `FALLBACK_DEFAULT = 'grok-4.5'`

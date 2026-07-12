# Grok Pipeline Dashboard — White Geek Command Center Redesign

**Date:** 2026-07-12  
**Target:** `dashboard/` on `:8090` (`python dashboard/server.py`)  
**Status:** Approved for implementation planning  

## Problem

The current dashboard (`dashboard/index.html`) uses a dark multi-card layout. Services, account pool, registration, six usage stats, dual charts, full account table, and registration log all compete on first paint. The user wants a calmer **white geek** look and a **large USD total** as the primary focal point.

## Goals

1. **White geek aesthetic** — near-white background, thin borders, monospace/tabular metrics, minimal shadow, single cool accent.
2. **Hero total usage in USD** — largest element on the page is **lifetime cumulative commercial-equivalent USD** (not free-tier cash).
3. **De-cluttered command center** — first paint shows only: header health, hero $, secondary KPIs, compact services, one usage chart. Secondary ops modules are collapsible.
4. **Preserve behavior** — existing poll loops, registration start/stop, account reload, usage range queries, and canvas chart math stay intact unless a tiny API field is required.

## Non-goals

- No new backend product features (billing, auth, multi-user).
- No rewrite of `server.py` probe/registration logic.
- No dark-mode toggle in this pass.
- No external chart library; keep the existing canvas drawer.

## Decisions (user-approved)

| Topic | Choice |
|-------|--------|
| Primary $ metric | **Cumulative commercial-equivalent total** (from gateway `tokens_cum`) |
| Density | **Lean command center** |
| Secondary modules | **Collapsible panels** (default collapsed) |
| Layout | **A · Hero command center** (vertical stack, hero first) |
| Charts | **Single primary chart** with Tokens/USD toggle (default USD) |

## Visual system

### Palette

| Token | Value | Role |
|-------|-------|------|
| `--bg` | `#f7f8fa` | Page background |
| `--panel` | `#ffffff` | Cards / hero surface |
| `--border` | `#e5e7eb` | 1px borders |
| `--text` | `#0f172a` | Primary text |
| `--muted` | `#64748b` | Labels / secondary |
| `--accent` | `#0ea5e9` | Links, active range, focus |
| `--ok` | `#16a34a` | Healthy |
| `--warn` | `#d97706` | Degraded |
| `--bad` | `#dc2626` | Down / error |
| `--mono` | system mono stack | Metrics, tables, log |

Optional: very light grid/dot texture on `--bg` (opacity ≤ 4%). Avoid radial neon washes.

### Typography

- UI: system UI stack (Inter if present, else system-ui).
- Hero amount: 56–72px desktop, scale down under 980px; `font-variant-numeric: tabular-nums`; monospace preferred for `$` figure.
- Section labels: 11–12px uppercase tracking, `--muted`.

### Components

- **Cards:** white, `border-radius: 12px`, `1px solid --border`, shadow none or `0 1px 2px rgba(15,23,42,0.04)`.
- **Buttons:** primary = solid accent or near-black; ghost = border only; danger retained for Stop.
- **Status dots:** 8px, no heavy glow (optional soft 2px spread max).
- **Collapse headers:** full-width row, chevron, one-line summary on the right.

## Layout structure

```
sticky header: title | overall health badge | last refresh | Refresh
main (max-width ~1120–1200px, generous vertical gap)

1. HERO card
   - label: TOTAL EQUIV / 累计等价用量
   - large $ amount (lifetime cumulative commercial equiv)
   - sub: free-tier cash $0 · rate note (input/output or blended)
   - secondary KPI row:
       window $ (selected range) | $/hr | Σ tokens (window) | pool OK/blocked | req ok/fail

2. SERVICES
   - compact horizontal/wrap strip: name + status dot + latency
   - not a tall 3-column grid of large cards

3. USAGE card
   - range buttons: 1h / 6h / 24h / 7d / all (default 24h)
   - series toggle: USD (default) | Tokens
   - one canvas chart (reuse drawLineChart, light-theme colors)
   - short note under chart

4. Collapsible sections (default collapsed)
   - Account pool (summary always visible on header)
   - Registration (status always visible; auto-expand when running)
   - Accounts table
   - Registration log (auto-expand when running optional, same as Registration)
```

### Collapse behavior

- Default: all four collapsed.
- Persist open/closed in `localStorage` (keys under e.g. `dash.panel.*`).
- When registration status becomes `running`, force-open Registration and Log for that session (still allow manual collapse).
- Headers show live one-line summaries without expand.

### Responsive

- &lt;980px: hero font smaller; KPI wrap 2 columns; services stack; chart full width.

## Data mapping

### Hero cumulative USD (primary)

Prefer pure frontend from `/api/usage`:

1. Prefer `latest.tokens_cum` or `latest.tokens_cum_total`.
2. Convert with `pricing`:
   - If true **lifetime** prompt/completion cumulatives are available from API, use  
     `prompt/1e6 * usd_input_per_m + completion/1e6 * usd_output_per_m`.
   - Else blended: `tokens_cum / 1e6 * usd_per_m_tokens` (default 5.0).
3. **Do not** use per-15m `latest.tokens_prompt` / `tokens_completion` for the hero total — those are bucket deltas in `mode: per_15m`.
4. If no cumulative: show `—` and a short “tracking not ready” hint.

**Important:** Range changes must **not** change the hero lifetime total. Range only affects secondary window KPIs and the chart.

### Secondary KPIs

| KPI | Source |
|-----|--------|
| Window $ | `deltas.delta_usd` |
| $/hr | `deltas.rate_usd_per_hour` |
| Σ tokens (window) | `deltas.delta_tokens` |
| Pool | overview/accounts summary (total / OK / blocked) |
| Req ok/fail | `latest.success_count` / `fail_count` when present |

### Optional backend patch

Only if frontend cannot obtain a correct cumulative total after wiring:

- Extend `api_usage` with e.g.  
  `totals: { tokens_cum, usd_equiv_cum, price_mode }`  
  computed from the same cumulative counters already used in sampling.

Default plan: **frontend-only** unless verification fails.

## Files

| File | Change |
|------|--------|
| `dashboard/index.html` | Primary: CSS theme, DOM restructure, collapse UI, hero bind, chart theme/toggle |
| `dashboard/server.py` | Optional small `totals` field only if needed |

No new dependencies.

## Interaction / polling (unchanged unless noted)

- Overview poll ~3s, accounts ~5s, usage ~15s (keep existing timers).
- `setUsageRange`, `loadUsage`, registration start/stop, reload accounts unchanged in contract.
- Chart empty/error states keep working with light-theme empty text color.

## Acceptance criteria

1. First paint is uncluttered: eye hits large cumulative `$` immediately.
2. Theme is white/geek (light bg, thin borders, mono metrics); no dark neon hero.
3. Hero shows lifetime commercial-equivalent total; free cash noted as $0.
4. Services health still visible and scannable.
5. Usage range + chart still update; single chart with USD/Tokens toggle.
6. Account pool, registration controls, account table, and log remain available via collapse; registration running state is discoverable.
7. Existing APIs continue to work; no regression in start/stop registration.

## Implementation notes (for planning)

- Prefer rewriting the `<style>` and top-level `<main>` structure in `index.html` rather than layering more CSS on the dark theme.
- Keep JS helpers (`fmtUsd`, `fmtTokens`, `drawLineChart`, poll loop) and adapt colors via options or CSS-driven stroke colors.
- When implementing `drawLineChart` for light theme: axis/grid/label colors from muted slate, not `#8fa3b8` on dark.
- Verify live numbers against `curl 'http://127.0.0.1:8090/api/usage?range=24h'` after UI change.

## Out of scope follow-ups

- Dark/light toggle
- Multi-provider cost breakdown
- Historical backfill before tracking start
- Mobile-native PWA

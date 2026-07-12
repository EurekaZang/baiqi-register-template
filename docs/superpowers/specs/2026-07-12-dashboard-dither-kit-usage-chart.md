# Grok Pipeline Dashboard — Dither-Kit Usage Chart Island

**Date:** 2026-07-12  
**Target:** `dashboard/` on `:8090` (`python dashboard/server.py`)  
**Status:** Approved for implementation planning  
**Depends on:** white-geek redesign (`docs/superpowers/specs/2026-07-12-dashboard-white-geek-redesign.md`) — already shipped

## Problem

The Usage card still uses a hand-rolled canvas line chart (`drawLineChart`). The user wants the chart aesthetic from [dither-kit](https://www.tripwire.sh/dither-kit) (ordered Bayer dither fill, scrub tooltip, colour bloom) while **keeping** the existing white-geek shell and stdlib HTTP server.

dither-kit is a React/shadcn registry pack. The dashboard is a single-file vanilla HTML page served by Python. Full-page React rewrite is out of scope.

## Goals

1. Replace the Usage chart with a **real** dither-kit `AreaChart` (not a visual approximation).
2. Keep white-geek page chrome: hero $, services strip, collapsible ops panels, poll loops, `/api/*` contracts.
3. Zero runtime dependency on external CDNs for the chart (build artifacts served locally).
4. Bloom level: **`aura`** (user-approved).

## Non-goals

- No bar / pie / radar charts.
- No full-page React rewrite.
- No changes to registration, accounts, or service probe logic beyond static-file serving.
- Do not touch model_router / port **8088**.
- No dark-mode toggle in this pass.

## Decision (user-approved)

| Topic | Choice |
|-------|--------|
| Integration | **A · Vite React chart island** |
| Bloom | **`aura`** |
| Series colors | USD → dither `green`; Tokens → dither `blue` |
| Fill variant | `gradient` |
| Build artifacts | Committed under `dashboard/static/chart/` so deploy does not require Node |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  dashboard/index.html  (vanilla white-geek shell)       │
│   · hero / services / collapsible panels / poll loops   │
│   · Usage toolbar (USD|Tokens + range) stays vanilla    │
│   · #usageChartRoot  ──mounts──►  React island          │
└───────────────────────────┬─────────────────────────────┘
                            │ window.updateUsageChart(payload)
                            ▼
┌─────────────────────────────────────────────────────────┐
│  dashboard/static/chart/usage-chart.js (+ .css)         │
│   · React + motion + d3-scale/shape + dither-kit area   │
│   · AreaChart + Area + XAxis + YAxis + Grid + Tooltip   │
└───────────────────────────┬─────────────────────────────┘
                            ▲ built from
┌───────────────────────────┴─────────────────────────────┐
│  dashboard/chart-app/  (Vite + React source)            │
│   · src/main.tsx  — mount / update bridge               │
│   · src/UsageChart.tsx                                  │
│   · src/dither-kit/*  — vendored core + area-chart      │
└─────────────────────────────────────────────────────────┘
```

### Server change

`dashboard/server.py` today only serves `/` as HTML and `/api/*` as JSON. Add:

- `GET /static/<path>` → files under `dashboard/static/`, with correct MIME (`js`, `css`, `map`, `svg`, `woff2`).
- Path traversal guard: resolve under `DASH_DIR / "static"` only; 404 otherwise.
- Cache-Control: short or `no-cache` for HTML; assets may use longer cache with content-hashed names if Vite emits them — prefer **fixed names** (`usage-chart.js`, `usage-chart.css`) for simple `<script type="module">` tags, `Cache-Control: no-store` or short max-age to match dashboard ops style.

### Bridge API (vanilla ↔ React)

Exposed on `window` by the island entry:

```ts
// Mount once after DOM ready (idempotent).
window.mountUsageChart?(root: HTMLElement): void

// Push data after every successful /api/usage render.
window.updateUsageChart?(payload: UsageChartPayload): void

// Optional teardown (not required for first ship).
window.unmountUsageChart?(): void
```

```ts
type UsageChartPayload = {
  series: 'usd' | 'tokens'
  points: Array<{
    ts: number           // unix seconds
    label: string        // preformatted time tick (from main page fmtTimeLabel)
    value: number        // usd_15m or tokens_15m
  }>
  emptyText?: string
  valueFormat?: 'usd' | 'tokens'  // redundant with series; island may ignore
  bucketSec?: number
  range?: string
}
```

Main page responsibilities (unchanged contracts):

- Still polls `/api/usage`, computes hero KPIs, builds `tokenPts` / `usdPts`.
- On series/range change, call `updateUsageChart` with the active series points.
- If island not yet loaded, no-op or queue one payload (prefer: call after `mountUsageChart`).

Island responsibilities:

- Map `points` → dither-kit `data` rows `{ label, v }`.
- `config = { v: { label: series === 'usd' ? 'USD' : 'Tokens', color: series === 'usd' ? 'green' : 'blue' } }`.
- Render:

```tsx
<AreaChart data={rows} config={config} bloom="aura" animate animationDuration={900}>
  <Grid />
  <XAxis dataKey="label" maxTicks={6} />
  <YAxis tickFormatter={fmt} />
  <Tooltip labelKey="label" valueFormatter={fmt} />
  <Area dataKey="v" variant="gradient" />
</AreaChart>
```

- Empty state: when `points.length === 0`, show muted centered text (`emptyText`) instead of chart (or chart with zero-height data + empty message overlay).

### Visual system (chart only)

Aligned with white-geek page tokens:

| Role | Value |
|------|-------|
| Chart surface | `#fafbfc` (existing `.chart-wrap`) |
| Axes / ticks | slate muted (`#64748b` via CSS variables mapped to shadcn-like tokens) |
| Grid | `#e5e7eb` |
| Tooltip | white / near-white popover, 1px border `#e5e7eb`, mono 10–11px |
| USD series | dither-kit `green` seed |
| Tokens series | dither-kit `blue` seed |
| Bloom | `aura` |
| Variant | `gradient` |

Island CSS must define the few CSS variables dither-kit chrome expects (`--popover`, `--border`, `--muted-foreground`, `--foreground`, `--popover-foreground`) to light values so axes/tooltip match the page without Tailwind full theme.

Pixelated canvas (`image-rendering: pixelated`) is required — comes from dither-kit canvas styles; ensure built CSS preserves it.

### Vendoring dither-kit

- Source of truth: [Boring-Software-Inc/dither-kit](https://github.com/Boring-Software-Inc/dither-kit) registry (`registry/dither-kit/`).
- Vendor **only** what area chart needs: paint engine, palette, scales, contexts, cartesian canvas/root, area/line series, axes, grid, tooltip, legend (if unused can omit), lib/cn, sparkline optional omit.
- Dependencies (npm): `react`, `react-dom`, `motion`, `d3-scale`, `d3-shape`, `clsx`, `tailwind-merge`.
- **Do not** require full shadcn app or Tailwind build for the whole dashboard. Prefer:
  - Vite + React + TS for the island.
  - Minimal CSS file for chart chrome tokens + any utility classes the components need (or a tiny Tailwind scan limited to `chart-app/src`).
- Pin versions in `dashboard/chart-app/package.json`.

### Build & deploy

```bash
cd dashboard/chart-app
npm install
npm run build   # → ../static/chart/usage-chart.js + usage-chart.css
```

- Vite `build.lib` or single multi-entry that exposes the window bridge (IIFE or ES module). **Prefer ES module** loaded as:

```html
<link rel="stylesheet" href="/static/chart/usage-chart.css" />
<script type="module" src="/static/chart/usage-chart.js"></script>
```

- Committed artifacts under `dashboard/static/chart/` so `python dashboard/server.py` works without Node on the host.
- Document rebuild in `dashboard/chart-app/README.md` (short).

### index.html changes

1. Replace:

```html
<canvas id="chartMain" width="960" height="280"></canvas>
```

with:

```html
<div id="usageChartRoot" class="usage-chart-root" aria-label="Usage chart"></div>
```

2. CSS: `.usage-chart-root { width: 100%; height: 280px; position: relative; }` inside `.chart-wrap`.
3. Load island assets in `<head>` or end of body.
4. On DOMContentLoaded / after script load: `mountUsageChart(document.getElementById('usageChartRoot'))`.
5. `renderUsage`: keep hero/KPI/legend/note logic; replace `drawLineChart(...)` block with `updateUsageChart({...})`.
6. Keep `drawLineChart` in file only if still useful as fallback; default path is island. If island fails to load, show empty state text in root (optional soft fallback: keep `drawLineChart` behind a feature flag — **default: island only**, simpler).

### Legend

Existing `#usageLegend` HTML legend can remain (USD green / Tokens blue notes). Dither-kit `Legend` component optional; **skip** for v1 to avoid double legends.

### Interaction / polling

Unchanged:

- Overview ~3s, accounts ~5s, usage ~15s.
- `setUsageRange` / `setChartSeries` stay on main page; they re-render via `renderUsage` → `updateUsageChart`.
- Range must still **not** change hero lifetime total.

### Accessibility

- Chart container `role` / `aria-label` as dither-kit provides.
- Respect `prefers-reduced-motion` (already in dither-kit paint).
- Keyboard: toolbar buttons remain focusable; chart scrub is pointer-first (acceptable for ops dashboard).

## Files

| File | Change |
|------|--------|
| `dashboard/chart-app/**` | New Vite React app + vendored dither-kit |
| `dashboard/static/chart/*` | Built JS/CSS (committed) |
| `dashboard/server.py` | Static file GET `/static/*` |
| `dashboard/index.html` | Mount point, asset tags, bridge calls, remove canvas primary path |
| `docs/superpowers/specs/2026-07-12-dashboard-dither-kit-usage-chart.md` | This spec |
| `dashboard/chart-app/README.md` | Build instructions |

## Acceptance criteria

1. `http://127.0.0.1:8090` shows white-geek shell with dithered Usage area chart (Bayer texture, not plain gradient fill).
2. USD series is green dither; Tokens series is blue dither; toggle redraws without full page reload.
3. Hover scrub shows gliding tooltip with formatted value + time label.
4. Bloom `aura` visible on the fill (soft colour glow) without breaking light background readability.
5. Range buttons still change window series; hero $ remains lifetime cumulative.
6. No external CDN required for React/dither-kit at runtime.
7. `/static/chart/usage-chart.js` and `.css` return 200 from the Python server.
8. Registration start/stop, services strip, collapsible panels still work.
9. Port 8088 / model_router untouched.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Tailwind class names missing without full Tailwind | Ship minimal CSS that implements the classes used by vendored components, or run Tailwind only over chart-app |
| Large JS bundle | Tree-shake; only area path; gzip optional later |
| Server path traversal | Strict resolve under `static/` |
| Artifact drift | Document `npm run build`; commit artifacts; optional CI later |
| React 19 / motion API mismatch | Pin versions known to work with dither-kit registry sources |

## Implementation notes (for planning)

1. Scaffold `chart-app` with Vite React-TS.
2. Copy/adapt dither-kit registry files needed for area chart; fix imports to relative paths.
3. Implement `UsageChart` + window bridge.
4. Build to `static/chart/`.
5. Patch `server.py` static serving.
6. Wire `index.html`.
7. Manual verify against live `/api/usage`.
8. Commit source + artifacts + server + index.

## Out of scope follow-ups

- Multi-series stacked usage (prompt vs completion)
- Legend component from dither-kit
- Sparkline in hero KPI row
- Dark mode
- Hot-reload dev proxy from Vite to :8090 (nice-to-have in chart-app README only)

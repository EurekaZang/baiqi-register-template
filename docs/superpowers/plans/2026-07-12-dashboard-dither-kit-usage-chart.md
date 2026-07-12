# Dither-Kit Usage Chart Island Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vanilla canvas Usage chart on `:8090` with a real dither-kit `AreaChart` React island (bloom `aura`), while keeping the white-geek shell, APIs, and poll loops.

**Architecture:** A Vite-built React island under `dashboard/chart-app/` vendors the dither-kit area/core sources, exposes `window.mountUsageChart` / `window.updateUsageChart`, and ships fixed-name assets to `dashboard/static/chart/`. Python `server.py` serves `/static/*`. Main `index.html` mounts the island and pushes `/api/usage` points into it.

**Tech Stack:** React 19, Vite 6, TypeScript, motion, d3-scale, d3-shape, clsx, tailwind-merge, Tailwind CSS 3 (scoped to chart-app), Python stdlib HTTP, vendored [Boring-Software-Inc/dither-kit](https://github.com/Boring-Software-Inc/dither-kit) registry sources.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-dashboard-dither-kit-usage-chart.md`
- Bloom: **`aura`** only
- Series colors: USD → dither `green`; Tokens → dither `blue`; variant `gradient`
- Build artifacts committed under `dashboard/static/chart/` (host may lack Node)
- Do **not** kill/restart model_router or port **8088**
- Do not rewrite registration / accounts / service probes beyond static serving
- Hero lifetime $ still must not change with range
- Prefer ES module assets: `/static/chart/usage-chart.js` + `usage-chart.css`
- No external CDN at runtime for React/dither-kit

## File map

| File | Role |
|------|------|
| `dashboard/chart-app/package.json` | Island deps + scripts |
| `dashboard/chart-app/vite.config.ts` | Lib build → `../static/chart` |
| `dashboard/chart-app/tsconfig.json` | TS config |
| `dashboard/chart-app/tailwind.config.js` | Content scan `src/**` |
| `dashboard/chart-app/postcss.config.js` | Tailwind pipeline |
| `dashboard/chart-app/src/styles.css` | Tailwind + white-geek chart tokens |
| `dashboard/chart-app/src/dither-kit/*` | Vendored area+core sources (no bar/pie/radar) |
| `dashboard/chart-app/src/UsageChart.tsx` | React chart component |
| `dashboard/chart-app/src/main.tsx` | Window bridge + mount |
| `dashboard/chart-app/README.md` | Rebuild instructions |
| `dashboard/static/chart/usage-chart.js` | Built ES module (committed) |
| `dashboard/static/chart/usage-chart.css` | Built CSS (committed) |
| `dashboard/server.py` | `GET /static/*` |
| `dashboard/index.html` | Mount point + asset tags + bridge calls |

---

### Task 1: Scaffold chart-app (Vite + React + Tailwind)

**Files:**
- Create: `dashboard/chart-app/package.json`
- Create: `dashboard/chart-app/vite.config.ts`
- Create: `dashboard/chart-app/tsconfig.json`
- Create: `dashboard/chart-app/tsconfig.node.json`
- Create: `dashboard/chart-app/tailwind.config.js`
- Create: `dashboard/chart-app/postcss.config.js`
- Create: `dashboard/chart-app/src/styles.css`
- Create: `dashboard/chart-app/src/vite-env.d.ts`
- Create: `dashboard/chart-app/README.md`
- Create: `dashboard/chart-app/.gitignore` (ignore `node_modules` only; do **not** ignore `../static/chart`)

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `typecheck`
- Build output contract: `dashboard/static/chart/usage-chart.js` + `usage-chart.css` (fixed names)

- [ ] **Step 1: Write package.json**

```json
{
  "name": "grok-dashboard-usage-chart",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "clsx": "^2.1.1",
    "d3-scale": "^4.0.2",
    "d3-shape": "^3.2.0",
    "motion": "^12.23.12",
    "react": "^19.1.1",
    "react-dom": "^19.1.1",
    "tailwind-merge": "^3.3.1"
  },
  "devDependencies": {
    "@types/d3-scale": "^4.0.9",
    "@types/d3-shape": "^3.1.7",
    "@types/react": "^19.1.10",
    "@types/react-dom": "^19.1.7",
    "@vitejs/plugin-react": "^4.7.0",
    "autoprefixer": "^10.4.21",
    "postcss": "^8.5.6",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.9.2",
    "vite": "^6.3.5"
  }
}
```

- [ ] **Step 2: Write vite.config.ts (bundle React, fixed asset names)**

```ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "node:path"

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "../static/chart"),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(__dirname, "src/main.tsx"),
      formats: ["es"],
      fileName: () => "usage-chart.js",
    },
    rollupOptions: {
      // Bundle react/react-dom/motion/d3 into the single ES module (no CDN).
      external: [],
      output: {
        assetFileNames: (info) =>
          info.name && info.name.endsWith(".css")
            ? "usage-chart.css"
            : "assets/[name][extname]",
        inlineDynamicImports: true,
      },
    },
    target: "es2022",
    sourcemap: true,
  },
})
```

- [ ] **Step 3: Write tsconfig.json + tsconfig.node.json**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

`src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 4: Write Tailwind + PostCSS + styles with white-geek chart tokens**

`tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "var(--border)",
        foreground: "var(--foreground)",
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
}
```

`postcss.config.js`:

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

`src/styles.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* White-geek tokens for dither-kit chrome (axes / tooltip / grid). */
:root,
.usage-chart-root,
#usageChartRoot {
  --background: #fafbfc;
  --foreground: #0f172a;
  --popover: #ffffff;
  --popover-foreground: #0f172a;
  --muted: #f1f5f9;
  --muted-foreground: #64748b;
  --border: #e5e7eb;
  color: var(--foreground);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto,
    sans-serif;
}

.usage-chart-root,
#usageChartRoot {
  width: 100%;
  height: 100%;
  min-height: 280px;
  position: relative;
}

.usage-chart-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--muted-foreground);
  font-size: 13px;
  pointer-events: none;
}
```

- [ ] **Step 5: Write chart-app README + gitignore**

`README.md`:

```markdown
# Usage chart island (dither-kit)

React island for the Grok Pipeline Dashboard Usage card.

## Build

```bash
cd dashboard/chart-app
npm install
npm run build
# → dashboard/static/chart/usage-chart.js + usage-chart.css
```

Commit the built assets so `:8090` works without Node on the host.

## Dev

```bash
npm run dev
```

Optional: open the Vite demo later; production path is always via `server.py` + `index.html`.
```

`.gitignore`:

```
node_modules/
dist/
*.local
```

- [ ] **Step 6: npm install**

```bash
cd /home/eureka/baiqi-register-template/dashboard/chart-app
npm install
```

Expected: `node_modules/` created; no peer dependency hard failures for React 19.

- [ ] **Step 7: Commit scaffold**

```bash
cd /home/eureka/baiqi-register-template
git add dashboard/chart-app/package.json dashboard/chart-app/package-lock.json \
  dashboard/chart-app/vite.config.ts dashboard/chart-app/tsconfig.json \
  dashboard/chart-app/tsconfig.node.json dashboard/chart-app/tailwind.config.js \
  dashboard/chart-app/postcss.config.js dashboard/chart-app/src/styles.css \
  dashboard/chart-app/src/vite-env.d.ts dashboard/chart-app/README.md \
  dashboard/chart-app/.gitignore
git commit -m "chore(dashboard): scaffold Vite React chart-app for dither-kit"
```

---

### Task 2: Vendor dither-kit area + core (no bar/pie/radar)

**Files:**
- Create: `dashboard/chart-app/src/dither-kit/*.ts(x)` listed below
- Create: `dashboard/chart-app/src/dither-kit/SOURCE.md` (upstream pin)

**Interfaces:**
- Produces relative imports under `./dither-kit/...` usable by `UsageChart.tsx`
- Upstream: `https://raw.githubusercontent.com/Boring-Software-Inc/dither-kit/main/registry/dither-kit/<file>`
- **Include only:**

```
lib.ts
palette.ts
scales.ts
dither-paint.ts
use-chart-dimensions.ts
chart-context.tsx
common-context.tsx
series-context.tsx
cartesian-root.tsx
cartesian-canvas.tsx
grid.tsx
x-axis.tsx
y-axis.tsx
tooltip.tsx
area.tsx
area-chart.tsx
```

- **Exclude:** bar*, pie*, radar*, polar*, legend.tsx, sparkline.tsx, dot.tsx, index.ts, COMPONENTS.md (not required for v1)

- [ ] **Step 1: Download the 16 files into src/dither-kit**

```bash
cd /home/eureka/baiqi-register-template/dashboard/chart-app
mkdir -p src/dither-kit
BASE='https://raw.githubusercontent.com/Boring-Software-Inc/dither-kit/main/registry/dither-kit'
for f in \
  lib.ts palette.ts scales.ts dither-paint.ts use-chart-dimensions.ts \
  chart-context.tsx common-context.tsx series-context.tsx \
  cartesian-root.tsx cartesian-canvas.tsx \
  grid.tsx x-axis.tsx y-axis.tsx tooltip.tsx area.tsx area-chart.tsx
do
  curl -fsSL "$BASE/$f" -o "src/dither-kit/$f"
done
ls -la src/dither-kit
```

Expected: 16 files, non-empty.

- [ ] **Step 2: Write SOURCE.md pin**

```markdown
# Vendored from Boring-Software-Inc/dither-kit

- Upstream path: `registry/dither-kit/`
- Ref: `main` at vendor time (record commit SHA if available)
- Subset: area chart + core cartesian chrome only
- License: MIT (upstream)

Do not hand-edit paint math unless fixing a dashboard-specific integration bug;
prefer re-vendoring from upstream.
```

Optionally record SHA:

```bash
curl -fsSL https://api.github.com/repos/Boring-Software-Inc/dither-kit/commits/main \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha"][:12])'
```

Paste SHA into `SOURCE.md`.

- [ ] **Step 3: Fix TypeScript issues if any (common ones)**

After typecheck, apply only if needed:

1. `process.env.NODE_ENV` in `area.tsx` — Vite defines it; if TS complains, replace the warning block with:

```ts
if (import.meta.env.DEV && !ctx.config[dataKey]) {
  console.warn(...)
}
```

2. React 19 `use` import — keep as upstream (`import { use } from "react"`).

3. Do **not** vendor polar files; if any included file imports polar, stop and re-check the include list (area path must not).

- [ ] **Step 4: Typecheck vendored sources alone (temporary stub entry optional)**

Create a temporary stub only if needed for tsc path; otherwise wait until Task 3 has `main.tsx`. Prefer:

```bash
# After Task 3 files exist; if running early, skip to Task 3 Step 4 typecheck
cd /home/eureka/baiqi-register-template/dashboard/chart-app
npx tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit vendored sources**

```bash
git add dashboard/chart-app/src/dither-kit
git commit -m "chore(dashboard): vendor dither-kit area+core sources"
```

---

### Task 3: UsageChart component + window bridge

**Files:**
- Create: `dashboard/chart-app/src/UsageChart.tsx`
- Create: `dashboard/chart-app/src/main.tsx`
- Create: `dashboard/chart-app/src/types.ts`

**Interfaces:**
- Consumes: dither-kit `AreaChart`, `Area`, `XAxis`, `YAxis`, `Grid`, `Tooltip`
- Produces global:

```ts
type UsageChartPoint = {
  ts: number
  label: string
  value: number
}

type UsageChartPayload = {
  series: "usd" | "tokens"
  points: UsageChartPoint[]
  emptyText?: string
  bucketSec?: number
  range?: string
}

interface Window {
  mountUsageChart: (root: HTMLElement) => void
  updateUsageChart: (payload: UsageChartPayload) => void
  unmountUsageChart: () => void
}
```

- [ ] **Step 1: Write types.ts**

```ts
export type UsageChartSeries = "usd" | "tokens"

export type UsageChartPoint = {
  ts: number
  label: string
  value: number
}

export type UsageChartPayload = {
  series: UsageChartSeries
  points: UsageChartPoint[]
  emptyText?: string
  bucketSec?: number
  range?: string
}
```

- [ ] **Step 2: Write UsageChart.tsx**

```tsx
import { useMemo } from "react"
import { Area, AreaChart } from "./dither-kit/area-chart"
import { Grid } from "./dither-kit/grid"
import { Tooltip } from "./dither-kit/tooltip"
import { XAxis } from "./dither-kit/x-axis"
import { YAxis } from "./dither-kit/y-axis"
import type { UsageChartPayload } from "./types"

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—"
  const abs = Math.abs(n)
  const digits = abs >= 100 ? 2 : abs >= 1 ? 3 : 4
  return (
    "$" +
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: digits,
    })
  )
}

function fmtTokens(n: number): string {
  if (!Number.isFinite(n)) return "—"
  if (Math.abs(n) >= 1_000_000)
    return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "M"
  if (Math.abs(n) >= 1_000)
    return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k"
  return String(Math.round(n))
}

export function UsageChart({ payload }: { payload: UsageChartPayload | null }) {
  const series = payload?.series ?? "usd"
  const points = payload?.points ?? []
  const emptyText = payload?.emptyText ?? "waiting for samples…"

  const rows = useMemo(
    () =>
      points.map((p) => ({
        label: p.label,
        v: Number.isFinite(p.value) ? p.value : 0,
        ts: p.ts,
      })),
    [points]
  )

  const config = useMemo(
    () => ({
      v: {
        label: series === "usd" ? "USD" : "Tokens",
        color: (series === "usd" ? "green" : "blue") as "green" | "blue",
      },
    }),
    [series]
  )

  const yFmt = series === "usd" ? fmtUsd : fmtTokens
  const tipFmt = (value: number) => yFmt(value)

  if (!payload || rows.length === 0) {
    return <div className="usage-chart-empty">{emptyText}</div>
  }

  return (
    <div className="h-full w-full min-h-[280px]">
      <AreaChart
        data={rows}
        config={config}
        bloom="aura"
        animate
        animationDuration={900}
        interactive
        margins={{ top: 12, right: 12, bottom: 24, left: 44 }}
      >
        <Grid horizontal vertical={false} />
        <XAxis dataKey="label" maxTicks={6} />
        <YAxis tickFormatter={yFmt} tickCount={4} />
        <Tooltip labelKey="label" valueFormatter={tipFmt} />
        <Area dataKey="v" variant="gradient" />
      </AreaChart>
    </div>
  )
}
```

- [ ] **Step 3: Write main.tsx bridge**

```tsx
import { createRoot, type Root } from "react-dom/client"
import { UsageChart } from "./UsageChart"
import type { UsageChartPayload } from "./types"
import "./styles.css"

let root: Root | null = null
let host: HTMLElement | null = null
let lastPayload: UsageChartPayload | null = null

function render() {
  if (!root) return
  root.render(<UsageChart payload={lastPayload} />)
}

function mountUsageChart(el: HTMLElement) {
  if (host === el && root) {
    render()
    return
  }
  if (root) {
    root.unmount()
    root = null
  }
  host = el
  el.classList.add("usage-chart-root")
  root = createRoot(el)
  render()
}

function updateUsageChart(payload: UsageChartPayload) {
  lastPayload = payload
  if (!root && host) {
    root = createRoot(host)
  }
  render()
}

function unmountUsageChart() {
  if (root) root.unmount()
  root = null
  host = null
  lastPayload = null
}

declare global {
  interface Window {
    mountUsageChart: typeof mountUsageChart
    updateUsageChart: typeof updateUsageChart
    unmountUsageChart: typeof unmountUsageChart
  }
}

window.mountUsageChart = mountUsageChart
window.updateUsageChart = updateUsageChart
window.unmountUsageChart = unmountUsageChart

// Auto-mount if the dashboard root already exists when the module loads.
const existing = document.getElementById("usageChartRoot")
if (existing) mountUsageChart(existing)
```

- [ ] **Step 4: Typecheck**

```bash
cd /home/eureka/baiqi-register-template/dashboard/chart-app
npm run typecheck
```

Expected: exit 0. If failures in vendored files, fix only integration-breaking issues (imports / `import.meta.env` / missing types); do not refactor paint engine.

- [ ] **Step 5: Build**

```bash
cd /home/eureka/baiqi-register-template/dashboard/chart-app
npm run build
ls -la ../static/chart/
```

Expected: `usage-chart.js`, `usage-chart.css`, and optional `.map` files present; `usage-chart.js` contains `mountUsageChart` string:

```bash
rg -n 'mountUsageChart|bloom' ../static/chart/usage-chart.js | head
```

- [ ] **Step 6: Commit source + built assets**

```bash
cd /home/eureka/baiqi-register-template
git add dashboard/chart-app/src dashboard/static/chart
git commit -m "feat(dashboard): dither-kit UsageChart island build artifacts"
```

---

### Task 4: Serve `/static/*` from server.py

**Files:**
- Modify: `dashboard/server.py` (Handler static path + helpers near `_load_html` / `do_GET`)

**Interfaces:**
- Consumes: files under `DASH_DIR / "static"`
- Produces: `GET /static/<relpath>` → 200 with MIME, or 404
- Rejects `..` and absolute escapes

- [ ] **Step 1: Add MIME map + safe static reader after `_load_html`**

Insert near the HTTP server section (after `_load_html`):

```python
_STATIC_ROOT = (DASH_DIR / "static").resolve()
_STATIC_MIME = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
}


def _safe_static_path(url_path: str) -> Path | None:
    """Map /static/... to a file under dashboard/static. None if invalid."""
    raw = url_path[len("/static/") :] if url_path.startswith("/static/") else ""
    if not raw or raw.startswith("/") or "\\" in raw:
        return None
    # Disallow empty segments and parent traversal in the URL itself.
    parts = [p for p in raw.split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        return None
    candidate = (_STATIC_ROOT.joinpath(*parts)).resolve()
    try:
        candidate.relative_to(_STATIC_ROOT)
    except ValueError:
        return None
    if not candidate.is_file():
        return None
    return candidate
```

- [ ] **Step 2: Add `_static` response helper on Handler**

```python
    def _static(self, file_path: Path) -> None:
        try:
            data = file_path.read_bytes()
        except OSError:
            self._json(404, {"error": "not found"})
            return
        ext = file_path.suffix.lower()
        ctype = _STATIC_MIME.get(ext, "application/octet-stream")
        try:
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            # Ops dashboard: avoid sticky stale chart bundles after rebuild.
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return
```

- [ ] **Step 3: Route in do_GET before API 404**

In `do_GET`, after the `/` HTML branch (or before final 404), add:

```python
        if path == "/static" or path.startswith("/static/"):
            # path is rstrip("/")'d — restore filename for files under /static/
            full = parsed.path  # original, keeps trailing filename
            # If user requested /static or /static/, 404
            if full.rstrip("/") == "/static":
                self._json(404, {"error": "not found", "path": path})
                return
            fp = _safe_static_path(full)
            if fp is None:
                self._json(404, {"error": "not found", "path": full})
                return
            self._static(fp)
            return
```

**Important:** `do_GET` currently does `path = parsed.path.rstrip("/") or "/"`, which would turn `/static/chart/usage-chart.js` into `/static/chart/usage-chart.js` (no trailing slash issue) but would break directories. Always use `parsed.path` (not stripped) for static file lookup as shown.

Also ensure the early `path` variable is still used for API routes; only static uses `parsed.path`.

- [ ] **Step 4: Verify static serving against built assets (server already running)**

If server process does not auto-reload Python, restart **only** the dashboard service (not model_router):

```bash
# Prefer systemd unit if present
systemctl --user restart grok-dashboard.service 2>/dev/null || true
# Or if started manually, kill only dashboard/server.py then restart:
# pkill -f 'python dashboard/server.py'  # ONLY if user environment uses bare process
# cd /home/eureka/baiqi-register-template && python dashboard/server.py
```

Then:

```bash
curl -sS -D- -o /tmp/usage-chart.js \
  'http://127.0.0.1:8090/static/chart/usage-chart.js' | head -20
curl -sS -D- -o /tmp/usage-chart.css \
  'http://127.0.0.1:8090/static/chart/usage-chart.css' | head -15
# traversal must fail
curl -sS 'http://127.0.0.1:8090/static/../server.py' | head -c 200; echo
python3 - <<'PY'
from pathlib import Path
js=Path('/tmp/usage-chart.js').read_text(errors='ignore')
assert 'mountUsageChart' in js
print('js ok', len(js))
css=Path('/tmp/usage-chart.css').read_text(errors='ignore')
assert len(css)>50
print('css ok', len(css))
PY
```

Expected: JS/CSS HTTP 200; traversal not serving `server.py` source; `mountUsageChart` present.

- [ ] **Step 5: Commit server.py**

```bash
git add dashboard/server.py
git commit -m "feat(dashboard): serve /static assets for chart island"
```

---

### Task 5: Wire index.html (mount point + bridge)

**Files:**
- Modify: `dashboard/index.html` (head assets, Usage card DOM, CSS, `renderUsage` / boot)

**Interfaces:**
- Consumes: `window.mountUsageChart`, `window.updateUsageChart`
- Produces: payload built from existing `series` / `fmtTimeLabel` / `chartSeries`

- [ ] **Step 1: Add asset tags in `<head>` after title**

```html
<link rel="stylesheet" href="/static/chart/usage-chart.css" />
<script type="module" src="/static/chart/usage-chart.js"></script>
```

- [ ] **Step 2: Add CSS for mount root (near `.chart-wrap canvas` rules)**

Replace/extend canvas rule with:

```css
  .chart-wrap {
    position: relative;
    background: #fafbfc;
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 10px 10px 6px;
  }
  .chart-wrap .usage-chart-root,
  .chart-wrap #usageChartRoot {
    width: 100%;
    height: 280px;
    display: block;
  }
  .chart-wrap canvas {
    /* legacy; island owns canvas internally */
    width: 100%;
    height: 280px;
    display: block;
  }
```

- [ ] **Step 3: Replace canvas DOM with mount root**

Replace:

```html
      <canvas id="chartMain" width="960" height="280"></canvas>
```

with:

```html
      <div id="usageChartRoot" class="usage-chart-root" aria-label="Usage chart"></div>
```

- [ ] **Step 4: Add bridge helpers in `<script>` near chart state**

After `let chartSeries = 'usd';` / `lastUsageData` declarations, add:

```javascript
function ensureUsageChartMounted() {
  const el = $('usageChartRoot');
  if (!el) return false;
  if (typeof window.mountUsageChart === 'function') {
    window.mountUsageChart(el);
    return true;
  }
  return false;
}

function pushUsageChart(payload) {
  if (!ensureUsageChartMounted()) {
    // Module may still be loading; retry shortly once.
    setTimeout(() => {
      if (ensureUsageChartMounted() && typeof window.updateUsageChart === 'function') {
        window.updateUsageChart(payload);
      }
    }, 50);
    return;
  }
  if (typeof window.updateUsageChart === 'function') {
    window.updateUsageChart(payload);
  }
}

function buildUsageChartPoints(pts, xSpan) {
  // pts: [{x: ts, y: value}, ...]
  return (pts || []).map(p => ({
    ts: p.x,
    label: fmtTimeLabel(p.x, xSpan),
    value: Number(p.y) || 0,
  }));
}
```

- [ ] **Step 5: Replace drawLineChart calls inside renderUsage**

In `renderUsage`, keep hero/KPI/legend/note logic. Replace the block that calls `drawLineChart($('chartMain'), ...)` (both tokens and usd branches) with:

```javascript
  const xSpan = Math.max(1, winEnd - winStart);
  const activePts = chartSeries === 'tokens' ? tokenPts : usdPts;
  const emptyText = '该时间窗内无 15 分钟桶';
  pushUsageChart({
    series: chartSeries === 'tokens' ? 'tokens' : 'usd',
    points: buildUsageChartPoints(activePts, xSpan),
    emptyText: emptyText,
    bucketSec: bucketSec,
    range: data.range || usageRange,
  });

  if (chartSeries === 'tokens') {
    $('usageLegend').innerHTML =
      '<span><i style="background:#358ff3"></i>tokens per ' + Math.round(bucketSec/60) + ' min · dither blue</span>';
  } else {
    $('usageLegend').innerHTML =
      '<span><i style="background:#28d26e"></i>USD per ' + Math.round(bucketSec/60) + ' min (commercial) · dither green</span>' +
      '<span><i style="background:#94a3b8"></i>free-tier cash ($0)</span>';
  }
```

On the error path (`!data.ok`), replace `drawLineChart($('chartMain'), [], ...)` with:

```javascript
    pushUsageChart({
      series: chartSeries === 'tokens' ? 'tokens' : 'usd',
      points: [],
      emptyText: (data && data.error) || 'no data',
    });
```

- [ ] **Step 6: Mount on boot**

Near the bottom where `initPanels()` / first `tick()` run, add:

```javascript
ensureUsageChartMounted();
// Re-try after module load if script is deferred
window.addEventListener('load', () => {
  ensureUsageChartMounted();
  if (lastUsageData) renderUsage(lastUsageData);
});
```

- [ ] **Step 7: Optional — leave drawLineChart in file unused, or delete**

Prefer **delete** `drawLineChart` only if no remaining references:

```bash
rg -n 'drawLineChart|chartMain' dashboard/index.html
```

If only the function definition remains, remove the whole function to avoid dead code. If anything still references it, keep it.

- [ ] **Step 8: HTML smoke checks**

```bash
curl -sS 'http://127.0.0.1:8090/' | rg -n 'usageChartRoot|usage-chart\.js|usage-chart\.css|pushUsageChart|chartMain' | head -40
```

Expected: `usageChartRoot` present; module/css links present; `chartMain` absent (or only in comments).

- [ ] **Step 9: Commit index.html**

```bash
git add dashboard/index.html
git commit -m "feat(dashboard): mount dither-kit usage chart island"
```

---

### Task 6: End-to-end verification

**Files:**
- None required unless verification finds bugs (fix then re-commit)

- [ ] **Step 1: API + static + HTML field presence**

```bash
python3 - <<'PY'
import re, urllib.request, json
base='http://127.0.0.1:8090'
html=urllib.request.urlopen(base+'/').read().decode()
assert 'id="usageChartRoot"' in html
assert '/static/chart/usage-chart.js' in html
assert '/static/chart/usage-chart.css' in html
assert 'id="chartMain"' not in html
assert 'heroTotalUsd' in html
js=urllib.request.urlopen(base+'/static/chart/usage-chart.js').read().decode('utf-8','replace')
assert 'mountUsageChart' in js
css=urllib.request.urlopen(base+'/static/chart/usage-chart.css').read().decode('utf-8','replace')
assert len(css)>50
u=json.loads(urllib.request.urlopen(base+'/api/usage?range=24h').read())
assert u.get('ok')
print('e2e static+html ok; series points', len(u.get('series') or []))
# hero must still be computable
lat=u.get('latest') or {}
cum=lat.get('tokens_cum_total') or lat.get('tokens_cum')
pr=(u.get('pricing') or {}).get('usd_per_m_tokens',5)
print('expected_hero', None if cum is None else round(cum/1e6*pr,4))
PY
```

Expected: prints `e2e static+html ok` and a numeric `expected_hero`.

- [ ] **Step 2: Manual browser checklist**

Open `http://127.0.0.1:8090`:

1. Usage card shows **pixelated dither fill** (not a smooth CSS gradient alone).
2. Soft **aura** bloom around the series colour on light background.
3. Hover scrub moves a tooltip with time label + formatted value.
4. Toggle **USD / Tokens** → colour green ↔ blue, values change.
5. Toggle range **1h / 24h** → chart window changes; **hero $ unchanged**.
6. Services chips + collapsible panels still work; start/stop registration still works.
7. DevTools network: only local `/static/chart/*` for chart (no unpkg/cdnjs React).

- [ ] **Step 3: Resize / empty window sanity**

- Resize browser width: chart reflows (ResizeObserver in dither-kit).
- If a range has all-zero buckets, chart still renders (zeros are valid points); empty only when `points.length === 0`.

- [ ] **Step 4: Final status**

```bash
cd /home/eureka/baiqi-register-template
git status -sb
git log --oneline -8
```

Expected: clean chart-related commits; no accidental model_router changes.

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| Real dither-kit AreaChart | Task 2–3 |
| bloom `aura` | Task 3 UsageChart props |
| USD green / Tokens blue / gradient | Task 3 + Task 5 payload |
| Vite island + committed static assets | Task 1, 3 |
| `server.py` `/static/*` | Task 4 |
| index.html mount + bridge | Task 5 |
| Keep hero/services/panels/APIs | Task 5 (only Usage draw path) |
| No CDN | Task 1 vite bundle external:[] |
| No 8088 touch | Global constraint / Task 6 |
| Acceptance e2e | Task 6 |

## Placeholder / consistency self-review

- Bridge names consistent: `mountUsageChart` / `updateUsageChart` / `UsageChartPayload` across Tasks 3–5.
- Asset paths always `/static/chart/usage-chart.js` + `.css`.
- No TBD steps; vendored file list explicit.
- Static path safety uses `parsed.path` (not rstrip-only) for filenames.

## Execution notes

- Restart **dashboard only** after `server.py` changes (`systemctl --user restart grok-dashboard.service` if that unit exists).
- Never `pkill` broad python patterns; never touch port 8088.
- After any chart-app source change: `cd dashboard/chart-app && npm run build` then commit `static/chart` artifacts.

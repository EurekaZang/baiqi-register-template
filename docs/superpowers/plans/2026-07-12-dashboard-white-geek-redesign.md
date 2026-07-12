# White Geek Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `dashboard/index.html` (:8090) into a white-geek hero command center with a large lifetime cumulative USD total, compact services, one usage chart, and collapsible ops panels.

**Architecture:** Frontend-only rewrite of the single-file dashboard UI. Keep all `/api/*` contracts and poll loops. Hero total is computed from `latest.tokens_cum` × blended (or split) commercial rates. Secondary KPIs use `deltas.*`. Secondary modules use collapsible panels with live one-line summaries.

**Tech Stack:** Vanilla HTML/CSS/JS already served by `dashboard/server.py` (stdlib HTTP). No new deps. Canvas chart kept.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-dashboard-white-geek-redesign.md`
- Primary $ = **lifetime cumulative commercial-equivalent**, not window and not free-tier cash
- Range changes must **not** change hero total
- Default collapse all ops panels; auto-open Registration + Log when `running`
- Single chart with USD|Tokens toggle (default USD)
- Do not kill/restart model_router or port 8088
- Prefer not to change `server.py` unless hero total cannot be computed

## File map

| File | Role |
|------|------|
| `dashboard/index.html` | Only required change: theme, layout, hero, collapse, chart toggle, light chart colors |
| `dashboard/server.py` | Optional last-resort `totals` field — skip unless verification fails |
| `docs/superpowers/specs/2026-07-12-dashboard-white-geek-redesign.md` | Source of truth (already committed) |

---

### Task 1: Replace dark theme CSS + restructure HTML body

**Files:**
- Modify: `dashboard/index.html` (entire `<style>` block and `<body>` markup through `</main>`; leave `<script>` for Task 2–3 except id renames required by markup)

**Interfaces:**
- Produces DOM ids that JS will bind:
  - Hero: `heroTotalUsd`, `heroSub`, `kpiWindowUsd`, `kpiRate`, `kpiDeltaTok`, `kpiPool`, `kpiReq`
  - Services: `svcList` (keep)
  - Usage: `usageRangeBtns`, `chartSeriesBtns`, `chartMain`, `usageNote`, `usageLegend`
  - Collapse summaries: `sumPool`, `sumReg`, `sumAccounts`, `sumLog`
  - Existing ops ids kept: `accTotal`, `accActive`, `accExhausted`, `accMode`, `accQuotaNote`, `count`, `workers`, `btnStart`, `btnStop`, `regStatus`, `autoRegStatus`, `accFetched`, `accBody`, `logMeta`, `logBox`, `overallDot`, `overallText`, `lastRefresh`
  - Panel roots: `panelPool`, `panelReg`, `panelAccounts`, `panelLog` with class `panel` and `data-panel` key

- [ ] **Step 1: Snapshot current live API so redesign has reference numbers**

```bash
curl -sS 'http://127.0.0.1:8090/api/usage?range=24h' | python3 -c '
import sys,json
d=json.load(sys.stdin)
lat=d.get("latest") or {}
print("cum", lat.get("tokens_cum") or lat.get("tokens_cum_total"))
print("deltas", d.get("deltas"))
print("pricing", d.get("pricing"))
print("ok", d.get("ok"), "points", d.get("point_count"))
'
curl -sS 'http://127.0.0.1:8090/api/overview' | python3 -c '
import sys,json
d=json.load(sys.stdin)
print("services_ok", (d.get("services") or {}).get("ok"))
print("register", d.get("register"))
'
```

Expected: `ok True`, non-null `cum` / `deltas`, services ok.

- [ ] **Step 2: Replace `:root` + global styles with white geek tokens**

In `dashboard/index.html` `<style>`, replace dark variables and body/header/card rules with:

```css
:root {
  --bg: #f7f8fa;
  --panel: #ffffff;
  --border: #e5e7eb;
  --text: #0f172a;
  --muted: #64748b;
  --accent: #0ea5e9;
  --ok: #16a34a;
  --warn: #d97706;
  --bad: #dc2626;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  background:
    linear-gradient(var(--bg), var(--bg)),
    radial-gradient(circle at 1px 1px, rgba(15,23,42,0.04) 1px, transparent 0);
  background-size: auto, 20px 20px;
  color: var(--text);
  min-height: 100vh;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: rgba(247,248,250,0.92);
  backdrop-filter: blur(8px);
  z-index: 10;
}
header h1 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: 0.02em;
}
header h1 span { color: var(--accent); }
main {
  max-width: 1120px;
  margin: 0 auto;
  padding: 28px 22px 48px;
  display: grid;
  gap: 18px;
}
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 20px;
  box-shadow: var(--shadow);
}
.card h2, .panel-title {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
```

Also restyle `.badge`, `.dot`, `.btn-*`, inputs, table, `.log`, `.range-btns`, `.muted`, `.empty`, `.tag` for light surfaces (inputs white/`#f8fafc` bg, log `#0b1220` text on `#f8fafc` or keep dark log well for readability — prefer light log with colored lines).

- [ ] **Step 3: Add hero + services strip + usage + collapsible panel CSS**

Append styles:

```css
.hero {
  padding: 28px 28px 22px;
}
.hero-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 8px;
}
.hero-amount {
  font-family: var(--mono);
  font-size: clamp(42px, 8vw, 72px);
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.hero-sub {
  margin-top: 10px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.45;
}
.kpi-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}
@media (max-width: 980px) {
  .kpi-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.kpi .n {
  font-family: var(--mono);
  font-size: 18px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.kpi .l {
  font-size: 11px;
  color: var(--muted);
  margin-top: 2px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.svc-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.svc-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  font-size: 12px;
}
.svc-chip .name { font-weight: 600; }
.svc-chip .lat {
  font-family: var(--mono);
  color: var(--muted);
  font-size: 11px;
}
.chart-wrap {
  position: relative;
  background: #fafbfc;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 10px 6px;
}
.chart-wrap canvas {
  width: 100%;
  height: 280px;
  display: block;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.range-btns, .series-btns {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.range-btns button, .series-btns button {
  padding: 6px 10px;
  font-size: 12px;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  border: 1px solid var(--border);
  cursor: pointer;
}
.range-btns button.active, .series-btns button.active {
  color: var(--text);
  border-color: var(--accent);
  background: rgba(14,165,233,0.08);
}
.panel {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.panel > summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  user-select: none;
}
.panel > summary::-webkit-details-marker { display: none; }
.panel > summary .chev {
  color: var(--muted);
  font-family: var(--mono);
  margin-right: 8px;
}
.panel[open] > summary .chev { transform: rotate(90deg); display: inline-block; }
.panel .panel-body {
  padding: 0 18px 18px;
  border-top: 1px solid var(--border);
  padding-top: 14px;
}
.panel-sum {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
  text-align: right;
}
```

- [ ] **Step 4: Rewrite `<body>` structure (header + main)**

Replace existing header/main content with this structure (keep script below):

```html
<header>
  <h1><span>Grok</span> Pipeline</h1>
  <div style="display:flex;gap:10px;align-items:center;">
    <span class="badge" id="overallBadge"><span class="dot" id="overallDot"></span><span id="overallText">checking…</span></span>
    <span class="muted" id="lastRefresh">—</span>
    <button class="btn-ghost" onclick="refreshAll()">Refresh</button>
  </div>
</header>

<main>
  <section class="card hero">
    <div class="hero-label">Total equiv · 累计等价用量</div>
    <div class="hero-amount" id="heroTotalUsd">—</div>
    <div class="hero-sub" id="heroSub">free-tier cash $0 · commercial reference rate</div>
    <div class="kpi-row">
      <div class="kpi"><div class="n" id="kpiWindowUsd">—</div><div class="l">window $</div></div>
      <div class="kpi"><div class="n" id="kpiRate">—</div><div class="l">$/hr</div></div>
      <div class="kpi"><div class="n" id="kpiDeltaTok">—</div><div class="l">Σ tokens</div></div>
      <div class="kpi"><div class="n" id="kpiPool">—</div><div class="l">pool ok/block</div></div>
      <div class="kpi"><div class="n" id="kpiReq">—</div><div class="l">req ok/fail</div></div>
    </div>
  </section>

  <section class="card">
    <h2>Services</h2>
    <div class="svc-strip" id="svcList"><div class="empty">loading…</div></div>
  </section>

  <section class="card">
    <div class="toolbar">
      <h2 style="margin:0;">Usage</h2>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <div class="series-btns" id="chartSeriesBtns">
          <button data-series="usd" class="active" onclick="setChartSeries('usd')">USD</button>
          <button data-series="tokens" onclick="setChartSeries('tokens')">Tokens</button>
        </div>
        <div class="range-btns" id="usageRangeBtns">
          <button data-range="1h" onclick="setUsageRange('1h')">1h</button>
          <button data-range="6h" onclick="setUsageRange('6h')">6h</button>
          <button data-range="24h" class="active" onclick="setUsageRange('24h')">24h</button>
          <button data-range="7d" onclick="setUsageRange('7d')">7d</button>
          <button data-range="all" onclick="setUsageRange('all')">all</button>
        </div>
      </div>
    </div>
    <div class="chart-wrap">
      <canvas id="chartMain" width="960" height="280"></canvas>
      <div class="chart-legend" id="usageLegend"></div>
    </div>
    <div class="usage-note" id="usageNote">…</div>
  </section>

  <details class="panel" id="panelPool" data-panel="pool">
    <summary>
      <span class="panel-title"><span class="chev">▸</span> Account pool</span>
      <span class="panel-sum" id="sumPool">—</span>
    </summary>
    <div class="panel-body">
      <div class="stat-row">
        <div class="stat"><div class="n" id="accTotal">—</div><div class="l">total</div></div>
        <div class="stat"><div class="n" id="accActive">—</div><div class="l">OK</div></div>
        <div class="stat"><div class="n" id="accExhausted">—</div><div class="l">blocked</div></div>
      </div>
      <div class="muted" style="margin-top:12px;" id="accMode">mode: —</div>
      <div class="muted" id="accQuotaNote">pool: —</div>
      <div class="btns" style="margin-top:14px;">
        <button class="btn-ghost" onclick="loadAccounts(true)">Reload accounts</button>
      </div>
    </div>
  </details>

  <details class="panel" id="panelReg" data-panel="reg">
    <summary>
      <span class="panel-title"><span class="chev">▸</span> Registration</span>
      <span class="panel-sum" id="sumReg">idle</span>
    </summary>
    <div class="panel-body">
      <div class="form">
        <div>
          <label for="count">Accounts</label>
          <input type="number" id="count" min="1" max="50" value="3" />
        </div>
        <div>
          <label for="workers">Workers</label>
          <input type="number" id="workers" min="1" max="10" value="2" />
        </div>
      </div>
      <div class="btns">
        <button class="btn-primary" id="btnStart" onclick="startRegister()">Start</button>
        <button class="btn-danger" id="btnStop" onclick="stopRegister()" disabled>Stop</button>
      </div>
      <div class="muted" style="margin-top:12px;" id="regStatus">idle</div>
      <div class="muted" style="margin-top:8px;" id="autoRegStatus">auto-register: —</div>
    </div>
  </details>

  <details class="panel" id="panelAccounts" data-panel="accounts">
    <summary>
      <span class="panel-title"><span class="chev">▸</span> Accounts table</span>
      <span class="panel-sum" id="sumAccounts">—</span>
    </summary>
    <div class="panel-body">
      <div class="toolbar" style="margin-bottom:8px;">
        <span class="muted" id="accFetched">—</span>
      </div>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Email</th><th>User ID</th><th>Expires</th>
              <th>Refresh</th><th>Blocked models</th><th>Quota / note</th><th>Status</th>
            </tr>
          </thead>
          <tbody id="accBody">
            <tr><td colspan="8" class="empty">loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </details>

  <details class="panel" id="panelLog" data-panel="log">
    <summary>
      <span class="panel-title"><span class="chev">▸</span> Registration log</span>
      <span class="panel-sum" id="sumLog">0 lines</span>
    </summary>
    <div class="panel-body">
      <div class="muted" id="logMeta" style="margin-bottom:8px;">0 lines</div>
      <div class="log" id="logBox">waiting for registration…</div>
    </div>
  </details>
</main>
```

Keep remaining utility CSS for `.form`, `button`, `.stat-row`, `.stat`, `.scroll`, `.tag`, `.log`, etc., adapted to light colors.

- [ ] **Step 5: Sanity-check static file serves**

```bash
# If server already running it serves the file from disk each request (no rebuild).
curl -sS 'http://127.0.0.1:8090/' | rg -n 'heroTotalUsd|chartMain|panelPool|Total equiv' | head
```

Expected: new ids present; old dark `#0b0f14` gone from response.

- [ ] **Step 6: Commit markup/CSS shell**

```bash
git add dashboard/index.html
git commit -m "feat(dashboard): white geek layout shell with hero and collapsible panels"
```

---

### Task 2: Wire hero cumulative USD, KPIs, single chart toggle, light chart theme

**Files:**
- Modify: `dashboard/index.html` `<script>` section

**Interfaces:**
- Consumes: `/api/usage` fields `latest.tokens_cum|tokens_cum_total`, `deltas`, `pricing`, `series`, `window_*`
- Produces:
  - `computeHeroUsd(data) -> { usd: number|null, tokens: number|null, mode: string }`
  - `setChartSeries(series: 'usd'|'tokens')`
  - `renderUsage(data)` updates hero + kpis + one canvas
  - `lastUsageData` retained for series toggle redraw without refetch

- [ ] **Step 1: Add state + hero compute helpers after existing formatters**

```javascript
let chartSeries = 'usd'; // 'usd' | 'tokens'
let lastUsageData = null;

function computeHeroUsd(data) {
  const latest = (data && data.latest) || {};
  const pricing = (data && data.pricing) || {};
  const blended = Number(pricing.usd_per_m_tokens != null ? pricing.usd_per_m_tokens : 5);
  const pin = Number(pricing.usd_input_per_m != null ? pricing.usd_input_per_m : 3);
  const pout = Number(pricing.usd_output_per_m != null ? pricing.usd_output_per_m : 15);
  const cum = Number(
    latest.tokens_cum_total != null ? latest.tokens_cum_total
      : (latest.tokens_cum != null ? latest.tokens_cum : NaN)
  );
  if (!Number.isFinite(cum) || cum < 0) {
    return { usd: null, tokens: null, mode: 'none', pin, pout, blended };
  }
  // per_15m latest prompt/comp are bucket deltas — do NOT use for hero.
  // Prefer blended on cumulative gateway tokens.
  const usd = (cum / 1e6) * blended;
  return { usd, tokens: cum, mode: 'blended_cum', pin, pout, blended };
}

function fmtUsdHero(n) {
  if (n == null || Number.isNaN(n)) return '—';
  n = Number(n);
  const abs = Math.abs(n);
  const opts = abs >= 100
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 4 };
  return '$' + n.toLocaleString('en-US', opts);
}
```

- [ ] **Step 2: Rewrite `renderUsage` for hero + single chart**

Replace body of `renderUsage` so that:

1. On `!data.ok`: set `heroTotalUsd` to `—`, clear KPIs, empty `chartMain`.
2. Always compute hero via `computeHeroUsd(data)` and set:
   - `heroTotalUsd` text = `fmtUsdHero(hero.usd)`
   - `heroSub` = `free-tier cash $0 · ${fmtTokens(hero.tokens)} tokens · blended $${hero.blended}/M (in $${hero.pin}/M · out $${hero.pout}/M)`
3. Secondary KPIs from `deltas` / `latest`:
   - `kpiWindowUsd` = `fmtUsd(deltas.delta_usd)`
   - `kpiRate` = `fmtUsd(deltas.rate_usd_per_hour)+'/h'`
   - `kpiDeltaTok` = `'+'+fmtTokens(deltas.delta_tokens)`
   - `kpiReq` = `ok/fail` from latest success/fail
   - leave `kpiPool` for accounts renderer (don't wipe to — if already set unless error)
4. Build `tokenPts` / `usdPts` as today.
5. Draw **only** `$('chartMain')` based on `chartSeries`:
   - usd: green `#16a34a` line, fill `rgba(22,163,74,0.12)`
   - tokens: accent `#0ea5e9` line, fill `rgba(14,165,233,0.12)`
6. Light chart chrome: pass opts so axis labels use `#64748b`, grid `#e5e7eb`, badge light fill.
7. Update `usageLegend` text for active series.
8. Keep usageNote content (adapt strings; remove refs to removed dual charts / old six stats).
9. `lastUsageData = data` at end of successful path.

Also update `drawLineChart` empty/label colors from dark `#8fa3b8` to `#64748b`, badge fill from dark to `rgba(255,255,255,0.95)` with border `#e5e7eb`, badge text `#0f172a`.

- [ ] **Step 3: Add `setChartSeries` and update `setUsageRange` unchanged except series buttons independent**

```javascript
function setChartSeries(s) {
  chartSeries = (s === 'tokens') ? 'tokens' : 'usd';
  document.querySelectorAll('#chartSeriesBtns button').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-series') === chartSeries);
  });
  if (lastUsageData) renderUsage(lastUsageData);
}
```

- [ ] **Step 4: Verify usage wiring against live API**

```bash
# Open browser http://127.0.0.1:8090 OR:
curl -sS 'http://127.0.0.1:8090/' | rg -n 'computeHeroUsd|chartMain|heroTotalUsd' | head
python3 - <<'PY'
import json,urllib.request
u=json.load(urllib.request.urlopen('http://127.0.0.1:8090/api/usage?range=24h'))
lat=u['latest']; pr=u['pricing']; cum=lat.get('tokens_cum_total') or lat.get('tokens_cum') or 0
blended=pr.get('usd_per_m_tokens',5)
print('expected_hero', round(cum/1e6*blended, 4))
print('window', u['deltas'])
PY
```

Manually confirm page hero matches `expected_hero` (± rounding). Switching 1h/24h must not change hero; window KPI must change.

- [ ] **Step 5: Commit**

```bash
git add dashboard/index.html
git commit -m "feat(dashboard): hero cumulative USD and single light usage chart"
```

---

### Task 3: Services strip, collapse persistence, summary lines, auto-expand on running

**Files:**
- Modify: `dashboard/index.html` `<script>` render functions

**Interfaces:**
- Produces: `initPanels()`, `setPanelOpen(key, open)`, `updatePanelSummaries()`
- Consumes localStorage key prefix `dash.panel.`

- [ ] **Step 1: Replace `renderServices` chip layout**

```javascript
function renderServices(data) {
  const list = $('svcList');
  if (!data || !data.services) {
    list.innerHTML = '<div class="empty">failed to load</div>';
    return;
  }
  list.innerHTML = data.services.map(s => {
    const cls = s.ok ? 'ok' : (s.critical ? 'bad' : 'warn');
    const lat = s.ok ? (s.latency_ms + 'ms') : 'down';
    return `<div class="svc-chip" title="${escapeHtml(s.desc || '')}">
      <span class="dot ${cls}"></span>
      <span class="name">${escapeHtml(s.name)}</span>
      <span class="lat">${lat}</span>
    </div>`;
  }).join('');
  setOverall(data.ok, data.ok ? 'all critical up' : 'service down');
  $('lastRefresh').textContent = 'updated ' + fmtAge(data.checked_at);
}
```

- [ ] **Step 2: Panel persistence + auto-open helpers**

```javascript
const PANEL_KEYS = ['pool', 'reg', 'accounts', 'log'];

function panelEl(key) {
  return document.querySelector('details.panel[data-panel="' + key + '"]');
}

function initPanels() {
  PANEL_KEYS.forEach(key => {
    const el = panelEl(key);
    if (!el) return;
    const saved = localStorage.getItem('dash.panel.' + key);
    if (saved === '1') el.open = true;
    if (saved === '0') el.open = false;
    el.addEventListener('toggle', () => {
      localStorage.setItem('dash.panel.' + key, el.open ? '1' : '0');
    });
  });
}

function ensurePanelOpen(key) {
  const el = panelEl(key);
  if (el && !el.open) el.open = true;
}
```

Call `initPanels()` once before first `tick()`.

- [ ] **Step 3: Update `renderAccounts` / `renderRegister` summaries + kpiPool**

In `renderAccounts` after computing `total`, `okN`, `blockedN`:

```javascript
if ($('kpiPool')) $('kpiPool').textContent = okN + '/' + blockedN;
if ($('sumPool')) $('sumPool').textContent = total + ' total · ' + okN + ' ok · ' + blockedN + ' blocked';
if ($('sumAccounts')) $('sumAccounts').textContent = total + ' rows';
```

In `renderRegister`:

```javascript
if ($('sumReg')) $('sumReg').textContent = text;
if ($('sumLog')) $('sumLog').textContent = (st.log_line_count || 0) + ' lines';
if (running) {
  ensurePanelOpen('reg');
  ensurePanelOpen('log');
}
```

Keep existing button enable/log rendering.

- [ ] **Step 4: Manual verification checklist**

1. Load `http://127.0.0.1:8090` — white bg, huge `$`, services chips, one chart.
2. Toggle USD/Tokens — chart redraws without full page reload.
3. Toggle range 1h vs 24h — hero stable; window KPI changes.
4. Collapse/expand panels; reload page — open state restored from localStorage.
5. If registration idle, panels stay as saved; if you start a job, reg+log open.

```bash
curl -sS 'http://127.0.0.1:8090/' | rg -n 'svc-chip|dash.panel|ensurePanelOpen|hero-amount' | head
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/index.html
git commit -m "feat(dashboard): compact services and collapsible panel UX"
```

---

### Task 4: End-to-end verification + optional backend totals only if needed

**Files:**
- Modify only if needed: `dashboard/server.py` (`api_usage` return payload)

- [ ] **Step 1: Full API + UI field presence check**

```bash
python3 - <<'PY'
import re, urllib.request
html = urllib.request.urlopen('http://127.0.0.1:8090/').read().decode()
for id_ in ['heroTotalUsd','kpiWindowUsd','kpiRate','kpiDeltaTok','kpiPool','kpiReq','chartMain','svcList','panelPool','panelReg','panelAccounts','panelLog']:
    assert f'id="{id_}"' in html or f"id='{id_}'" in html, id_
assert '#0b0f14' not in html
assert 'hero-amount' in html
print('html ok')
u = __import__('json').loads(urllib.request.urlopen('http://127.0.0.1:8090/api/usage?range=24h').read())
assert u.get('ok')
cum = (u.get('latest') or {}).get('tokens_cum') or (u.get('latest') or {}).get('tokens_cum_total')
assert cum is not None
print('usage ok cum', cum, 'delta_usd', (u.get('deltas') or {}).get('delta_usd'))
PY
```

Expected: prints `html ok` and `usage ok …`.

- [ ] **Step 2: If hero would be null (no tokens_cum), add server `totals`**

Only then, in `api_usage` response dict, add:

```python
"totals": {
    "tokens_cum": int(last_cum),
    "usd_equiv_cum": round(_tokens_to_usd(last_cum, GROK_USD_PER_MTOKENS), 4),
    "price_mode": "blended",
}
```

And in `computeHeroUsd`, prefer `data.totals.usd_equiv_cum` if present.

- [ ] **Step 3: Final commit if any server change; otherwise skip**

```bash
git status -sb
# commit only if server.py changed
```

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| White geek palette | Task 1 |
| Large cumulative USD hero | Task 2 |
| Secondary KPIs window/$/hr/tokens/pool/req | Task 2–3 |
| Compact services | Task 3 |
| Single chart + toggle | Task 2 |
| Collapsible secondary modules | Task 1 markup + Task 3 |
| localStorage panel state | Task 3 |
| Auto-open reg/log when running | Task 3 |
| Range does not change hero | Task 2 |
| Keep APIs/poll loops | all tasks (no contract break) |
| Optional server totals | Task 4 |

## Placeholder / consistency self-review

- No TBD steps; DOM ids named consistently across tasks.
- Chart id is `chartMain` everywhere (not dual `chartTokens`/`chartUsd`).
- Hero uses `tokens_cum` / `tokens_cum_total` only, never per-bucket prompt/comp.

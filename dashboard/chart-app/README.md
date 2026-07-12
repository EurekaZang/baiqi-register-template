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

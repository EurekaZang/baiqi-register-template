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

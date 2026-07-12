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

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

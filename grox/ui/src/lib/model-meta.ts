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

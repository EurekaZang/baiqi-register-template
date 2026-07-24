import fs from 'node:fs'
import path from 'node:path'

export type GroxConfig = {
  baseUrl?: string
  apiKey?: string
  defaultModel?: string
}

const DEFAULT_BASE_URL = 'https://kaggleyes.top/grokapi'

export function configPath(userDataDir: string): string {
  return path.join(userDataDir, 'config.json')
}

export function loadConfig(userDataDir: string): GroxConfig {
  const file = configPath(userDataDir)
  try {
    if (!fs.existsSync(file)) return {}
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object') return {}
    const obj = raw as Record<string, unknown>
    const out: GroxConfig = {}
    if (typeof obj.baseUrl === 'string' && obj.baseUrl.trim()) {
      out.baseUrl = obj.baseUrl.trim().replace(/\/+$/, '')
    }
    if (typeof obj.apiKey === 'string') {
      out.apiKey = obj.apiKey
    }
    if (typeof obj.defaultModel === 'string' && obj.defaultModel.trim()) {
      out.defaultModel = obj.defaultModel.trim()
    }
    return out
  } catch {
    return {}
  }
}

export function saveConfig(userDataDir: string, patch: GroxConfig): GroxConfig {
  const current = loadConfig(userDataDir)
  const next: GroxConfig = { ...current }
  if (patch.baseUrl !== undefined) {
    const v = patch.baseUrl.trim().replace(/\/+$/, '')
    if (v) next.baseUrl = v
  }
  if (patch.apiKey !== undefined) {
    next.apiKey = patch.apiKey
  }
  if (patch.defaultModel !== undefined) {
    const v = patch.defaultModel.trim()
    if (v) next.defaultModel = v
  }
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(configPath(userDataDir), JSON.stringify(next, null, 2), 'utf8')
  return next
}

export function resolvedBaseUrl(cfg: GroxConfig): string {
  return (cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

/**
 * Grox Windows packaging pipeline.
 *
 * 1) Build UI (Vite) → ui/dist
 * 2) Copy ui/dist → agent/static (served by packaged FastAPI sidecar)
 * 3) Expect prebuilt agent/dist/agent-sidecar (PyInstaller onedir)
 * 4) Build Electron main/preload (tsc)
 * 5) electron-builder --win (NSIS)
 *
 * Final NSIS installer must be produced on a real Windows host (or CI
 * windows-latest). Wine-based builds are optional/unsupported for ship.
 *
 * Sidecar (run on Windows before this script, or in the same Windows job):
 *   cd agent
 *   .venv\Scripts\pip install -r requirements.txt pyinstaller
 *   .venv\Scripts\pyinstaller build_sidecar.spec --noconfirm
 *   → agent/dist/agent-sidecar/
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'

function run(cmd, args, opts = {}) {
  console.log(`[build-win] $ ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: isWin,
    env: process.env,
    ...opts,
  })
  if (r.error) throw r.error
  if (r.status !== 0) {
    process.exit(r.status ?? 1)
  }
}

function rimraf(p) {
  fs.rmSync(p, { recursive: true, force: true })
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  fs.cpSync(src, dest, { recursive: true })
}

// 1) UI
run('npm', ['run', 'build', '-w', 'grox-ui'])

// 2) ui/dist → agent/static
const uiDist = path.join(root, 'ui', 'dist')
const agentStatic = path.join(root, 'agent', 'static')
if (!fs.existsSync(path.join(uiDist, 'index.html'))) {
  console.error(`[build-win] missing ${uiDist}/index.html — UI build failed?`)
  process.exit(1)
}
rimraf(agentStatic)
copyDir(uiDist, agentStatic)
console.log(`[build-win] copied ui/dist → agent/static`)

// 3) Sidecar prebuilt check
const sidecarDir = path.join(root, 'agent', 'dist', 'agent-sidecar')
const sidecarBin = path.join(
  sidecarDir,
  isWin ? 'agent-sidecar.exe' : 'agent-sidecar',
)
const sidecarNested = path.join(
  sidecarDir,
  'agent-sidecar',
  isWin ? 'agent-sidecar.exe' : 'agent-sidecar',
)
if (!fs.existsSync(sidecarDir)) {
  console.warn(
    [
      '[build-win] WARNING: agent/dist/agent-sidecar not found.',
      '  Build the sidecar on Windows before packaging:',
      '    cd agent',
      '    .venv\\Scripts\\pyinstaller build_sidecar.spec --noconfirm',
      '  Continuing; electron-builder extraResources may be empty/incomplete.',
    ].join('\n'),
  )
} else if (!fs.existsSync(sidecarBin) && !fs.existsSync(sidecarNested)) {
  console.warn(
    `[build-win] WARNING: no agent-sidecar binary under ${sidecarDir}`,
  )
} else {
  console.log(`[build-win] found sidecar at ${sidecarDir}`)
}

// 4) Electron tsc
run('npm', ['run', 'build', '-w', 'electron'])

// 5) electron-builder
const builderArgs = [
  'electron-builder',
  '--win',
  '--x64',
  '--config',
  'electron-builder.yml',
]
if (!isWin) {
  console.warn(
    [
      '[build-win] NOTE: not running on Windows.',
      '  Final ship-quality NSIS should be built on Windows 11 / windows-latest CI.',
      '  electron-builder may still emit artifacts via wine if configured; prefer native Win.',
    ].join('\n'),
  )
}

// Prefer local workspace install; fall back to npx
const localBin = path.join(
  root,
  'node_modules',
  '.bin',
  isWin ? 'electron-builder.cmd' : 'electron-builder',
)
if (fs.existsSync(localBin)) {
  run(localBin, builderArgs.slice(1))
} else {
  run('npx', ['--yes', ...builderArgs])
}

console.log('[build-win] done — see grox/release/')

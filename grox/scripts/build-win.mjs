/**
 * Grox Windows packaging pipeline.
 *
 * Order (static must land in agent/static BEFORE PyInstaller embeds it):
 * 1) Build UI (Vite) → ui/dist
 * 2) Copy ui/dist → agent/static
 * 3) Sidecar:
 *      - if GROX_RUN_PYINSTALLER=1 → run pyinstaller build_sidecar.spec
 *      - else require prebuilt agent/dist/agent-sidecar (+ binary); exit 1 if missing
 * 4) Build Electron main/preload (tsc)
 * 5) electron-builder --win (NSIS)
 *
 * Final NSIS installer must be produced on a real Windows host (or CI
 * windows-latest). Wine-based builds are optional/unsupported for ship.
 *
 * Two-phase (default):
 *   # after step 1–2 half, or manually:
 *   cd agent && .venv\Scripts\pyinstaller build_sidecar.spec --noconfirm
 *   npm run build:win
 *
 * One-shot (Windows, venv ready):
 *   set GROX_RUN_PYINSTALLER=1
 *   npm run build:win
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const runPyinstaller = process.env.GROX_RUN_PYINSTALLER === '1'

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

// 2) ui/dist → agent/static  (must precede PyInstaller so SPA is embedded)
const uiDist = path.join(root, 'ui', 'dist')
const agentStatic = path.join(root, 'agent', 'static')
if (!fs.existsSync(path.join(uiDist, 'index.html'))) {
  console.error(`[build-win] missing ${uiDist}/index.html — UI build failed?`)
  process.exit(1)
}
rimraf(agentStatic)
copyDir(uiDist, agentStatic)
console.log(`[build-win] copied ui/dist → agent/static`)

// 3) Sidecar: optional PyInstaller, else require prebuilt (fail hard)
const agentDir = path.join(root, 'agent')
const sidecarDir = path.join(agentDir, 'dist', 'agent-sidecar')
const binName = isWin ? 'agent-sidecar.exe' : 'agent-sidecar'
const sidecarBin = path.join(sidecarDir, binName)
const sidecarNested = path.join(sidecarDir, 'agent-sidecar', binName)

function sidecarBinaryExists() {
  return fs.existsSync(sidecarBin) || fs.existsSync(sidecarNested)
}

if (runPyinstaller) {
  console.log(
    '[build-win] GROX_RUN_PYINSTALLER=1 — building sidecar after static copy',
  )
  const pyinstaller = path.join(
    agentDir,
    '.venv',
    isWin ? 'Scripts' : 'bin',
    isWin ? 'pyinstaller.exe' : 'pyinstaller',
  )
  const pyCmd = fs.existsSync(pyinstaller) ? pyinstaller : 'pyinstaller'
  run(pyCmd, ['build_sidecar.spec', '--noconfirm'], { cwd: agentDir })
}

if (!fs.existsSync(sidecarDir) || !sidecarBinaryExists()) {
  console.error(
    [
      '[build-win] FATAL: agent/dist/agent-sidecar binary missing.',
      '  PyInstaller must run AFTER ui/dist is copied into agent/static',
      '  so the SPA is embedded in the sidecar bundle.',
      '',
      '  Two-phase (recommended):',
      '    1) npm run build:ui && node -e "/* or re-run build:win until this gate */"',
      '       (build:win already builds UI + copies static first)',
      '    2) cd agent',
      '       .venv\\\\Scripts\\\\pyinstaller build_sidecar.spec --noconfirm   # Windows',
      '       # or: .venv/bin/pyinstaller build_sidecar.spec --noconfirm     # Linux smoke only',
      '    3) npm run build:win   # re-runs UI+static, then electron-builder',
      '',
      '  One-shot on Windows with venv+pyinstaller installed:',
      '    set GROX_RUN_PYINSTALLER=1',
      '    npm run build:win',
      '',
      `  Expected: ${sidecarBin}`,
      `       or: ${sidecarNested}`,
    ].join('\n'),
  )
  process.exit(1)
}
console.log(`[build-win] found sidecar at ${sidecarDir}`)

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

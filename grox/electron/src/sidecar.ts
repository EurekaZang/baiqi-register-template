import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { app } from 'electron'

export type SidecarHandle = {
  proc: ChildProcessWithoutNullStreams | null
  port: number
  token: string
  spawned: boolean
}

export type StartSidecarOpts = {
  port: number
  token: string
  dataDir: string
  baseUrl?: string
  apiKey?: string
  /** Absolute path to grox/ monorepo root (dev). */
  projectRoot?: string
  /** Prefer attaching to an already-running agent (no spawn). */
  attachOnly?: boolean
}

function packagedSidecarBinary(): string {
  const base = path.join(process.resourcesPath, 'sidecar')
  const name = process.platform === 'win32' ? 'agent-sidecar.exe' : 'agent-sidecar'
  // onedir layout: resources/sidecar/agent-sidecar[.exe]
  const direct = path.join(base, name)
  if (fs.existsSync(direct)) return direct
  // nested onedir: resources/sidecar/agent-sidecar/agent-sidecar[.exe]
  const nested = path.join(base, 'agent-sidecar', name)
  return nested
}

function devPython(projectRoot: string): string | null {
  const venvPy =
    process.platform === 'win32'
      ? path.join(projectRoot, 'agent', '.venv', 'Scripts', 'python.exe')
      : path.join(projectRoot, 'agent', '.venv', 'bin', 'python')
  if (fs.existsSync(venvPy)) return venvPy
  return null
}

function buildEnv(opts: StartSidecarOpts): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GROX_CHAT_HOST: '127.0.0.1',
    GROX_CHAT_PORT: String(opts.port),
    GROX_CHAT_TOKEN: opts.token,
    GROX_DATA_DIR: opts.dataDir,
    GROX_ANTHROPIC_BASE_URL: opts.baseUrl || 'https://kaggleyes.top/grokapi',
    GROX_ANTHROPIC_API_KEY: opts.apiKey || '',
    // Also set unprefixed forms some SDK paths read
    ANTHROPIC_BASE_URL: opts.baseUrl || 'https://kaggleyes.top/grokapi',
    ANTHROPIC_API_KEY: opts.apiKey || '',
  }
}

function pipeLogs(proc: ChildProcessWithoutNullStreams, label: string): void {
  proc.stdout.on('data', (buf: Buffer) => {
    console.log(`[${label}] ${buf.toString('utf8').trimEnd()}`)
  })
  proc.stderr.on('data', (buf: Buffer) => {
    console.error(`[${label}] ${buf.toString('utf8').trimEnd()}`)
  })
  proc.on('exit', (code, signal) => {
    console.log(`[${label}] exit code=${code} signal=${signal}`)
  })
}

/**
 * Start packaged sidecar binary, or in dev spawn agent venv python.
 * If attachOnly / no binary / no venv: wait for external agent health only.
 */
export async function startSidecar(opts: StartSidecarOpts): Promise<SidecarHandle> {
  const isDev = !app.isPackaged
  const env = buildEnv(opts)
  let proc: ChildProcessWithoutNullStreams | null = null
  let spawned = false

  if (opts.attachOnly) {
    await waitHealth(opts.port, 30_000)
    return { proc: null, port: opts.port, token: opts.token, spawned: false }
  }

  if (!isDev) {
    const bin = packagedSidecarBinary()
    if (!fs.existsSync(bin)) {
      throw new Error(`Packaged sidecar binary missing: ${bin}`)
    }
    proc = spawn(bin, ['--host', '127.0.0.1', '--port', String(opts.port)], {
      env,
      stdio: 'pipe',
      windowsHide: true,
    })
    spawned = true
    pipeLogs(proc, 'sidecar')
  } else {
    const root = opts.projectRoot
    const py = root ? devPython(root) : null
    if (py && root) {
      // Prefer non-reload uvicorn so the supervisor owns a single process tree.
      const agentDir = path.join(root, 'agent')
      proc = spawn(
        py,
        ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(opts.port)],
        {
          cwd: agentDir,
          env,
          stdio: 'pipe',
          windowsHide: true,
        },
      )
      spawned = true
      pipeLogs(proc, 'agent')
    } else {
      console.warn(
        '[sidecar] Dev venv python not found; waiting for external agent on port',
        opts.port,
      )
    }
  }

  if (proc) {
    proc.on('error', (err) => {
      console.error('[sidecar] spawn error', err)
    })
  }

  try {
    await waitHealth(opts.port, 30_000)
  } catch (err) {
    if (proc) stopSidecar({ proc, port: opts.port, token: opts.token, spawned })
    throw err
  }

  return { proc, port: opts.port, token: opts.token, spawned }
}

export function stopSidecar(handle: SidecarHandle | null | undefined): void {
  if (!handle?.proc || handle.proc.killed) return
  const proc = handle.proc
  const pid = proc.pid
  if (!pid) return

  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } catch {
      try {
        proc.kill()
      } catch {
        /* ignore */
      }
    }
    return
  }

  try {
    proc.kill('SIGTERM')
  } catch {
    /* ignore */
  }
  const killer = setTimeout(() => {
    try {
      if (!proc.killed) proc.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }, 2500)
  killer.unref?.()
}

export function waitHealth(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        res.resume()
        if (res.statusCode === 200) resolve()
        else retry()
      })
      req.on('error', retry)
      req.setTimeout(1500, () => {
        req.destroy()
        retry()
      })
    }
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`sidecar health timeout after ${timeoutMs}ms (port ${port})`))
      } else {
        setTimeout(tick, 200)
      }
    }
    tick()
  })
}

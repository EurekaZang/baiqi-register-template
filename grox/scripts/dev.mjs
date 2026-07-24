import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const agentPy =
  process.platform === 'win32'
    ? path.join(root, 'agent', '.venv', 'Scripts', 'python.exe')
    : path.join(root, 'agent', '.venv', 'bin', 'python')

const env = {
  ...process.env,
  GROX_DATA_DIR: process.env.GROX_DATA_DIR || path.join(root, '.dev-data'),
  GROX_CHAT_TOKEN: process.env.GROX_CHAT_TOKEN || 'grox-local-token',
  GROX_CHAT_PORT: process.env.GROX_CHAT_PORT || '17890',
}

// Workspace package name is grox-ui (path: ui/). Prefer package name for -w.
const agent = spawn(agentPy, ['run_dev.py'], {
  cwd: path.join(root, 'agent'),
  env,
  stdio: 'inherit',
})
const ui = spawn('npm', ['run', 'dev', '-w', 'grox-ui'], {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

const kill = () => {
  agent.kill('SIGTERM')
  ui.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGINT', kill)
process.on('SIGTERM', kill)

agent.on('exit', (code, signal) => {
  if (signal) return
  if (code && code !== 0) {
    console.error(`[grox:dev] agent exited with code ${code}`)
    ui.kill('SIGTERM')
    process.exit(code)
  }
})
ui.on('exit', (code, signal) => {
  if (signal) return
  if (code && code !== 0) {
    console.error(`[grox:dev] ui exited with code ${code}`)
    agent.kill('SIGTERM')
    process.exit(code)
  }
})

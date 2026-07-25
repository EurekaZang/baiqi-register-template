import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { loadConfig, resolvedBaseUrl } from './config-store'
import { startSidecar, stopSidecar, type SidecarHandle } from './sidecar'

const PREFERRED_PORT = 17890

let mainWindow: BrowserWindow | null = null
let sidecar: SidecarHandle | null = null
let localToken = ''
let apiPort = PREFERRED_PORT
let dataDir = ''
let defaultCwd = ''
let quitting = false

function projectRoot(): string {
  // dist/main.js → electron/ → grox/
  return path.resolve(__dirname, '..', '..')
}

function findFreePort(preferred: number): Promise<number> {
  const tryPort = (port: number, allowFallback: boolean): Promise<number> =>
    new Promise((resolve, reject) => {
      const server = net.createServer()
      server.unref()
      server.on('error', (err: NodeJS.ErrnoException) => {
        if (allowFallback && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
          // Ephemeral port
          tryPort(0, false).then(resolve, reject)
          return
        }
        reject(err)
      })
      server.listen(port, '127.0.0.1', () => {
        const addr = server.address()
        const resolved =
          typeof addr === 'object' && addr && typeof addr.port === 'number' ? addr.port : port
        server.close((closeErr) => {
          if (closeErr) reject(closeErr)
          else resolve(resolved)
        })
      })
    })
  return tryPort(preferred, true)
}

function ensureDataDir(userData: string): string {
  const dir = userData
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true })
  return dir
}

function registerIpc(): void {
  ipcMain.handle('grox:selectFolder', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow
    const opts: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select workspace folder',
    }
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('grox:openDataDir', async () => {
    if (!dataDir) return
    await shell.openPath(dataDir)
  })

  ipcMain.handle('grox:getVersion', async () => {
    return app.getVersion()
  })

  ipcMain.on('grox:window-minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle('grox:window-toggle-maximize', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })

  ipcMain.on('grox:window-close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('grox:window-is-maximized', async (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  // Optional debug / future UI — not required by contract
  ipcMain.handle('grox:apiBase', async () => {
    return `http://127.0.0.1:${apiPort}`
  })
  ipcMain.handle('grox:token', async () => localToken)
}

async function createWindow(): Promise<void> {
  const preloadPath = path.join(__dirname, 'preload.js')
  const origin = `http://127.0.0.1:${apiPort}`
  const devUrl = process.env.GROX_DEV_URL?.trim()

  // When loading Vite, leave apiBase empty so UI uses relative /api → Vite proxy.
  // Packaged / agent-served SPA: inject absolute origin for one-origin + explicit base.
  const exposedApiBase = devUrl ? '' : origin

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'Grox',
    frame: false,
    autoHideMenuBar: true,
    hasShadow: true,
    roundedCorners: true,
    backgroundColor: '#080808',
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [
        `--grox-api-base=${exposedApiBase}`,
        `--grox-token=${localToken}`,
        `--grox-default-cwd=${defaultCwd}`,
      ],
    },
  })
  mainWindow.setMenu(null)

  const publishMaximizedState = () => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(
      'grox:window-maximized-changed',
      mainWindow.isMaximized(),
    )
  }
  mainWindow.on('maximize', publishMaximizedState)
  mainWindow.on('unmaximize', publishMaximizedState)

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const target = devUrl || `${origin}/`
  await mainWindow.loadURL(target)
}

async function boot(): Promise<void> {
  Menu.setApplicationMenu(null)
  dataDir = ensureDataDir(app.getPath('userData'))
  defaultCwd = path.join(app.getPath('documents'), 'Grox Workspace')
  fs.mkdirSync(defaultCwd, { recursive: true })
  const cfg = loadConfig(dataDir)
  localToken = crypto.randomBytes(24).toString('hex')

  // Vite proxy is fixed at 17890; when using GROX_DEV_URL pin to that port
  // (or GROX_CHAT_PORT) so relative /api hits the sidecar we spawn/attach.
  const devUrl = process.env.GROX_DEV_URL?.trim()
  const preferred = Number(process.env.GROX_CHAT_PORT || PREFERRED_PORT) || PREFERRED_PORT
  if (devUrl) {
    apiPort = preferred
  } else {
    apiPort = await findFreePort(preferred)
  }

  const attachOnly = process.env.GROX_ATTACH_ONLY === '1'
  const baseUrl = resolvedBaseUrl(cfg)
  const apiKey = cfg.apiKey || ''

  sidecar = await startSidecar({
    port: apiPort,
    token: localToken,
    dataDir,
    baseUrl,
    apiKey,
    projectRoot: projectRoot(),
    attachOnly,
  })

  registerIpc()
  await createWindow()
}

app.whenReady().then(() => {
  boot().catch((err) => {
    console.error('[grox] boot failed', err)
    dialog.showErrorBox(
      'Grox failed to start',
      err instanceof Error ? err.message : String(err),
    )
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((err) => console.error(err))
    }
  })
})

app.on('before-quit', () => {
  quitting = true
  stopSidecar(sidecar)
  sidecar = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (!quitting) app.quit()
  }
})

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

/**
 * Values are passed from main via additionalArguments so apiBase/token are
 * plain strings (UI `api.ts` treats apiBase as a string origin, not a function).
 */
function argValue(name: string): string | undefined {
  const prefix = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(prefix))
  if (!hit) return undefined
  return hit.slice(prefix.length)
}

const apiBase = argValue('grox-api-base') ?? ''
const token = argValue('grox-token') ?? ''
const defaultCwd = argValue('grox-default-cwd') ?? ''

contextBridge.exposeInMainWorld('grox', {
  /** Origin only, e.g. http://127.0.0.1:17890 — empty in Vite-proxy dev. */
  apiBase,
  /** Local loopback chat token (string). */
  token,
  /** Ready-to-use workspace created under the current user's Documents folder. */
  defaultCwd,
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('grox:selectFolder'),
  openDataDir: (): Promise<void> => ipcRenderer.invoke('grox:openDataDir'),
  getVersion: (): Promise<string> => ipcRenderer.invoke('grox:getVersion'),
  windowControls: {
    minimize: (): void => ipcRenderer.send('grox:window-minimize'),
    toggleMaximize: (): Promise<boolean> =>
      ipcRenderer.invoke('grox:window-toggle-maximize'),
    close: (): void => ipcRenderer.send('grox:window-close'),
    isMaximized: (): Promise<boolean> =>
      ipcRenderer.invoke('grox:window-is-maximized'),
    onMaximizedChange: (callback: (maximized: boolean) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, maximized: unknown) => {
        callback(Boolean(maximized))
      }
      ipcRenderer.on('grox:window-maximized-changed', listener)
      return () => {
        ipcRenderer.removeListener('grox:window-maximized-changed', listener)
      }
    },
  },
})

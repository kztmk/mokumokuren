import { ipcMain, type BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { CHANNELS } from '../shared/channels'

// Update flow for macOS only — distributed via GitHub Releases (the publish target in
// electron-builder.yml). Windows is distributed via the Microsoft Store, which manages its own
// updates, so in-app updates are intentionally mac-only.
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'
  | 'unsupported'

type UpdateStatus = { state: UpdateState; version?: string; percent?: number; message?: string }

const supported = process.platform === 'darwin'

let win: BrowserWindow | null = null
let initialized = false

function send(status: UpdateStatus): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(CHANNELS.UPDATE_STATUS, status)
}

// Wire IPC + autoUpdater listeners once, and run the startup check. Safe to call again on window
// re-create (macOS): it just refreshes the window reference.
export function setupAutoUpdate(window: BrowserWindow): void {
  win = window
  if (initialized) return
  initialized = true

  // Manual "check for updates" from the renderer.
  ipcMain.handle(CHANNELS.CHECK_FOR_UPDATES, (event) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return
    // In-app updates only apply to packaged macOS builds; the Store handles Windows, and dev has
    // no update feed.
    if (!supported || is.dev) {
      send({ state: 'unsupported' })
      return
    }
    send({ state: 'checking' })
    autoUpdater.checkForUpdates().catch((err) => send({ state: 'error', message: String(err) }))
  })

  // Restart now to apply a downloaded update.
  ipcMain.handle(CHANNELS.QUIT_AND_INSTALL, (event) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return
    autoUpdater.quitAndInstall()
  })

  if (!supported || is.dev) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => send({ state: 'not-available' }))
  autoUpdater.on('download-progress', (p) =>
    send({ state: 'downloading', percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) =>
    send({ state: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (err) => send({ state: 'error', message: String(err?.message ?? err) }))

  // The startup check is triggered by the renderer (App mount → CHECK_FOR_UPDATES) once its
  // UPDATE_STATUS listener is registered, so the initial `checking`/result isn't sent before the
  // renderer can receive it. autoDownload then fetches any available update in the background.
}

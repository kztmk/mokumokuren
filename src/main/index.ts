import { app, shell, BrowserWindow, ipcMain, WebContentsView, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

const SNS_VIEWS = [
  { partition: 'persist:x-proto', url: 'https://x.com' },
  { partition: 'persist:bluesky-proto', url: 'https://bsky.app' },
  { partition: 'persist:threads-proto', url: 'https://www.threads.net' },
]

const CHROME_UA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`

const SIDEBAR_W = 72
const HEADER_H = 40

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  const views: WebContentsView[] = SNS_VIEWS.map(({ partition, url }) => {
    const ses = session.fromPartition(partition)
    ses.setUserAgent(CHROME_UA)
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        allowRunningInsecureContent: false,
      },
    })
    win.contentView.addChildView(view)
    view.webContents.loadURL(url)
    return view
  })

  function layoutViews(): void {
    const { width, height } = win.getContentBounds()
    const colW = Math.max(320, Math.floor((width - SIDEBAR_W) / 3))
    views.forEach((v, i) =>
      v.setBounds({
        x: SIDEBAR_W + i * colW,
        y: HEADER_H,
        width: colW,
        height: height - HEADER_H,
      })
    )
  }

  win.on('resize', layoutViews)

  win.on('ready-to-show', () => {
    win.show()
    layoutViews()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

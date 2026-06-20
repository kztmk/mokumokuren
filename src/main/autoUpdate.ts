import { dialog } from 'electron'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'

// Startup update check for macOS, against the GitHub Releases feed configured as the publish
// target in electron-builder.yml. Windows is distributed via the Microsoft Store, which manages
// its own updates, so this is intentionally mac-only. Skipped in dev (no signed app / update feed).
export function initAutoUpdate(): void {
  if (is.dev || process.platform !== 'darwin') return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (err) => {
    console.error('[autoUpdater] error:', err)
  })

  // When an update has been downloaded, offer to restart now (otherwise it installs on next quit).
  autoUpdater.on('update-downloaded', (info) => {
    void dialog
      .showMessageBox({
        type: 'info',
        buttons: ['今すぐ再起動', '後で'],
        defaultId: 0,
        cancelId: 1,
        title: 'アップデート',
        message: `新しいバージョン ${info.version} を準備しました`,
        detail: '再起動して更新を適用しますか？（「後で」を選ぶと次回起動時に適用されます）',
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall()
      })
  })

  // Check once at startup; autoDownload fetches it, then the update-downloaded handler prompts.
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[autoUpdater] check failed:', err)
  })
}

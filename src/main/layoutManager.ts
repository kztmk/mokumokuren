import type { BrowserWindow } from 'electron'
import type { ColumnLayoutSnapshot } from '../renderer/src/services'
import { getOrderedViews } from './columnManager'

const SIDEBAR_W = 72
const HEADER_H = 40
const BORDER_W = 2 // active border inset px

let currentWindow: BrowserWindow | null = null
let snapshot: ColumnLayoutSnapshot = {
  columns: [],
  sidebarW: SIDEBAR_W,
  headerH: HEADER_H,
}

export function initLayoutManager(win: BrowserWindow): void {
  currentWindow = win
  win.on('resize', () => applyLayout())
}

export function applyLayout(): void {
  if (!currentWindow || currentWindow.isDestroyed()) return

  const managedViews = getOrderedViews()
  const columnCount = managedViews.length

  // No columns: publish an empty snapshot so the renderer can clear its layout (e.g. after the
  // last column is hidden/removed). The early `return` of the previous design left the renderer
  // showing stale columns.
  if (columnCount === 0) {
    snapshot = { columns: [], sidebarW: SIDEBAR_W, headerH: HEADER_H }
    if (!currentWindow.webContents.isDestroyed()) {
      currentWindow.webContents.send('column-layout', snapshot)
    }
    return
  }

  const [winContentWidth, winContentHeight] = currentWindow.getContentSize()
  const colW = Math.max(320, Math.floor((winContentWidth - SIDEBAR_W) / columnCount))
  const height = Math.max(0, winContentHeight - HEADER_H)

  const columns = managedViews.map(({ view, descriptor }, index) => {
    const x = SIDEBAR_W + index * colW
    view.setBounds({
      x: x + BORDER_W,
      y: HEADER_H + BORDER_W,
      width: Math.max(0, colW - 2 * BORDER_W),
      height: Math.max(0, height - 2 * BORDER_W),
    })

    return {
      ...descriptor,
      x,
      width: colW,
      height: winContentHeight,
      borderW: BORDER_W,
    }
  })

  snapshot = {
    columns,
    sidebarW: SIDEBAR_W,
    headerH: HEADER_H,
  }

  if (!currentWindow.webContents.isDestroyed()) {
    currentWindow.webContents.send('column-layout', snapshot)
  }
}

export function getSnapshot(): ColumnLayoutSnapshot {
  return snapshot
}

// WebContentsView はレンダラー DOM の上に合成されるため、AI パネル等の DOM オーバーレイを前面に
// 出すには全カラムの view を一時的に非表示にする必要がある。再表示時はレイアウトを再適用する。
export function setColumnsVisible(visible: boolean): void {
  for (const { view } of getOrderedViews()) {
    if (!view.webContents.isDestroyed()) view.setVisible(visible)
  }
  if (visible) applyLayout()
}

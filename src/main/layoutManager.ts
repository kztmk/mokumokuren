import type { BrowserWindow, WebContentsView } from 'electron'
import type { ColumnDescriptor, ColumnLayoutSnapshot } from '../renderer/src/services'

const SIDEBAR_W = 72
const HEADER_H = 40

type ManagedView = {
  view: WebContentsView
  descriptor: Omit<ColumnDescriptor, 'x' | 'width'>
}

let currentWindow: BrowserWindow | null = null
let managedViews: ManagedView[] = []
let snapshot: ColumnLayoutSnapshot = {
  columns: [],
  sidebarW: SIDEBAR_W,
  headerH: HEADER_H,
}

export function initLayoutManager(win: BrowserWindow, views: ManagedView[]): void {
  currentWindow = win
  managedViews = views

  applyLayout()
  win.on('resize', () => applyLayout())
}

export function applyLayout(): void {
  if (!currentWindow) return

  const [winContentWidth, winContentHeight] = currentWindow.getContentSize()
  const columnCount = managedViews.length
  if (columnCount === 0) return

  const colW = Math.max(320, Math.floor((winContentWidth - SIDEBAR_W) / columnCount))
  const height = Math.max(0, winContentHeight - HEADER_H)

  const columns = managedViews.map(({ view, descriptor }, index) => {
    const x = SIDEBAR_W + index * colW
    view.setBounds({
      x,
      y: HEADER_H,
      width: colW,
      height,
    })

    return {
      ...descriptor,
      x,
      width: colW,
    }
  })

  snapshot = {
    columns,
    sidebarW: SIDEBAR_W,
    headerH: HEADER_H,
  }

  currentWindow.webContents.send('column-layout', snapshot)
}

export function getSnapshot(): ColumnLayoutSnapshot {
  return snapshot
}

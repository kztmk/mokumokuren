import type { BrowserWindow } from 'electron'
import type { ColumnLayoutSnapshot, OverflowTab } from '../renderer/src/services'
import { getOrderedViews } from './columnManager'

const SIDEBAR_W = 72
const HEADER_H = 40
const BORDER_W = 2 // active border inset px
const MIN_COL_W = 350 // columns are at least this wide; they stretch to fill the column area
const RAIL_W = 48 // width of a left/right overflow tab rail (Phase 8)

let currentWindow: BrowserWindow | null = null
let snapshot: ColumnLayoutSnapshot = {
  columns: [],
  sidebarW: SIDEBAR_W,
  headerH: HEADER_H,
  overflowLeft: [],
  overflowRight: [],
  railW: RAIL_W,
}

// Phase 8: index (into the ordered live columns) of the leftmost column currently visible. The
// viewport shows a contiguous window [firstVisibleIndex, firstVisibleIndex + visibleCount); columns
// outside it are hidden and represented by the left/right overflow rails. applyLayout clamps this.
let firstVisibleIndex = 0
let lastWindow = { first: 0, n: 0 }

export function initLayoutManager(win: BrowserWindow): void {
  currentWindow = win
  win.on('resize', () => applyLayout())
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// Resolve the visible window: how many fixed-min-width columns fit starting around `desiredFirst`,
// and whether each side needs an overflow rail. Rail presence shrinks the available width (which
// changes the fit), and the window must always stay full — you never show fewer columns than fit
// while columns are hidden. Both couplings are solved by iterating to a fixed point: each pass
// recomputes the fit `n` for the current rails, then pulls `first` back so the window can't run
// past the last full window (this is also what clamps over-scroll at the right end).
function resolveWindow(
  count: number,
  desiredFirst: number,
  contentW: number
): { first: number; n: number; leftRail: number; rightRail: number } {
  // Columns that fit given which rails are present (uncapped by remaining count).
  const fit = (leftRail: boolean, rightRail: boolean): number => {
    const avail = contentW - SIDEBAR_W - (leftRail ? RAIL_W : 0) - (rightRail ? RAIL_W : 0)
    return clamp(Math.floor(avail / MIN_COL_W), 1, count)
  }

  let first = clamp(desiredFirst, 0, Math.max(0, count - 1))
  let n = fit(first > 0, false)
  for (let i = 0; i < 4; i++) {
    const lr = first > 0
    const rr = first + n < count
    n = fit(lr, rr)
    // Keep the window full at the end: never let `first` exceed the last position that still shows
    // `n` columns. Lowering `first` here lets `n` grow on the next pass (fewer remaining → no cap).
    first = clamp(first, 0, Math.max(0, count - n))
  }
  return {
    first,
    n: Math.min(n, count - first),
    leftRail: first > 0 ? RAIL_W : 0,
    rightRail: first + n < count ? RAIL_W : 0,
  }
}

export function applyLayout(): void {
  if (!currentWindow || currentWindow.isDestroyed()) return

  const managedViews = getOrderedViews()
  const count = managedViews.length

  if (count === 0) {
    firstVisibleIndex = 0
    lastWindow = { first: 0, n: 0 }
    snapshot = {
      columns: [],
      sidebarW: SIDEBAR_W,
      headerH: HEADER_H,
      overflowLeft: [],
      overflowRight: [],
      railW: RAIL_W,
    }
    if (!currentWindow.webContents.isDestroyed()) {
      currentWindow.webContents.send('column-layout', snapshot)
    }
    return
  }

  const [winContentWidth, winContentHeight] = currentWindow.getContentSize()
  const { first, n, leftRail, rightRail } = resolveWindow(count, firstVisibleIndex, winContentWidth)
  firstVisibleIndex = first
  lastWindow = { first, n }

  const colAreaX = SIDEBAR_W + leftRail
  const colAreaW = Math.max(0, winContentWidth - colAreaX - rightRail)
  const colW = Math.max(0, Math.floor(colAreaW / n))
  const height = Math.max(0, winContentHeight - HEADER_H)

  const toTab = (mv: (typeof managedViews)[number]): OverflowTab => ({
    accountId: mv.descriptor.accountId,
    service: mv.descriptor.service,
    username: mv.descriptor.username,
  })

  const columns = managedViews.map((mv, index) => {
    const { view, descriptor } = mv
    const visible = index >= first && index < first + n
    if (!visible) {
      if (!view.webContents.isDestroyed()) view.setVisible(false)
      return null
    }

    const j = index - first
    const x = colAreaX + j * colW
    // The last visible column absorbs the rounding remainder so the row fills the area exactly.
    const w = j === n - 1 ? colAreaW - j * colW : colW
    // Guard both calls: setBounds/setVisible on a destroyed webContents (e.g. a crashed view) throws.
    if (!view.webContents.isDestroyed()) {
      view.setVisible(true)
      view.setBounds({
        x: x + BORDER_W,
        y: HEADER_H + BORDER_W,
        width: Math.max(0, w - 2 * BORDER_W),
        height: Math.max(0, height - 2 * BORDER_W),
      })
    }

    return {
      ...descriptor,
      x,
      width: w,
      height: winContentHeight,
      borderW: BORDER_W,
    }
  })

  snapshot = {
    columns: columns.filter((c): c is NonNullable<typeof c> => c !== null),
    sidebarW: SIDEBAR_W,
    headerH: HEADER_H,
    overflowLeft: managedViews.slice(0, first).map(toTab),
    overflowRight: managedViews.slice(first + n).map(toTab),
    railW: RAIL_W,
  }

  if (!currentWindow.webContents.isDestroyed()) {
    currentWindow.webContents.send('column-layout', snapshot)
  }
}

export function getSnapshot(): ColumnLayoutSnapshot {
  return snapshot
}

// Phase 8: shift the visible window by `delta` columns (◀▶ rail buttons). applyLayout clamps.
export function scrollColumnWindow(delta: number): void {
  firstVisibleIndex = firstVisibleIndex + delta
  applyLayout()
}

// Phase 8: ensure the given column is within the visible window (rail tab click, activate, add,
// re-show). No-op if already visible. Re-checks after relayout because a rail appearing/disappearing
// can shift the fit by one.
export function revealColumn(accountId: string): void {
  const views = getOrderedViews()
  const idx = views.findIndex((v) => v.descriptor.accountId === accountId)
  if (idx < 0) return

  const inWindow = (): boolean => idx >= lastWindow.first && idx < lastWindow.first + lastWindow.n
  if (inWindow()) return

  firstVisibleIndex = idx < lastWindow.first ? idx : idx - lastWindow.n + 1
  applyLayout()
  if (!inWindow()) {
    firstVisibleIndex = idx < lastWindow.first ? idx : idx - lastWindow.n + 1
    applyLayout()
  }
}

// WebContentsView はレンダラー DOM の上に合成されるため、AI パネル等の DOM オーバーレイを前面に
// 出すには全カラムの view を一時的に非表示にする必要がある。再表示時はレイアウトを再適用する。
export function setColumnsVisible(visible: boolean): void {
  for (const { view } of getOrderedViews()) {
    if (!view.webContents.isDestroyed()) view.setVisible(visible)
  }
  if (visible) applyLayout()
}

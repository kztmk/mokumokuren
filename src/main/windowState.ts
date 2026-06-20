import ElectronStore from 'electron-store'
import { screen, type BrowserWindow, type Rectangle } from 'electron'

// Persists the main window's size/position across restarts. Stored separately from accounts so a
// window-state reset doesn't touch account data.
type WindowStateSchema = { bounds: Rectangle | null }

const store = new ElectronStore<WindowStateSchema>({
  name: 'window-state',
  defaults: { bounds: null },
})

const DEFAULT_SIZE = { width: 1400, height: 900 }
const MIN_SIZE = { width: 480, height: 400 }

// A saved position is only usable if it still overlaps a connected display — otherwise a window
// restored after unplugging a monitor would open off-screen. Falls back to size-only (centered).
function isOnSomeDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some((display) => {
    const a = display.workArea
    return (
      bounds.x < a.x + a.width &&
      bounds.x + bounds.width > a.x &&
      bounds.y < a.y + a.height &&
      bounds.y + bounds.height > a.y
    )
  })
}

export function getInitialWindowBounds(): {
  width: number
  height: number
  x?: number
  y?: number
} {
  const bounds = store.get('bounds')
  if (!bounds || typeof bounds.width !== 'number' || typeof bounds.height !== 'number') {
    return { ...DEFAULT_SIZE }
  }
  const width = Math.max(MIN_SIZE.width, bounds.width)
  const height = Math.max(MIN_SIZE.height, bounds.height)
  if (
    typeof bounds.x === 'number' &&
    typeof bounds.y === 'number' &&
    isOnSomeDisplay({ ...bounds, width, height })
  ) {
    return { x: bounds.x, y: bounds.y, width, height }
  }
  return { width, height }
}

export function trackWindowState(win: BrowserWindow): void {
  const save = (): void => {
    // Persist the normal (non-maximized/non-fullscreen, non-minimized) bounds so the restored
    // window is a sane, draggable size rather than a 0×0 minimized rect.
    if (win.isDestroyed() || win.isMinimized()) return
    store.set('bounds', win.getNormalBounds())
  }
  win.on('resize', save)
  win.on('move', save)
  win.on('close', save)
}

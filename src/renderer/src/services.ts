export type ServiceName = 'x' | 'bluesky' | 'threads'

export type MenuKey =
  | 'home'
  | 'search'
  | 'notifications'
  | 'messages'
  | 'bookmarks'
  | 'profile'
  | 'post'

export const NAV_MAP: Record<ServiceName, Record<MenuKey, string | null>> = {
  x: {
    home: '/home',
    search: '/explore',
    notifications: '/notifications',
    messages: '/messages',
    bookmarks: '/i/bookmarks',
    profile: '/:username',
    post: '/compose/post',
  },
  bluesky: {
    home: '/',
    search: '/search',
    notifications: '/notifications',
    messages: '/messages',
    bookmarks: '/profile/:username/lists',
    profile: '/profile/:username',
    post: '/intent/compose',
  },
  threads: {
    home: '/',
    search: '/search',
    notifications: '/activity',
    messages: null,
    bookmarks: '/saved',
    profile: '/@:username',
    post: '/intent/post',
  },
}

export function isMenuDisabled(
  service: ServiceName,
  key: MenuKey,
  username: string | null
): boolean {
  const url = NAV_MAP[service][key]
  if (url === null) return true
  if (url.includes(':username') && !username) return true
  return false
}

export const COMPOSE_URL: Record<ServiceName, string> = {
  x: '/compose/post',
  bluesky: '/intent/compose',
  threads: '/intent/post',
}

// Canonical per-service origin. Single source of truth shared by the main process (startup
// loadURL, navigation/compose URL building) so the base URLs can't drift between files.
export const SNS_URLS: Record<ServiceName, string> = {
  x: 'https://x.com',
  bluesky: 'https://bsky.app',
  threads: 'https://www.threads.net',
}

export const ACTIVE_BORDER_COLOR = '#FFB200'

// Fallback only. COMPOSE_URL is preferred; Phase4 wires this into navigation.
export const POST_TRIGGER: Record<ServiceName, string> = {
  x: 'document.querySelector(\'[data-testid="tweetButtonInline"]\')?.click()',
  bluesky: 'document.querySelector(\'[aria-label="New post"]\')?.click()',
  threads: 'document.querySelector(\'[aria-label="Create"]\')?.click()',
}

export const SERVICE_META: Record<
  ServiceName,
  { label: string; iconId: string; badgeColor: string; activeBorderColor: string }
> = {
  x: {
    label: 'X',
    iconId: 'x-logo',
    badgeColor: '#000000',
    activeBorderColor: ACTIVE_BORDER_COLOR,
  },
  bluesky: {
    label: 'Bluesky',
    iconId: 'bsky-logo',
    badgeColor: '#0085FF',
    activeBorderColor: ACTIVE_BORDER_COLOR,
  },
  threads: {
    label: 'Threads',
    iconId: 'threads-logo',
    badgeColor: '#000000',
    activeBorderColor: ACTIVE_BORDER_COLOR,
  },
}

export interface ColumnDescriptor {
  accountId: string
  service: ServiceName
  username: string | null
  x: number
  width: number
  height: number
  borderW: number
}

export interface ColumnLayoutSnapshot {
  columns: ColumnDescriptor[]
  sidebarW: number
  headerH: number
}

// The full set of accounts (visible and hidden), broadcast to the renderer so the sidebar can
// offer hidden accounts for re-showing and (later phases) manage add/delete/reorder. Distinct from
// ColumnLayoutSnapshot, which only carries the currently-visible columns and their geometry.
export interface AccountSummary {
  id: string
  service: ServiceName
  displayName: string
  username: string | null
  isVisible: boolean
  order: number
}

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'
  | 'unsupported'

export interface UpdateStatus {
  state: UpdateState
  version?: string
  percent?: number
  message?: string
}

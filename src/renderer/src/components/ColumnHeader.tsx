import { ACTIVE_BORDER_COLOR, type ServiceName, SERVICE_META } from '../services'

type ColumnHeaderProps = {
  columnId: string
  service: ServiceName
  username: string | null
  x: number
  width: number
  isActive: boolean
  unread: number
  canGoBack: boolean
  canGoForward: boolean
  onSetActive: (columnId: string) => void
  onClose: (columnId: string) => void
  onSetVisible: (columnId: string, visible: boolean) => void
  onGoBack: (columnId: string) => void
  onGoForward: (columnId: string) => void
  onDragStartColumn: (columnId: string) => void
  onDropColumn: (columnId: string) => void
}

export function ColumnHeader({
  columnId,
  service,
  username,
  x,
  width,
  isActive,
  unread,
  canGoBack,
  canGoForward,
  onSetActive,
  onClose,
  onSetVisible,
  onGoBack,
  onGoForward,
  onDragStartColumn,
  onDropColumn,
}: ColumnHeaderProps): React.JSX.Element {
  const meta = SERVICE_META[service]

  return (
    <div
      style={{
        position: 'fixed',
        left: x,
        top: 0,
        width,
        height: 40,
        background: 'var(--header-bg)',
        border: `2px solid ${isActive ? ACTIVE_BORDER_COLOR : 'transparent'}`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 8px',
        zIndex: 50,
        cursor: 'pointer',
        boxSizing: 'border-box',
      }}
      onClick={() => onSetActive(columnId)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStartColumn(columnId)
      }}
      onDragOver={(e) => {
        // Required for the drop to fire; marks this header as a valid drop target.
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDropColumn(columnId)
      }}
    >
      {/* Service badge */}
      <div
        title={meta.label}
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          background: meta.badgeColor,
          border: '1px solid var(--chrome-border)',
          flexShrink: 0,
        }}
      />

      {/* Back button */}
      <button
        title="戻る"
        disabled={!canGoBack}
        style={{
          background: 'transparent',
          border: 'none',
          color: canGoBack ? 'var(--chrome-text)' : 'var(--chrome-text-disabled)',
          cursor: canGoBack ? 'pointer' : 'default',
          fontSize: 16,
          padding: '0 2px',
          lineHeight: 1,
        }}
        onClick={() => {
          // Let the click bubble to the header so navigating an inactive column also selects it.
          onGoBack(columnId)
        }}
      >
        ‹
      </button>

      {/* Forward button */}
      <button
        title="進む"
        disabled={!canGoForward}
        style={{
          background: 'transparent',
          border: 'none',
          color: canGoForward ? 'var(--chrome-text)' : 'var(--chrome-text-disabled)',
          cursor: canGoForward ? 'pointer' : 'default',
          fontSize: 16,
          padding: '0 2px',
          lineHeight: 1,
        }}
        onClick={() => {
          // Let the click bubble to the header so navigating an inactive column also selects it.
          onGoForward(columnId)
        }}
      >
        ›
      </button>

      {/* Username */}
      <span
        style={{
          color: username ? 'var(--chrome-text)' : 'var(--chrome-text-muted)',
          fontSize: 12,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {username ? `@${username}` : '未ログイン'}
      </span>

      {/* Unread badge (parsed from the page title's "(N)") */}
      {unread > 0 ? (
        <div
          title={`未読 ${unread}`}
          style={{
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            borderRadius: 8,
            background: '#F91880',
            color: '#fff',
            fontSize: 10,
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            flexShrink: 0,
            boxSizing: 'border-box',
          }}
        >
          {unread > 99 ? '99+' : unread}
        </div>
      ) : (
        <div
          title="通知"
          style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            border: '1px solid var(--chrome-border)',
            flexShrink: 0,
          }}
        />
      )}

      {/* Hide button */}
      <button
        title="非表示"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--chrome-text-muted)',
          cursor: 'pointer',
          fontSize: 14,
          padding: '0 4px',
          lineHeight: 1,
        }}
        onClick={(e) => {
          e.stopPropagation()
          onSetVisible(columnId, false)
        }}
      >
        −
      </button>

      {/* Delete account button */}
      <button
        title="アカウントを削除"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--chrome-text-muted)',
          cursor: 'pointer',
          fontSize: 14,
          padding: '0 4px',
          lineHeight: 1,
        }}
        onClick={(e) => {
          e.stopPropagation()
          onClose(columnId)
        }}
      >
        ×
      </button>
    </div>
  )
}

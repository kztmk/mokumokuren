import { ACTIVE_BORDER_COLOR, type ServiceName, SERVICE_META } from '../services'

type ColumnHeaderProps = {
  columnId: string
  service: ServiceName
  username: string | null
  x: number
  width: number
  isActive: boolean
  onSetActive: (columnId: string) => void
  onClose: (columnId: string) => void
  onSetVisible: (columnId: string, visible: boolean) => void
}

export function ColumnHeader({
  columnId,
  service,
  username,
  x,
  width,
  isActive,
  onSetActive,
  onClose,
  onSetVisible,
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
        background: '#111',
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
    >
      {/* Service badge */}
      <div
        title={meta.label}
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          background: meta.badgeColor,
          border: '1px solid #333',
          flexShrink: 0,
        }}
      />

      {/* Username */}
      <span
        style={{
          color: username ? '#e7e9ea' : '#555',
          fontSize: 12,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {username ? `@${username}` : '未ログイン'}
      </span>

      {/* Notification badge placeholder */}
      <div
        title="通知"
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          border: '1px solid #444',
          flexShrink: 0,
        }}
      />

      {/* Hide button */}
      <button
        title="非表示"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#888',
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

      {/* Close button */}
      <button
        title="閉じる"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#888',
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

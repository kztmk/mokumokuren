import { useState } from 'react'
import { type AiState, type Draft, type ServiceName, SERVICE_META } from '../services'

type AiPanelProps = {
  aiState: AiState
  activeService: ServiceName | null
  onClose: () => void
  onComposePost: (service: ServiceName, text?: string) => void
}

const REASON_MESSAGE: Record<AiState['reason'], string> = {
  ok: 'AI 下書きが利用できます。',
  'no-unlock-key': '虎威アンロックキーを登録してください。',
  inactive: '虎威サブスクリプションが必要です（キーは有効、現在は非会員）。',
  'invalid-key': 'アンロックキーが無効または失効しています。再登録してください。',
  error: '状態を確認できませんでした。ネットワークを確認して再試行してください。',
  unavailable: 'この環境では安全な保存（OSキーチェーン）が利用できません。',
  checking: '状態を確認中…',
}

const TORAI_SALES_URL = 'https://torai-e0d8e.web.app'

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function AiPanel({
  aiState,
  activeService,
  onClose,
  onComposePost,
}: AiPanelProps): React.JSX.Element {
  const [showSettings, setShowSettings] = useState(!aiState.available)
  const [geminiInput, setGeminiInput] = useState('')
  const [unlockInput, setUnlockInput] = useState('')
  const [savingGemini, setSavingGemini] = useState(false)
  const [savingUnlock, setSavingUnlock] = useState(false)
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null)

  const [keyword, setKeyword] = useState('')
  const [generating, setGenerating] = useState(false)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [genError, setGenError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const canGenerate = aiState.available && aiState.hasGeminiKey && !generating && !!activeService

  const handleSaveUnlock = async (): Promise<void> => {
    const key = unlockInput.trim()
    if (!key) return
    setSavingUnlock(true)
    setSettingsMsg(null)
    try {
      await window.electronAPI.setUnlockKey(key)
      setUnlockInput('')
    } finally {
      setSavingUnlock(false)
    }
  }

  const handleClearUnlock = async (): Promise<void> => {
    await window.electronAPI.clearUnlockKey()
  }

  const handleSaveGemini = async (): Promise<void> => {
    const key = geminiInput.trim()
    if (!key) return
    setSavingGemini(true)
    setSettingsMsg(null)
    try {
      const ok = await window.electronAPI.setGeminiKey(key)
      setSettingsMsg(ok ? 'Gemini API キーを保存しました。' : 'Gemini キーの保存に失敗しました。')
      if (ok) setGeminiInput('')
    } finally {
      setSavingGemini(false)
    }
  }

  const handleClearGemini = async (): Promise<void> => {
    await window.electronAPI.clearGeminiKey()
    setSettingsMsg('Gemini API キーを削除しました。')
  }

  const handleRecheck = async (): Promise<void> => {
    await window.electronAPI.checkSubscription()
  }

  const handleGenerate = async (): Promise<void> => {
    const kw = keyword.trim()
    if (!kw || !activeService) return
    setGenerating(true)
    setGenError(null)
    setDrafts([])
    try {
      const result = await window.electronAPI.generateDrafts(kw, activeService)
      if (result.ok) {
        setDrafts(result.drafts)
        if (result.drafts.length === 0) setGenError('下書きが生成されませんでした。')
      } else {
        setGenError(result.message)
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : '生成に失敗しました。')
    } finally {
      setGenerating(false)
    }
  }

  // 採用：本文を渡して作成画面を prefill する（intent の ?text= で事前入力）。万一 prefill が効か
  // ない環境向けに、クリップボードにもコピーしておき手動ペーストでも復帰できるようにする。
  const handleAdopt = async (draft: Draft): Promise<void> => {
    if (!activeService) return
    await copyToClipboard(draft.text)
    onComposePost(activeService, draft.text)
    onClose()
  }

  const handleCopy = async (draft: Draft): Promise<void> => {
    const ok = await copyToClipboard(draft.text)
    if (ok) {
      setCopiedId(draft.id)
      setTimeout(() => setCopiedId((id) => (id === draft.id ? null : id)), 1200)
    }
  }

  const serviceLabel = activeService ? SERVICE_META[activeService].label : '—'

  return (
    <div
      style={{
        position: 'fixed',
        left: 72,
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 200,
        background: 'var(--app-bg)',
        color: 'var(--chrome-text)',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          borderBottom: '1px solid var(--chrome-border)',
          background: 'var(--header-bg)',
        }}
      >
        <strong style={{ fontSize: 15 }}>AI 下書き</strong>
        <span style={{ fontSize: 12, color: 'var(--chrome-text-muted)' }}>
          対象: {serviceLabel}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowSettings((s) => !s)} style={btnGhost} title="キーの登録/管理">
          ⚙ 設定
        </button>
        <button onClick={onClose} style={btnGhost} title="閉じる">
          ✕ 閉じる
        </button>
      </div>

      {/* Status bar */}
      <div
        style={{
          padding: '8px 16px',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          borderBottom: '1px solid var(--chrome-border)',
          color: aiState.available ? '#00BA7C' : 'var(--chrome-text-muted)',
        }}
      >
        <span>{aiState.reason === 'checking' ? '⟳' : aiState.available ? '●' : '○'}</span>
        <span>{aiState.message ?? REASON_MESSAGE[aiState.reason]}</span>
        {(aiState.reason === 'error' || aiState.reason === 'checking') && (
          <button onClick={handleRecheck} style={btnGhostSm}>
            再確認
          </button>
        )}
        {(aiState.reason === 'inactive' || aiState.reason === 'invalid-key') && (
          <button onClick={() => onComposeExternal()} style={btnGhostSm}>
            虎威を確認
          </button>
        )}
      </div>

      {/* Settings */}
      {showSettings && (
        <div
          style={{
            padding: 16,
            borderBottom: '1px solid var(--chrome-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            maxHeight: '50%',
            overflowY: 'auto',
          }}
        >
          <div>
            <label style={lbl}>
              虎威アンロックキー{' '}
              <span style={badge(aiState.hasUnlockKey)}>
                {aiState.hasUnlockKey ? '登録済み' : '未登録'}
              </span>
            </label>
            <div style={row}>
              <input
                type="password"
                value={unlockInput}
                onChange={(e) => setUnlockInput(e.target.value)}
                placeholder="TORAI-..."
                style={input}
              />
              <button onClick={handleSaveUnlock} disabled={savingUnlock} style={btnPrimary}>
                {savingUnlock ? '保存中…' : '保存'}
              </button>
              {aiState.hasUnlockKey && (
                <button onClick={handleClearUnlock} style={btnGhost}>
                  削除
                </button>
              )}
            </div>
            <p style={hint}>虎威の管理画面で発行したキーを貼り付けてください。</p>
          </div>

          <div>
            <label style={lbl}>
              Gemini API キー（BYOK）{' '}
              <span style={badge(aiState.hasGeminiKey)}>
                {aiState.hasGeminiKey ? '登録済み' : '未登録'}
              </span>
            </label>
            <div style={row}>
              <input
                type="password"
                value={geminiInput}
                onChange={(e) => setGeminiInput(e.target.value)}
                placeholder="AIza..."
                style={input}
              />
              <button onClick={handleSaveGemini} disabled={savingGemini} style={btnPrimary}>
                {savingGemini ? '保存中…' : '保存'}
              </button>
              {aiState.hasGeminiKey && (
                <button onClick={handleClearGemini} style={btnGhost}>
                  削除
                </button>
              )}
            </div>
            <p style={hint}>
              生成はあなたのキーでローカル実行されます（キーは端末内で暗号化保存）。
            </p>
          </div>
          {settingsMsg && (
            <div style={{ fontSize: 12, color: 'var(--chrome-text-muted)' }}>{settingsMsg}</div>
          )}
        </div>
      )}

      {/* Generator */}
      <div style={{ padding: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            // IME 変換確定の Enter（isComposing）は無視する。これを拾うと日本語の複合ワード入力中に
            // 変換を確定しただけで生成が走ってしまう。確定後の独立した Enter のみ生成のトリガーにする。
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && canGenerate)
              void handleGenerate()
          }}
          placeholder="キーワードを入力（例: 朝活、副業、猫）"
          style={{ ...input, flex: 1 }}
          disabled={!canGenerate && !generating}
        />
        <button onClick={handleGenerate} disabled={!canGenerate} style={btnPrimary}>
          {generating ? '生成中…' : '48件生成'}
        </button>
      </div>

      {genError && (
        <div style={{ padding: '0 16px 8px', fontSize: 12, color: '#F4212E' }}>{genError}</div>
      )}

      {/* Drafts list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
        {generating && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--chrome-text-muted)' }}>
            生成中… しばらくお待ちください
          </div>
        )}
        {!generating && drafts.length > 0 && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--chrome-text-muted)',
              padding: '4px 0 8px',
            }}
          >
            {drafts.length} 件の下書き — 「採用」でコピー＆作成画面を開きます
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {drafts.map((draft) => (
            <div
              key={draft.id}
              style={{
                border: '1px solid var(--chrome-border)',
                borderRadius: 10,
                padding: 12,
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
              }}
            >
              <div style={{ flex: 1, whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.5 }}>
                {draft.text}
                <div style={{ fontSize: 11, color: 'var(--chrome-text-muted)', marginTop: 4 }}>
                  {[...draft.text].length} 文字
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  onClick={() => handleAdopt(draft)}
                  style={btnPrimary}
                  disabled={!activeService}
                >
                  採用
                </button>
                <button onClick={() => handleCopy(draft)} style={btnGhost}>
                  {copiedId === draft.id ? 'コピー済' : 'コピー'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  function onComposeExternal(): void {
    // 虎威セールス/管理画面へ（http/https は main の setWindowOpenHandler でガード済み）。
    window.open(TORAI_SALES_URL, '_blank')
  }
}

const btnGhost: React.CSSProperties = {
  border: '1px solid var(--chrome-border)',
  background: 'transparent',
  color: 'var(--chrome-text)',
  borderRadius: 8,
  padding: '6px 10px',
  cursor: 'pointer',
  fontSize: 13,
}

const btnGhostSm: React.CSSProperties = {
  ...btnGhost,
  padding: '2px 8px',
  fontSize: 12,
}

const btnPrimary: React.CSSProperties = {
  border: 'none',
  background: '#1D9BF0',
  color: '#fff',
  borderRadius: 8,
  padding: '6px 14px',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 'bold',
}

const input: React.CSSProperties = {
  border: '1px solid var(--chrome-border)',
  background: 'var(--app-bg)',
  color: 'var(--chrome-text)',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 14,
  flex: 1,
  boxSizing: 'border-box',
}

const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }
const lbl: React.CSSProperties = { fontSize: 13, fontWeight: 'bold' }
const hint: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--chrome-text-muted)',
  margin: '6px 0 0',
}
const badge = (on: boolean): React.CSSProperties => ({
  fontSize: 11,
  fontWeight: 'normal',
  color: on ? '#00BA7C' : 'var(--chrome-text-muted)',
  marginLeft: 6,
})

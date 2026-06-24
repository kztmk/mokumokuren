import { ipcMain, type BrowserWindow } from 'electron'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { CHANNELS } from '../shared/channels'
import { clearSecret, getSecret, secretsEncryptionAvailable, setSecret } from './secretStore'
import { getAiState, notifyGeminiKeyChanged } from './toraiGate'
import { setColumnsVisible } from './layoutManager'

// BYOK・ローカル AI 下書き生成。ユーザー自身の Gemini API キーで main プロセスから直接 Gemini を叩く
// （キーはレンダラー／SNS webview に一切露出させない）。snake-sns の postApi.ts を移植。

export type Draft = { id: string; text: string; adopted: boolean }

type ServiceName = 'x' | 'bluesky' | 'threads'

export type GenerateResult =
  | { ok: true; drafts: Draft[] }
  | {
      ok: false
      code: 'no-key' | 'not-subscribed' | 'blocked' | 'parse' | 'api' | 'unavailable'
      message: string
    }

const MODEL = 'gemini-flash-lite-latest'
const DRAFT_COUNT = 48

// サービス別のプロンプト・パラメータ（プラットフォーム名＋目安文字数＋長さの指示）。
// lengthHint はプラットフォームごとの「狙う長さ」。X は簡潔に、Bluesky/Threads は文字数を活かした
// 読み応えのある長文に振る（共通の「短く」指示だと charLimit 差が効かず全部短くなるため）。
const SERVICE_PROMPT: Record<
  ServiceName,
  { platform: string; charLimit: number; lengthHint: string }
> = {
  x: {
    platform: 'X（旧Twitter）',
    charLimit: 140,
    lengthHint: '1〜2文で簡潔に、インパクト重視。100〜140文字程度を目安に。',
  },
  bluesky: {
    platform: 'Bluesky',
    charLimit: 300,
    lengthHint:
      '2〜4文でしっかり展開する。180〜300文字程度を目安に、文字数を活かして読み応えを持たせる。',
  },
  threads: {
    platform: 'Threads',
    charLimit: 500,
    lengthHint:
      '複数の文・段落で物語性や具体例を盛り込み、しっかり読ませる長文にする。300〜500文字程度を目安に。一文だけの短い投稿にはしない。',
  },
}

function buildSystemPrompt(platform: string, charLimit: number, lengthHint: string): string {
  return `# あなたの役割
あなたは、${platform}でバイラルコンテンツを生み出すことを専門とする、経験豊富なソーシャルメディアマーケターおよびコピーライターです。最新のトレンド、ユーザー心理、エンゲージメントを高めるテクニックに精通しています。

# 実行目標
ユーザーから提供されたキーワードに基づき、${platform}で「バズる」可能性を秘めた多様なポストのアイデアを**${DRAFT_COUNT}個**作成してください。生成されるポストは、人々の関心を引き、共感を呼び、シェアや「いいね」を促進するような工夫が凝らされている必要があります。

# 考慮すべき「バズる」要素
感情への訴求／共感性／意外性・発見／有用性・学び／問いかけ・参加／ストーリーテリング／ユーモア・皮肉／強い意見・主張／視覚的訴求力／簡潔さとインパクト／ギャップ／トレンド・時事性。これらを多様に組み合わせてください。

# 出力形式
*   ${DRAFT_COUNT}個のポスト案を生成してください。各案は独立したテキストとして提示してください。
*   多様な角度（質問・断言・共感・ライフハック・ユーモア・皮肉・感動・問題提起など）からアイデアを出してください。
*   必要に応じて絵文字を効果的に使用してください。ハッシュタグは内容に合わせ最大2つまで（必須ではない）。
*   長さの方針（${platform}）: ${lengthHint} 上限は日本語で約${charLimit}文字です。プラットフォームごとに最適な長さが異なるため、この方針に必ず従ってください。
*   生成するJSONは必ず以下の形式に従ってください。

   {
    "posts": [
       { "text": "ここに1つ目のポスト案のテキスト。絵文字や #ハッシュタグ もOK。🎉" },
       { "text": "ここに2つ目のポスト案のテキスト。" }
     ]
   }
*   JSON文字列のみを出力してください（「はい、生成しました。」等の前置き・後書きは含めない）。

# 注意事項
*   生成するのは「ポスト案」であり、投稿時にユーザーが内容を吟味・修正する前提です。
*   特定の個人や団体を不当に攻撃したり、差別を助長したりする内容は避けてください。`
}

function buildUserPrompt(platform: string, keyword: string): string {
  return `繰り返します。JSONデータ以外を返さないでください。以下のキーワードを使って、バズる可能性のある${platform}のポスト案を${DRAFT_COUNT}個作成してください。多様な角度や感情に訴えかける、面白くて共感を呼ぶアイデアをお願いします。キーワード: ${keyword}`
}

type GeminiPostsShape = { posts: { text: string }[] }

function isPostsShape(parsed: unknown): parsed is GeminiPostsShape {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    'posts' in parsed &&
    Array.isArray((parsed as GeminiPostsShape).posts) &&
    (parsed as GeminiPostsShape).posts.every(
      (item) => typeof item === 'object' && item !== null && typeof item.text === 'string'
    )
  )
}

// 各 `{` 位置から、文字列リテラル（とエスケープ）を考慮して対応する `}` までのバランスの取れた
// 部分文字列を取り出す。greedy な /\{[\s\S]*\}/ と違い、文中の余計な波括弧（例:「{keyword}」や
// 末尾の余分な `}`）を巻き込まずに、本物の JSON オブジェクト候補を左から順に列挙できる。
function balancedObjectCandidates(s: string): string[] {
  const out: string[] = []
  for (let start = s.indexOf('{'); start >= 0; start = s.indexOf('{', start + 1)) {
    let depth = 0
    let inStr = false
    let esc = false
    for (let i = start; i < s.length; i++) {
      const ch = s[i]
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
      } else if (ch === '"') inStr = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          out.push(s.slice(start, i + 1))
          break
        }
      }
    }
  }
  return out
}

// JSON 抽出＋型ガードして Draft[] に変換。lightモデルは指示しても ```json フェンスや前後の
// 会話文（「以下が下書きです:」等、余計な波括弧を含むことも）を混ぜることがある。クリーンな順に
// 候補を試す: (1) ```json フェンスの中身 → (2) 文字列全体 → (3) 左から順のバランス括弧オブジェクト。
// 各候補は JSON.parse＋形ガードを通り、最初に成立したものを採用する。
function parseDrafts(raw: string): Draft[] {
  const cleaned = raw.trim()

  const tryParse = (str: string): Draft[] | null => {
    let parsed: unknown
    try {
      parsed = JSON.parse(str)
    } catch {
      return null
    }
    if (!isPostsShape(parsed)) return null
    const now = Date.now()
    return parsed.posts.map((post, index) => ({
      id: `${now}-${index}`,
      text: post.text,
      adopted: false,
    }))
  }

  // クリーンな順に試し、成功した時点で返す（後段の重い処理を走らせない）。
  // 1. ```json フェンスの中身
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) {
    const res = tryParse(fence[1].trim())
    if (res) return res
  }
  // 2. 文字列全体（前後に何も無ければここで成立。バランス括弧スキャンを回避できる）
  const whole = tryParse(cleaned)
  if (whole) return whole
  // 3. 左から順のバランス括弧オブジェクト（ここで初めて O(n^2) スキャンを行う）
  for (const candidate of balancedObjectCandidates(cleaned)) {
    const res = tryParse(candidate)
    if (res) return res
  }
  throw new Error('APIレスポンスの形式が不正です。')
}

async function generate(keyword: string, service: ServiceName): Promise<GenerateResult> {
  // ゲート（虎威）— UI でも制御するが、生成アクション境界でも必ず確認する。
  if (!getAiState().available) {
    return { ok: false, code: 'not-subscribed', message: 'AI 下書きは虎威会員限定の機能です。' }
  }
  const apiKey = getSecret('gemini')
  if (!apiKey) {
    return { ok: false, code: 'no-key', message: 'Gemini API キーが登録されていません。' }
  }
  const { platform, charLimit, lengthHint } = SERVICE_PROMPT[service]

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: MODEL })
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: buildUserPrompt(platform, keyword) }] }],
      systemInstruction: buildSystemPrompt(platform, charLimit, lengthHint),
    })
    const response = result.response
    if (response.promptFeedback?.blockReason) {
      return {
        ok: false,
        code: 'blocked',
        message: `コンテンツ生成がブロックされました: ${response.promptFeedback.blockReason}`,
      }
    }
    const text = response.text()
    if (!text || text.trim() === '') {
      return { ok: true, drafts: [] }
    }
    try {
      return { ok: true, drafts: parseDrafts(text) }
    } catch (parseErr) {
      return {
        ok: false,
        code: 'parse',
        message: parseErr instanceof Error ? parseErr.message : 'レスポンスの解析に失敗しました。',
      }
    }
  } catch (err) {
    return {
      ok: false,
      code: 'api',
      message: err instanceof Error ? err.message : 'Gemini API 呼び出しに失敗しました。',
    }
  }
}

let win: BrowserWindow | null = null
let initialized = false

export function setupGeminiDrafts(window: BrowserWindow): void {
  win = window
  // Drop the reference on close so the destroyed window can be GC'd (mac keeps the process alive).
  window.on('closed', () => {
    if (win === window) win = null
  })
  if (initialized) return
  initialized = true

  ipcMain.handle(CHANNELS.SET_GEMINI_KEY, (event, key: unknown) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return false
    if (!secretsEncryptionAvailable()) return false
    const value = typeof key === 'string' ? key.trim() : ''
    if (!value) return false
    const ok = setSecret('gemini', value)
    if (ok) notifyGeminiKeyChanged()
    return ok
  })

  ipcMain.handle(CHANNELS.CLEAR_GEMINI_KEY, (event) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return
    clearSecret('gemini')
    notifyGeminiKeyChanged()
  })

  // AI パネルの開閉に合わせてカラム view を隠す/戻す（DOM オーバーレイを前面に出すため）。
  ipcMain.handle(CHANNELS.SET_AI_OVERLAY, (event, on: unknown) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return
    setColumnsVisible(!on)
  })

  ipcMain.handle(
    CHANNELS.GENERATE_DRAFTS,
    async (event, keyword: unknown, service: unknown): Promise<GenerateResult> => {
      if (!win || win.isDestroyed() || event.sender !== win.webContents) {
        return { ok: false, code: 'api', message: '不正な呼び出しです。' }
      }
      if (!secretsEncryptionAvailable()) {
        return {
          ok: false,
          code: 'unavailable',
          message: 'この環境では安全な保存（OSキーチェーン）が利用できません。',
        }
      }
      const kw = typeof keyword === 'string' ? keyword.trim() : ''
      if (!kw) return { ok: false, code: 'api', message: 'キーワードを入力してください。' }
      const svc: ServiceName =
        service === 'x' || service === 'bluesky' || service === 'threads' ? service : 'x'
      return generate(kw, svc)
    }
  )
}

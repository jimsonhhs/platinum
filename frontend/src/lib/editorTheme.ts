import type { Theme } from '@/hooks/useTheme'

// Monaco 主题名映射（全部用定制主题：极浅选区 + 当前行号高亮）
export const MONACO_THEME: Record<Theme, string> = {
  light: 'platinum-light',
  dark: 'platinum-dark',
  'eye-care': 'platinum-eye-care',
  'black-yellow': 'platinum-black-yellow',
}

let defined = false

// 在 monaco 实例上注册自定义主题（幂等）。自定义文字/背景色覆盖时构建 platinum-custom。
export function ensureMonacoThemes(monaco: any, customFg?: string, customBg?: string) {
  if (!monaco?.editor?.defineTheme) return

  if (!defined) {
    // 浅色定制：极浅灰选区（比背景稍深）+ 当前行号蓝色高亮（全部实色，不依赖 rgba 解析）
    monaco.editor.defineTheme('platinum-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.selectionBackground': '#e4e4e4',
        'editor.inactiveSelectionBackground': '#efefef',
        'editor.selectionHighlightBackground': '#00000000',
        'editor.wordHighlightBackground': '#00000000',
        'editor.wordHighlightStrongBackground': '#00000000',
        'editorLineNumber.foreground': '#9ca3af',
        'editorLineNumber.activeForeground': '#2563eb',
        'editor.lineHighlightBackground': '#e3efff',
      },
    })

    // 深色定制：柔和灰色选区 + 当前行号亮蓝高亮
    monaco.editor.defineTheme('platinum-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.selectionBackground': '#3a3a3a',
        'editor.inactiveSelectionBackground': '#2d2d2d',
        'editor.selectionHighlightBackground': '#00000000',
        'editor.wordHighlightBackground': '#00000000',
        'editor.wordHighlightStrongBackground': '#00000000',
        'editorLineNumber.foreground': '#6b7280',
        'editorLineNumber.activeForeground': '#7db4ff',
        'editor.lineHighlightBackground': '#263a5e',
      },
    })

    monaco.editor.defineTheme('platinum-eye-care', {
      base: 'vs',
      inherit: true,
      rules: [{ token: '', foreground: '2b3a2b', background: 'd5fbe6' }],
      colors: {
        'editor.background': '#d5fbe6',
        'editor.foreground': '#2b3a2b',
        'editor.lineHighlightBackground': '#c2ecd0',
        'editorLineNumber.foreground': '#6b8f6e',
        'editorLineNumber.activeForeground': '#14603a',
        'editorCursor.foreground': '#3d6b4f',
        'editor.selectionBackground': '#c9ecd2',
        'editor.inactiveSelectionBackground': '#d9f2e0',
        'editor.selectionHighlightBackground': '#00000000',
        'editor.wordHighlightBackground': '#00000000',
        'editor.wordHighlightStrongBackground': '#00000000',
        'editorGutter.background': '#d5fbe6',
        'editorWidget.background': '#dffbe9',
        'editorWidget.border': '#a9d3b0',
        'scrollbarSlider.background': '#8ab88f',
        'scrollbarSlider.hoverBackground': '#6fa876',
        'scrollbarSlider.activeBackground': '#5a9a62',
        'editorWhitespace.foreground': '#9ab89e',
      },
    })

    monaco.editor.defineTheme('platinum-black-yellow', {
      base: 'vs-dark',
      inherit: true,
      rules: [{ token: '', foreground: 'ffd700', background: '000000' }],
      colors: {
        'editor.background': '#000000',
        'editor.foreground': '#ffd700',
        'editor.lineHighlightBackground': '#3a3400',
        'editorLineNumber.foreground': '#8a7a2f',
        'editorLineNumber.activeForeground': '#ffe94d',
        'editorCursor.foreground': '#ffd700',
        'editor.selectionBackground': '#3a3400',
        'editor.inactiveSelectionBackground': '#2a2500',
        'editor.selectionHighlightBackground': '#00000000',
        'editor.wordHighlightBackground': '#00000000',
        'editor.wordHighlightStrongBackground': '#00000000',
        'editorGutter.background': '#000000',
        'editorWidget.background': '#0d0d00',
        'editorWidget.border': '#4d4400',
        'scrollbarSlider.background': '#4d4400',
        'scrollbarSlider.hoverBackground': '#6b5d00',
        'scrollbarSlider.activeBackground': '#8a7a00',
        'editorWhitespace.foreground': '#4d4400',
      },
    })
    defined = true
  }

  // 自定义颜色覆盖：任何主题下若设置了自定义文字/背景色，使用 platinum-custom
  if (customFg || customBg) {
    const fg = (customFg || '').replace(/^#/, '')
    const bg = (customBg || '').replace(/^#/, '')
    const base = bg ? 'vs-dark' : 'vs'
    const darkBg = luminance(bg || '000000') < 128
    monaco.editor.defineTheme('platinum-custom', {
      base,
      inherit: true,
      rules: [{ token: '', foreground: fg || undefined, background: bg || undefined }],
      colors: {
        ...(bg ? { 'editor.background': `#${bg}` } : {}),
        ...(fg ? { 'editor.foreground': `#${fg}` } : {}),
        // 行高亮/选区用实色（不依赖 rgba 解析），暗背景调亮、亮背景调暗
        ...(bg ? { 'editor.lineHighlightBackground': darkBg ? adjust(bg, 0.1) : adjust(bg, -0.05) } : {}),
        ...(bg ? { 'editorGutter.background': `#${bg}` } : {}),
        ...(bg ? { 'editorWidget.background': darkBg ? adjust(bg, 0.08) : adjust(bg, -0.06) } : {}),
        'editorCursor.foreground': fg ? `#${fg}` : '#ffd700',
        // 选区实色：暗背景调亮、亮背景调暗（比背景稍深/稍亮一点点）
        'editor.selectionBackground': bg ? (darkBg ? adjust(bg, 0.12) : adjust(bg, -0.08)) : '#3a3400',
        'editor.inactiveSelectionBackground': bg ? (darkBg ? adjust(bg, 0.06) : adjust(bg, -0.05)) : '#2a2500',
        'editor.selectionHighlightBackground': '#00000000',
        'editor.wordHighlightBackground': '#00000000',
        'editor.wordHighlightStrongBackground': '#00000000',
        'editorLineNumber.foreground': mix(fg || 'ffd700', bg || '000000', 0.5),
        'editorLineNumber.activeForeground': fg ? `#${fg}` : '#ffd700',
      },
    })
    return 'platinum-custom'
  }
  return MONACO_THEME[(document.documentElement.getAttribute('data-theme') as Theme) || 'light']
}

// 亮度（0-255），用于判断背景明暗
function luminance(hex: string): number {
  const n = parseInt(hex, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b
}

// 向亮/暗方向调整：amt>0 调亮（按与白色的差距比例），amt<0 调暗（按比例缩放）
function adjust(hex: string, amt: number): string {
  const n = parseInt(hex, 16)
  let r = (n >> 16) & 255
  let g = (n >> 8) & 255
  let b = n & 255
  if (amt > 0) {
    r = Math.min(255, Math.round(r + (255 - r) * amt))
    g = Math.min(255, Math.round(g + (255 - g) * amt))
    b = Math.min(255, Math.round(b + (255 - b) * amt))
  } else {
    const k = 1 + amt
    r = Math.round(r * k)
    g = Math.round(g * k)
    b = Math.round(b * k)
  }
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

function mix(a: string, b: string, t: number): string {
  const na = parseInt(a, 16), nb = parseInt(b, 16)
  const r = Math.round(((na >> 16) & 255) * t + ((nb >> 16) & 255) * (1 - t))
  const g = Math.round(((na >> 8) & 255) * t + ((nb >> 8) & 255) * (1 - t))
  const bl = Math.round((na & 255) * t + (nb & 255) * (1 - t))
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`
}

// ── 编辑器偏好（字号/字体/自定义颜色）────────────────────

export interface EditorPrefs {
  fontSize: number
  fontFamily: string
  lineSpacing: number // 行高 = 字号 × lineSpacing
  customFg: string // 空 = 不自定义
  customBg: string
}

export const DEFAULT_FONT = "'Noto Serif SC', 'Source Han Serif SC', serif"

// ── 编辑器偏好 store（响应式：设置页改动即时全局生效）──

const PREFS_KEY = 'editor_prefs'

let prefsCache: EditorPrefs | null = null

// 若自定义颜色恰好等于某个主题的默认配色（如"黑黄主题同步确定"写入的 #000000/#ffd700），
// 视为"未自定义"（跟随主题），避免残留导致所有主题下编辑器都是黑底/特殊色。
function normalizeCustom(p: EditorPrefs): EditorPrefs {
  const schemes = [
    { bg: '#ffffff', fg: '#1a1a1a' },
    { bg: '#1e1f24', fg: '#e8e8ea' },
    { bg: '#d5fbe6', fg: '#2b3a2b' },
    { bg: '#000000', fg: '#ffd700' },
  ]
  const bg = (p.customBg || '').toLowerCase()
  const fg = (p.customFg || '').toLowerCase()
  for (const s of schemes) {
    if (bg === s.bg && fg === s.fg) {
      return { ...p, customBg: '', customFg: '' }
    }
  }
  return p
}

function loadPrefs(): EditorPrefs {
  if (prefsCache) return prefsCache
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      prefsCache = normalizeCustom({
        fontSize: typeof p.fontSize === 'number' ? p.fontSize : 17,
        fontFamily: typeof p.fontFamily === 'string' ? p.fontFamily : DEFAULT_FONT,
        lineSpacing: typeof p.lineSpacing === 'number' ? p.lineSpacing : 1.75,
        customFg: typeof p.customFg === 'string' ? p.customFg : '',
        customBg: typeof p.customBg === 'string' ? p.customBg : '',
      })
      return prefsCache
    }
  } catch { /* ignore */ }
  prefsCache = { fontSize: 17, fontFamily: DEFAULT_FONT, lineSpacing: 1.75, customFg: '', customBg: '' }
  return prefsCache
}

function savePrefs(p: EditorPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch { /* ignore */ }
  // 同步 CSS 变量（预览与编辑器统一）
  const el = document.documentElement
  el.style.setProperty('--editor-font-size', `${p.fontSize}px`)
  el.style.setProperty('--editor-font-family', p.fontFamily)
  if (p.customBg) el.style.setProperty('--editor-bg', p.customBg)
  else el.style.removeProperty('--editor-bg')
  if (p.customFg) el.style.setProperty('--editor-fg', p.customFg)
  else el.style.removeProperty('--editor-fg')
}

const listeners = new Set<() => void>()

export function getPrefs(): EditorPrefs {
  return loadPrefs()
}

export function setPrefs(patch: Partial<EditorPrefs>) {
  prefsCache = { ...loadPrefs(), ...patch }
  savePrefs(prefsCache)
  listeners.forEach(l => l())
}

export function subscribePrefs(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: '思源宋体 / Noto Serif SC', value: DEFAULT_FONT },
  { label: '宋体 SimSun', value: "'SimSun', 'Songti SC', serif" },
  { label: '楷体 KaiTi', value: "'KaiTi', 'Kaiti SC', 'STKaiti', serif" },
  { label: '黑体 SimHei', value: "'SimHei', 'Heiti SC', sans-serif" },
  { label: '微软雅黑 Microsoft YaHei', value: "'Microsoft YaHei', 'PingFang SC', sans-serif" },
  { label: '等宽 Consolas', value: "'Consolas', 'JetBrains Mono', monospace" },
  { label: 'Times New Roman（衬线）', value: "'Times New Roman', 'SimSun', serif" },
  { label: 'Georgia（衬线）', value: "'Georgia', 'SimSun', serif" },
  { label: 'Arial（无衬线）', value: "'Arial', 'Helvetica', sans-serif" },
  { label: 'Verdana（无衬线）', value: "'Verdana', sans-serif" },
  { label: 'Courier New（等宽）', value: "'Courier New', monospace" },
  { label: '系统默认', value: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif" },
]

// ── 主题默认配色方案（背景+文字色+字体）──────────────────

export interface ThemeScheme {
  bg: string
  fg: string
  fontFamily: string
}

export const THEME_SCHEMES: Record<Theme, ThemeScheme> = {
  light: { bg: '#ffffff', fg: '#1a1a1a', fontFamily: DEFAULT_FONT },
  dark: { bg: '#1e1f24', fg: '#e8e8ea', fontFamily: DEFAULT_FONT },
  'eye-care': { bg: '#d5fbe6', fg: '#2b3a2b', fontFamily: DEFAULT_FONT },
  'black-yellow': { bg: '#000000', fg: '#ffd700', fontFamily: DEFAULT_FONT },
}

// ── 用户配色方案（最多 10 个，可命名）────────────────────

export interface ColorPreset {
  name: string
  bg: string
  fg: string
  fontFamily: string
  lineSpacing: number
}

const PRESETS_KEY = 'platinum_color_presets'
const PRESET_MAX = 10

export function loadPresets(): ColorPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY)
    if (raw) {
      const list = JSON.parse(raw)
      if (Array.isArray(list)) {
        return list
          .filter(p => p && typeof p.name === 'string' && typeof p.bg === 'string')
          .map(p => ({ name: p.name, bg: p.bg, fg: p.fg || '#000000', fontFamily: p.fontFamily || DEFAULT_FONT, lineSpacing: typeof p.lineSpacing === 'number' ? p.lineSpacing : 1.75 }))
      }
    }
  } catch { /* ignore */ }
  return []
}

function persistPresets(list: ColorPreset[]) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(list))
  } catch { /* ignore */ }
}

// 保存（同名覆盖）或追加；返回新列表。超过 10 个时拒绝。
export function savePreset(name: string, scheme: Omit<ColorPreset, 'name'>): { ok: boolean; list: ColorPreset[]; error?: string } {
  const list = loadPresets()
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, list, error: 'name-required' }
  const idx = list.findIndex(p => p.name === trimmed)
  const entry: ColorPreset = { name: trimmed, ...scheme }
  if (idx >= 0) {
    list[idx] = entry
  } else {
    if (list.length >= PRESET_MAX) return { ok: false, list, error: 'max-10' }
    list.push(entry)
  }
  persistPresets(list)
  return { ok: true, list }
}

export function deletePreset(name: string): ColorPreset[] {
  const list = loadPresets().filter(p => p.name !== name)
  persistPresets(list)
  return list
}

import { useState } from 'react'
import { Palette, RotateCcw, Save, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTheme, type Theme } from '@/hooks/useTheme'
import { useEditorPrefs } from '@/hooks/useEditorPrefs'
import {
  setPrefs, getPrefs, FONT_OPTIONS, THEME_SCHEMES,
  loadPresets, savePreset, deletePreset, type EditorPrefs, type ColorPreset,
} from '@/lib/editorTheme'

const THEME_NAMES: Record<Theme, string> = {
  light: '浅色',
  dark: '深色',
  'eye-care': '护眼',
  'black-yellow': '黑黄高对比',
  'pink-soft': '浅粉',
  'warm-gray': '暖灰',
  'cool-gray-blue': '淡蓝灰',
  'soft-yellow': '浅黄',
}

const THEME_SWATCH: Record<Theme, { bg: string; fg: string }> = {
  light: { bg: '#ffffff', fg: '#1a1a1a' },
  dark: { bg: '#1e1f24', fg: '#e8e8ea' },
  'eye-care': { bg: '#d5fbe6', fg: '#2b3a2b' },
  'black-yellow': { bg: '#000000', fg: '#ffd700' },
  'pink-soft': { bg: '#fdeef2', fg: '#4a2d35' },
  'warm-gray': { bg: '#f5f0e8', fg: '#3d3833' },
  'cool-gray-blue': { bg: '#eef2f6', fg: '#33404d' },
  'soft-yellow': { bg: '#faf6e3', fg: '#4a4428' },
}

// 主界面快速切换的 4 个主题
const QUICK_THEMES: Theme[] = ['light', 'dark', 'eye-care', 'black-yellow']
const EXTRA_THEMES: Theme[] = ['pink-soft', 'warm-gray', 'cool-gray-blue', 'soft-yellow']

interface ThemePreset { name: string; bg: string; fg: string; border: string; font: string; fontSize: string }

function loadThemePresets(): ThemePreset[] {
  try { return JSON.parse(localStorage.getItem('themePresets') || '[]') } catch { return [] }
}
function saveThemePresets(list: ThemePreset[]) { localStorage.setItem('themePresets', JSON.stringify(list)) }

export default function AppearanceTab() {
  const { t } = useTranslation()
  const { theme, themeBg, themeBorder, themeFg, themeFont, themeFontSize, setTheme, setThemeBg, setThemeBorder, setThemeFg, setThemeFont, setThemeFontSize } = useTheme()
  const applied = useEditorPrefs() // 已生效的设定（保存后才更新）

  const [draft, setDraft] = useState<EditorPrefs>(() => ({ ...getPrefs() }))
  const [previewText, setPreviewText] = useState('')
  const [presets, setPresets] = useState<ColorPreset[]>(() => loadPresets())
  const [presetName, setPresetName] = useState('')
  const [selectedPreset, setSelectedPreset] = useState('')
  const [pendingTheme, setPendingTheme] = useState<Theme | null>(null)

  // 主题配色方案（独立保存）
  const [themePresets, setThemePresets] = useState<ThemePreset[]>(() => loadThemePresets())
  const [themePresetName, setThemePresetName] = useState('')
  const [selectedThemePreset, setSelectedThemePreset] = useState('')

  const isDirty = JSON.stringify(draft) !== JSON.stringify(applied)
  const dirtyStyle = isDirty ? 'ring-2 ring-amber-500/70' : ''

  const previewBg = draft.customBg || THEME_SWATCH[theme].bg
  const previewFg = draft.customFg || THEME_SWATCH[theme].fg

  function applyDraft(next: Partial<EditorPrefs>) {
    setDraft(prev => ({ ...prev, ...next }))
  }

  function handleSave() {
    setPrefs(draft)
  }

  // 重置全部：主题自定义 + 编辑器草稿（恢复默认）
  function handleResetAll() {
    setThemeBorder(''); setThemeFg(''); setThemeBg(''); setThemeFont(''); setThemeFontSize('')
    setDraft({ ...getPrefs() })
    setPrefs({ ...getPrefs() })
    setPreviewText('')
  }

  function handlePickTheme(th: Theme) {
    setTheme(th)
    setPendingTheme(th)
  }

  function confirmSyncTheme() {
    if (!pendingTheme) return
    const s = THEME_SCHEMES[pendingTheme]
    const next: EditorPrefs = { ...draft, customBg: s.bg, customFg: s.fg, fontFamily: s.fontFamily }
    setDraft(next)
    setPrefs(next)
    setPendingTheme(null)
  }

  // 编辑器配色方案
  function handleApplyPreset(name: string) {
    const p = presets.find(x => x.name === name)
    if (!p) return
    setSelectedPreset(name)
    setPresetName(name)
    applyDraft({ customBg: p.bg, customFg: p.fg, fontFamily: p.fontFamily, lineSpacing: p.lineSpacing })
  }
  function handleSavePreset() {
    const name = presetName.trim()
    if (!name) return
    const res = savePreset(name, {
      bg: draft.customBg || THEME_SWATCH[theme].bg,
      fg: draft.customFg || THEME_SWATCH[theme].fg,
      fontFamily: draft.fontFamily,
      lineSpacing: draft.lineSpacing,
    })
    if (res.ok) { setPresets(res.list); setSelectedPreset(name); setPresetName('') }
    else if (res.error === 'max-10') alert(t('settings.presetMax10'))
  }
  function handleDeletePreset() {
    if (!selectedPreset) return
    if (!confirm(t('settings.presetDeleteConfirm') + `\n${selectedPreset}`)) return
    setPresets(deletePreset(selectedPreset))
    setSelectedPreset('')
  }

  // 主题配色方案（独立）
  function handleApplyThemePreset(name: string) {
    const p = themePresets.find(x => x.name === name)
    if (!p) return
    setSelectedThemePreset(name)
    setThemePresetName(name)
    setThemeBg(p.bg); setThemeFg(p.fg); setThemeBorder(p.border); setThemeFont(p.font); setThemeFontSize(p.fontSize)
  }
  function handleSaveThemePreset() {
    const name = themePresetName.trim()
    if (!name) return
    const list = [...themePresets.filter(x => x.name !== name), {
      name,
      bg: themeBg || THEME_SWATCH[theme].bg,
      fg: themeFg || THEME_SWATCH[theme].fg,
      border: themeBorder || '',
      font: themeFont || '',
      fontSize: themeFontSize || '',
    }].slice(-10)
    setThemePresets(list); saveThemePresets(list)
    setSelectedThemePreset(name); setThemePresetName('')
  }
  function handleDeleteThemePreset() {
    if (!selectedThemePreset) return
    if (!confirm(t('settings.presetDeleteConfirm') + `\n${selectedThemePreset}`)) return
    const list = themePresets.filter(x => x.name !== selectedThemePreset)
    setThemePresets(list); saveThemePresets(list)
    setSelectedThemePreset('')
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 顶部固定区：标题 + 常驻按钮（重置/保存）+ 主题选择 + 预览 */}
      <div className="shrink-0 pb-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium flex items-center gap-1.5">
            <Palette className="w-4 h-4" />
            {t('settings.appearance')}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleResetAll}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs border transition-colors"
              style={{ background: '#111111', color: '#ffffff', borderColor: '#ffffff' }}
              title={t('settings.resetAll')}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t('settings.resetAll')}
            </button>
            <button
              onClick={handleSave}
              disabled={!isDirty}
              className={`inline-flex items-center gap-1.5 h-8 px-4 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 ${dirtyStyle}`}
            >
              <Save className="w-3.5 h-3.5" />
              {t('settings.saveAppearance')}
            </button>
          </div>
        </div>
        {isDirty && <p className="text-[11px] text-amber-600 -mt-2 mb-2">{t('settings.unsavedHint')}</p>}

        {/* 主题选择：快速 4 + 可选 4 */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">{t('settings.theme')}</label>
          <div className="grid grid-cols-4 gap-2">
            {QUICK_THEMES.map(th => (
              <button
                key={th}
                onClick={() => handlePickTheme(th)}
                className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border transition-colors ${
                  theme === th ? 'ring-2 ring-primary border-primary' : 'hover:bg-muted'
                }`}
              >
                <span
                  className="w-full h-9 rounded border flex items-center justify-center text-[10px]"
                  style={{ background: THEME_SWATCH[th].bg, color: THEME_SWATCH[th].fg }}
                >
                  {THEME_NAMES[th]}
                </span>
                <span className="text-[11px]">{THEME_NAMES[th]}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {EXTRA_THEMES.map(th => (
              <button
                key={th}
                onClick={() => handlePickTheme(th)}
                className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border transition-colors ${
                  theme === th ? 'ring-2 ring-primary border-primary' : 'hover:bg-muted'
                }`}
              >
                <span
                  className="w-full h-9 rounded border flex items-center justify-center text-[10px]"
                  style={{ background: THEME_SWATCH[th].bg, color: THEME_SWATCH[th].fg }}
                >
                  {THEME_NAMES[th]}
                </span>
                <span className="text-[11px]">{THEME_NAMES[th]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 预览 */}
        <div className="mt-3 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t('settings.previewTitle')}</label>
          <textarea
            value={previewText}
            onChange={e => setPreviewText(e.target.value)}
            placeholder={t('settings.previewPlaceholder')}
            className="w-full h-8 rounded-md border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
          <div
            className="w-full max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border px-3 py-2 min-h-12"
            style={{
              background: previewBg,
              color: previewFg,
              fontSize: draft.fontSize,
              fontFamily: draft.fontFamily,
              lineHeight: draft.lineSpacing,
              borderColor: previewFg,
            }}
          >
            {previewText || t('settings.previewSample')}
          </div>
        </div>
      </div>

      {/* 下方滚动区：编辑器设定 + 编辑器配色保存 / 主题自定义 + 主题配色保存 */}
      <div className="flex-1 min-h-0 overflow-y-auto pt-4 space-y-4">

        {/* ── 编辑器设定（正文区：字号/字体/行距/颜色，保存生效）── */}
        <div className="rounded-lg border p-3 bg-muted/10 space-y-2">
          <label className="text-xs font-semibold text-foreground">{t('settings.customEditorSection')}</label>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-16 shrink-0">{t('settings.editorFontSize')}</label>
            <input type="range" min={10} max={48} step={1} value={draft.fontSize} onChange={e => applyDraft({ fontSize: Number(e.target.value) })} className="flex-1 min-w-0" />
            <input type="number" min={10} max={48} value={draft.fontSize} onChange={e => applyDraft({ fontSize: Number(e.target.value) })} className="w-14 h-7 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
            <span className="text-[11px] text-muted-foreground shrink-0">px</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-16 shrink-0">{t('settings.editorFontFamily')}</label>
            <select value={draft.fontFamily} onChange={e => applyDraft({ fontFamily: e.target.value })} className="flex-1 h-7 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary">
              {FONT_OPTIONS.map(f => <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-16 shrink-0">{t('settings.lineSpacing')}</label>
            <input type="range" min={0.8} max={4} step={0.05} value={draft.lineSpacing} onChange={e => applyDraft({ lineSpacing: Number(e.target.value) })} className="flex-1 min-w-0" />
            <input type="number" min={0.8} max={4} step={0.05} value={draft.lineSpacing} onChange={e => applyDraft({ lineSpacing: Number(e.target.value) })} className="w-14 h-7 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
            <span className="text-[11px] text-muted-foreground shrink-0">×</span>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t('settings.customFg')}
              <input type="color" value={draft.customFg || THEME_SCHEMES[theme].fg} onChange={e => applyDraft({ customFg: e.target.value })} className="w-7 h-7 rounded border bg-background cursor-pointer" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t('settings.customBg')}
              <input type="color" value={draft.customBg || THEME_SCHEMES[theme].bg} onChange={e => applyDraft({ customBg: e.target.value })} className="w-7 h-7 rounded border bg-background cursor-pointer" />
            </label>
            <button onClick={() => applyDraft({ customFg: '', customBg: '' })} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs border transition-colors" style={{ background: '#111111', color: '#ffffff', borderColor: '#ffffff' }}>
              <RotateCcw className="w-3 h-3" />{t('settings.restoreDefault')}
            </button>
          </div>

          {/* 编辑器配色保存（独立） */}
          <div className="border-t pt-2 space-y-1.5">
            <label className="text-[11px] text-muted-foreground">{t('settings.myPresets')}</label>
            <div className="flex items-center gap-2">
              <select value={selectedPreset} onChange={e => handleApplyPreset(e.target.value)} className="flex-1 h-8 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="">{t('settings.presetSelectPlaceholder')}</option>
                {presets.map(p => <option key={p.name} value={p.name}>{p.name}（{p.fg} / {p.bg} / ×{p.lineSpacing.toFixed(2)}）</option>)}
              </select>
              <button onClick={handleDeletePreset} disabled={!selectedPreset} title={t('settings.deletePreset')} className="inline-flex items-center gap-1 h-8 px-3 rounded-md text-xs border hover:bg-muted transition-colors disabled:opacity-40">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input value={presetName} onChange={e => setPresetName(e.target.value)} placeholder={t('settings.presetNamePlaceholder')} className="flex-1 h-8 rounded-md border bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
              <button onClick={handleSavePreset} className="inline-flex items-center gap-1 h-8 px-3 rounded-md text-xs border hover:bg-muted transition-colors">
                <Plus className="w-3.5 h-3.5" />{t('settings.savePreset')}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">{t('settings.presetDesc')}</p>
          </div>
        </div>

        {/* ── 自定义主题（全局界面：边框/系统文字/背景/字体字号，立即生效）── */}
        <div className="rounded-lg border p-3 bg-muted/10 space-y-2">
          <label className="text-xs font-semibold text-foreground">{t('settings.customThemeSection')}</label>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title={t('settings.themeBorderDesc')}>
              {t('settings.themeBorder')}
              <input type="color" value={themeBorder || '#e2e8f0'} onChange={e => setThemeBorder(e.target.value)} className="w-7 h-7 rounded border bg-background cursor-pointer" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title={t('settings.themeFgDesc')}>
              {t('settings.themeFg')}
              <input type="color" value={themeFg || '#1a1a1a'} onChange={e => setThemeFg(e.target.value)} className="w-7 h-7 rounded border bg-background cursor-pointer" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title={t('settings.themeBgDesc')}>
              {t('settings.themeBg')}
              <input type="color" value={themeBg || THEME_SWATCH[theme].bg} onChange={e => setThemeBg(e.target.value)} className="w-7 h-7 rounded border bg-background cursor-pointer" />
            </label>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t('settings.themeFont')}
              <select value={themeFont || ''} onChange={e => setThemeFont(e.target.value)} className="h-7 rounded-md border bg-background px-1.5 text-xs focus:outline-none">
                <option value="">{t('settings.themeFontDefault')}</option>
                {FONT_OPTIONS.map(f => <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t('settings.themeFontSize')}
              <input type="number" min={11} max={20} value={themeFontSize || ''} onChange={e => setThemeFontSize(e.target.value)} placeholder="13" className="w-16 h-7 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
              <span className="text-[10px]">px</span>
            </label>
            <button onClick={() => { setThemeBorder(''); setThemeFg(''); setThemeBg(''); setThemeFont(''); setThemeFontSize('') }} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs border transition-colors" style={{ background: '#111111', color: '#ffffff', borderColor: '#ffffff' }} title={t('settings.restoreDefault')}>
              <RotateCcw className="w-3 h-3" />{t('settings.restoreDefault')}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t('settings.customThemeDesc')}</p>

          {/* 主题配色保存（独立） */}
          <div className="border-t pt-2 space-y-1.5">
            <label className="text-[11px] text-muted-foreground">{t('settings.themePresets')}</label>
            <div className="flex items-center gap-2">
              <select value={selectedThemePreset} onChange={e => handleApplyThemePreset(e.target.value)} className="flex-1 h-8 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="">{t('settings.presetSelectPlaceholder')}</option>
                {themePresets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
              <button onClick={handleDeleteThemePreset} disabled={!selectedThemePreset} title={t('settings.deletePreset')} className="inline-flex items-center gap-1 h-8 px-3 rounded-md text-xs border hover:bg-muted transition-colors disabled:opacity-40">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input value={themePresetName} onChange={e => setThemePresetName(e.target.value)} placeholder={t('settings.themePresetNamePlaceholder')} className="flex-1 h-8 rounded-md border bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
              <button onClick={handleSaveThemePreset} className="inline-flex items-center gap-1 h-8 px-3 rounded-md text-xs border hover:bg-muted transition-colors">
                <Plus className="w-3.5 h-3.5" />{t('settings.saveThemePreset')}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">{t('settings.themePresetDesc')}</p>
          </div>
        </div>
      </div>

      {/* 主题切换确认框 */}
      {pendingTheme && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPendingTheme(null)} />
          <div className="relative bg-background rounded-xl shadow-2xl border w-[400px] p-5">
            <h4 className="text-sm font-medium mb-2">{t('settings.themeSyncTitle')}</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t('settings.themeSyncConfirm', { name: THEME_NAMES[pendingTheme] })}
            </p>
            <p className="text-[11px] text-amber-600 mt-1.5">{t('settings.themeSyncSuggest')}</p>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button onClick={confirmSyncTheme} className="h-8 px-4 rounded-md text-xs border bg-background hover:bg-muted transition-colors">
                {t('settings.themeSyncConfirmBtn')}
              </button>
              <button onClick={() => setPendingTheme(null)} className="h-8 px-4 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
                {t('settings.themeSyncCancelBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { Palette, RotateCcw, Save, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTheme, THEMES, type Theme } from '@/hooks/useTheme'
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
}

const THEME_SWATCH: Record<Theme, { bg: string; fg: string }> = {
  light: { bg: '#ffffff', fg: '#1a1a1a' },
  dark: { bg: '#1e1f24', fg: '#e8e8ea' },
  'eye-care': { bg: '#d5fbe6', fg: '#2b3a2b' },
  'black-yellow': { bg: '#000000', fg: '#ffd700' },
}

export default function AppearanceTab() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const applied = useEditorPrefs() // 已生效的设定（保存后才更新）

  // 草稿状态：编辑时只改草稿与预览，点「保存」才生效
  const [draft, setDraft] = useState<EditorPrefs>(() => ({ ...getPrefs() }))
  const [previewText, setPreviewText] = useState('')
  const [presets, setPresets] = useState<ColorPreset[]>(() => loadPresets())
  const [presetName, setPresetName] = useState('')
  const [selectedPreset, setSelectedPreset] = useState('')
  const [pendingTheme, setPendingTheme] = useState<Theme | null>(null) // 待确认同步的主题

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

  // 主题切换：先切主题，再询问是否同步该主题的字体+背景
  // 【确定=白色·同步字体背景】【取消=蓝色·仅切换主题（推荐）】
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

  // 应用某个方案：直接替换当前草稿（颜色/字体/间距），预览实时呈现；名称同步到输入框便于直接覆盖保存
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
    if (res.ok) {
      setPresets(res.list)
      setSelectedPreset(name)
      setPresetName('')
    } else if (res.error === 'max-10') {
      alert(t('settings.presetMax10'))
    }
  }

  function handleDeletePreset() {
    if (!selectedPreset) return
    if (!confirm(t('settings.presetDeleteConfirm') + `\n${selectedPreset}`)) return
    setPresets(deletePreset(selectedPreset))
    setSelectedPreset('')
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 顶部固定区：标题 + 主题选择 + 预览（横向铺满，不滚动） */}
      <div className="shrink-0 pb-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium flex items-center gap-1.5">
            <Palette className="w-4 h-4" />
            {t('settings.appearance')}
          </h3>
          <button
            onClick={handleSave}
            disabled={!isDirty}
            className={`inline-flex items-center gap-1.5 h-8 px-4 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 ${dirtyStyle}`}
          >
            <Save className="w-3.5 h-3.5" />
            {t('settings.saveAppearance')}
          </button>
        </div>
        {isDirty && <p className="text-[11px] text-amber-600 -mt-2 mb-2">{t('settings.unsavedHint')}</p>}

        {/* 主题选择 */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">{t('settings.theme')}</label>
          <div className="grid grid-cols-4 gap-2">
            {THEMES.map(th => (
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

        {/* 预览（小型只读正文框，横向铺满，固定） */}
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

      {/* 下方滚动区：字号/字体/行距/颜色/方案 */}
      <div className="flex-1 min-h-0 overflow-y-auto pt-4">

        {/* 字号（紧凑：滑块 + 数字直输） */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground w-20 shrink-0">{t('settings.editorFontSize')}</label>
            <input
              type="range"
              min={10}
            max={48}
              step={1}
              value={draft.fontSize}
              onChange={e => applyDraft({ fontSize: Number(e.target.value) })}
              className="flex-1 min-w-0"
            />
            <input
              type="number"
              min={10}
            max={48}
              value={draft.fontSize}
              onChange={e => applyDraft({ fontSize: Number(e.target.value) })}
              className="w-14 h-7 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-[11px] text-muted-foreground shrink-0">px</span>
          </div>
        </div>

        {/* 字体（紧凑：窄下拉） */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground w-20 shrink-0">{t('settings.editorFontFamily')}</label>
            <select
              value={draft.fontFamily}
              onChange={e => applyDraft({ fontFamily: e.target.value })}
              className="w-1/4 min-w-[150px] h-7 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {FONT_OPTIONS.map(f => (
                <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 行间距（紧凑：滑块 + 数字直输） */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground w-20 shrink-0">{t('settings.lineSpacing')}</label>
            <input
              type="range"
              min={0.8}
            max={4}
              step={0.05}
              value={draft.lineSpacing}
              onChange={e => applyDraft({ lineSpacing: Number(e.target.value) })}
              className="flex-1 min-w-0"
            />
            <input
              type="number"
              min={0.8}
            max={4}
              step={0.05}
              value={draft.lineSpacing}
              onChange={e => applyDraft({ lineSpacing: Number(e.target.value) })}
              className="w-14 h-7 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-[11px] text-muted-foreground shrink-0">×</span>
          </div>
        </div>

        {/* 自定义颜色（紧凑） */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t('settings.customColors')}</label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t('settings.customFg')}
              <input
                type="color"
                value={draft.customFg || THEME_SCHEMES[theme].fg}
                onChange={e => applyDraft({ customFg: e.target.value })}
                className="w-7 h-7 rounded border bg-background cursor-pointer"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t('settings.customBg')}
              <input
                type="color"
                value={draft.customBg || THEME_SCHEMES[theme].bg}
                onChange={e => applyDraft({ customBg: e.target.value })}
                className="w-7 h-7 rounded border bg-background cursor-pointer"
              />
            </label>
            <button
              onClick={() => applyDraft({ customFg: '', customBg: '' })}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs border hover:bg-muted transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              {t('settings.restoreDefault')}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t('settings.customColorsDesc')}</p>
        </div>

        {/* 我的配色方案（最多 10 个，下拉选择） */}
        <div className="mt-5 space-y-2">
          <label className="text-xs font-medium text-muted-foreground">{t('settings.myPresets')}</label>
          <div className="flex items-center gap-2">
            <select
              value={selectedPreset}
              onChange={e => handleApplyPreset(e.target.value)}
              className="flex-1 h-9 rounded-md border bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">{t('settings.presetSelectPlaceholder')}</option>
              {presets.map(p => (
                <option key={p.name} value={p.name}>
                  {p.name}（{p.fg} / {p.bg} / ×{p.lineSpacing.toFixed(2)}）
                </option>
              ))}
            </select>
            <button
              onClick={handleDeletePreset}
              disabled={!selectedPreset}
              title={t('settings.deletePreset')}
              className="inline-flex items-center gap-1 h-9 px-3 rounded-md text-xs border hover:bg-muted transition-colors disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={presetName}
              onChange={e => setPresetName(e.target.value)}
              placeholder={t('settings.presetNamePlaceholder')}
              className="flex-1 h-8 rounded-md border bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={handleSavePreset}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-md text-xs border hover:bg-muted transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('settings.savePreset')}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t('settings.presetDesc')}</p>
        </div>
      </div>
      {/* 主题切换确认框：确定=白（同步字体背景），取消=蓝（仅切主题，推荐） */}
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
              <button
                onClick={confirmSyncTheme}
                className="h-8 px-4 rounded-md text-xs border bg-background hover:bg-muted transition-colors"
              >
                {t('settings.themeSyncConfirmBtn')}
              </button>
              <button
                onClick={() => setPendingTheme(null)}
                className="h-8 px-4 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                {t('settings.themeSyncCancelBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

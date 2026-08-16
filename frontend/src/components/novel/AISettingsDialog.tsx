import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck, AlertTriangle, Save, Zap } from 'lucide-react'
import type { novel } from '@/hooks/useApp'

interface Props {
  open: boolean
  novel?: novel.Novel | null
  onClose: () => void
  onSave: (input: {
    break_words: string
    break_words_1: string
    break_words_2: string
    break_words_3: string
    ai_config: string
  }) => Promise<void>
}

const CORE_MODULES = ['outline', 'character', 'timeline'] as const
const OPT_MODULES = ['reader', 'arc'] as const

export default function AISettingsDialog({ open, novel, onClose, onSave }: Props) {
  const { t } = useTranslation()
  const [bw1, setBw1] = useState('')
  const [bw2, setBw2] = useState('')
  const [bw3, setBw3] = useState('')
  const [injectWorld, setInjectWorld] = useState(true)
  const [injectPlatinum, setInjectGoink] = useState(true)
  const [maint, setMaint] = useState<string[]>([...CORE_MODULES, ...OPT_MODULES])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setBw1((novel as any)?.break_words_1 ?? novel?.break_words ?? '')
    setBw2((novel as any)?.break_words_2 ?? '')
    setBw3((novel as any)?.break_words_3 ?? '')
    const cfgRaw = (novel as any)?.ai_config || ''
    let cfg: any = null
    try { cfg = cfgRaw ? JSON.parse(cfgRaw) : null } catch { cfg = null }
    setInjectWorld(cfg ? !!cfg.inject_world : true)
    setInjectGoink(cfg ? !!cfg.inject_goink : true)
    if (cfg && Array.isArray(cfg.maint) && cfg.maint.length > 0) setMaint([...cfg.maint])
    else setMaint([...CORE_MODULES, ...OPT_MODULES])
    setError('')
  }, [open, novel])

  function toggleMaint(mod: string) {
    const isOn = maint.includes(mod)
    if (isOn && CORE_MODULES.includes(mod as any)) {
      if (!confirm(t('novel.coreModuleWarn', { name: t(`novel.maint_${mod}`) }))) return
    }
    setMaint(prev => isOn ? prev.filter(m => m !== mod) : [...prev, mod])
  }

  function buildAIConfig(): string {
    // 统一勾选「故事状态文档」= 注入 + 维护 两个权限一起控制
    const maintWithPlatinum = injectPlatinum
      ? (maint.includes('platinum') ? maint : [...maint, 'platinum'])
      : maint.filter(m => m !== 'platinum')
    const allOn = injectWorld && injectPlatinum && maintWithPlatinum.length === CORE_MODULES.length + OPT_MODULES.length + 1
    if (allOn) return ''
    return JSON.stringify({ inject_world: injectWorld, inject_goink: injectPlatinum, maint: maintWithPlatinum })
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await onSave({
        break_words: bw1.trim(),
        break_words_1: bw1.trim(),
        break_words_2: bw2.trim(),
        break_words_3: bw3.trim(),
        ai_config: buildAIConfig(),
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-background rounded-xl shadow-2xl border w-[560px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4" />
            {t('novel.aiSettings')}
          </h3>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="h-8 px-4 rounded-md text-xs border hover:bg-muted transition-colors">
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {/* 核心区 */}
          <div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              {t('novel.coreSection')}
            </div>

            <div className="mt-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <ShieldCheck className="w-3.5 h-3.5" />
                {t('novel.breakWords')}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">{t('novel.breakWordsRoundsHint')}</p>
              {[1, 2, 3].map(round => {
                const val = round === 1 ? bw1 : round === 2 ? bw2 : bw3
                const set = round === 1 ? setBw1 : round === 2 ? setBw2 : setBw3
                return (
                  <div key={round} className="mt-1.5">
                    <label className="text-[11px] text-muted-foreground">{t('novel.breakWordsRound', { n: round })}</label>
                    <textarea
                      value={val}
                      onChange={e => set(e.target.value)}
                      rows={1}
                      placeholder={t('novel.breakWordsPlaceholder')}
                      className="mt-0.5 w-full rounded-md border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                    />
                  </div>
                )
              })}
            </div>

            {/* 核心勾选项说明：放在破甲词内容结束后，带 ! 图标醒目 */}
            <p className="flex items-start gap-1 text-[11px] text-amber-600/90 mt-2">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              <span>{t('novel.coreSectionDesc')}</span>
            </p>

            <div className="mt-2 space-y-1.5">
              <div className="text-[11px] text-muted-foreground">{t('novel.injectSection')}</div>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={injectWorld} onChange={e => {
                  if (e.target.checked || confirm(t('novel.coreModuleWarn', { name: t('novel.injectWorld') }))) setInjectWorld(e.target.checked)
                }} className="accent-primary" />
                {t('novel.injectWorld')}
              </label>
              <label className="flex items-start gap-2 text-xs py-0.5">
                <input type="checkbox" checked={injectPlatinum} onChange={e => {
                  if (e.target.checked || confirm(t('novel.coreModuleWarn', { name: t('novel.platinumUnified') }))) setInjectGoink(e.target.checked)
                }} className="accent-primary mt-0.5" />
                <span className="min-w-0">
                  <span className="block">{t('novel.platinumUnified')}</span>
                  <span className="block text-[10px] text-muted-foreground/80 leading-snug">{t('novel.platinumUnifiedDesc')}</span>
                </span>
              </label>
            </div>

            <div className="mt-2 space-y-1.5">
              <div className="text-[11px] text-muted-foreground">{t('novel.maintSection')}</div>
              {CORE_MODULES.map(mod => (
                <label key={mod} className="flex items-start gap-2 text-xs py-0.5">
                  <input type="checkbox" checked={maint.includes(mod)} onChange={() => toggleMaint(mod)} className="accent-primary mt-0.5" />
                  <span className="min-w-0">
                    <span className="block">{t(`novel.maint_${mod}`)}</span>
                    <span className="block text-[10px] text-muted-foreground/80 leading-snug">{t(`novel.maint_${mod}_desc`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="border-t border-dashed my-3" />

          {/* 可选区 */}
          <div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <AlertTriangle className="w-3.5 h-3.5" />
              {t('novel.optSection')}
            </div>
            <p className="flex items-start gap-1 text-[11px] text-muted-foreground mt-0.5">
              <span>{t('novel.optSectionDesc')}</span>
            </p>
            <div className="mt-1.5 space-y-1.5">
              {OPT_MODULES.map(mod => (
                <label key={mod} className="flex items-start gap-2 text-xs py-0.5">
                  <input type="checkbox" checked={maint.includes(mod)} onChange={() => toggleMaint(mod)} className="accent-primary mt-0.5" />
                  <span className="min-w-0">
                    <span className="block">{t(`novel.maint_${mod}`)}</span>
                    <span className="block text-[10px] text-muted-foreground/80 leading-snug">{t(`novel.maint_${mod}_desc`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
        </div>
      </div>
    </div>
  )
}

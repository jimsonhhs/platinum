import { useState, useEffect, useCallback } from 'react'
import { Library, Power, Trash2, ChevronDown, ChevronRight, Loader2, CheckCircle2, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '@/hooks/useApp'
import { toastError, toastSuccess } from '@/lib/utils'

interface Props {
  novelId: number | null
}

// 全局文风库：列表 + 预览 + 按书启用/停用 + 删除
export default function StyleLibraryPanel({ novelId }: Props) {
  const { t } = useTranslation()
  const app = useApp()
  const [styles, setStyles] = useState<{ name: string; size: number }[]>([])
  const [enabled, setEnabled] = useState('')
  const [previewName, setPreviewName] = useState<string | null>(null)
  const [preview, setPreview] = useState('')
  const [previewLoaded, setPreviewLoaded] = useState(false) // 区分"加载中"与"加载完但为空"
  const [editingPreview, setEditingPreview] = useState(false)
  const [editDraft, setEditDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setStyles((await app.ListStyles()) ?? [])
    } catch { /* ignore */ }
    if (novelId) {
      try {
        setEnabled((await app.GetEnabledStyle(novelId)) ?? '')
      } catch { /* ignore */ }
    }
  }, [app, novelId])

  useEffect(() => { load() }, [load])

  // 文风库变动（存入/删除）后自动刷新
  useEffect(() => {
    const handler = () => load()
    window.addEventListener('platinum:style-library-changed', handler)
    return () => window.removeEventListener('platinum:style-library-changed', handler)
  }, [load])

  async function handlePreview(name: string) {
    if (previewName === name) { setPreviewName(null); setPreview(''); setPreviewLoaded(false); setEditingPreview(false); return }
    setPreviewName(name)
    setPreview('')
    setPreviewLoaded(false)
    setEditingPreview(false)
    try {
      setPreview((await app.GetStyleContent(name)) ?? '')
      setPreviewLoaded(true)
    } catch (err) {
      setPreviewLoaded(true) // 出错也结束加载态，显示错误提示
      toastError(String(err))
    }
  }

  // 进入编辑：载入当前内容到草稿
  function handleStartEdit() {
    setEditDraft(preview)
    setEditingPreview(true)
  }

  // 保存编辑：覆盖写回文风库（同名文件），并广播刷新
  async function handleSaveEdit() {
    if (!previewName) return
    setSaving(true)
    try {
      const fileName = await app.SaveStyleToLibrary(previewName.replace(/\.md$/, ''), editDraft)
      setPreview(editDraft)
      setEditingPreview(false)
      window.dispatchEvent(new CustomEvent('platinum:style-library-changed'))
      toastSuccess(t('styleLib.saved') + `：${fileName}`)
    } catch (err) {
      toastError(String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(name: string) {
    if (!novelId) { toastError(t('styleLib.needNovel')); return }
    setBusy(name)
    try {
      const next = enabled === name ? '' : name
      await app.SetEnabledStyle(novelId, next)
      setEnabled(next)
    } catch (err) {
      toastError(String(err))
    } finally {
      setBusy(null)
    }
  }

  async function handleDelete(name: string) {
    if (!confirm(t('styleLib.deleteConfirm') + `\n${name}`)) return
    try {
      await app.DeleteStyle(name)
      if (previewName === name) { setPreviewName(null); setPreview('') }
      load()
    } catch (err) {
      toastError(String(err))
    }
  }

  return (
    <div className="border rounded-lg p-3 space-y-2 bg-background">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Library className="w-3.5 h-3.5 text-primary" />
        {t('styleLib.title')}
        {enabled && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-green-600">
            <CheckCircle2 className="w-3 h-3" />
            {t('styleLib.enabled')}：{enabled}
          </span>
        )}
      </div>

      {styles.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{t('styleLib.empty')}</p>
      ) : (
        <div className="space-y-1">
          {styles.map(s => (
            <div key={s.name} className="flex items-center gap-1.5 rounded-md border px-2 py-1.5">
              <button
                onClick={() => handlePreview(s.name)}
                className="flex items-center gap-1 text-xs truncate flex-1 min-w-0 text-left hover:text-primary transition-colors"
                title={t('styleLib.preview')}
              >
                {previewName === s.name
                  ? <ChevronDown className="w-3 h-3 shrink-0" />
                  : <ChevronRight className="w-3 h-3 shrink-0" />}
                <span className="truncate">{s.name}</span>
              </button>
              <button
                onClick={() => handleToggle(s.name)}
                disabled={busy === s.name}
                className={`inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] border transition-colors disabled:opacity-50 shrink-0 ${
                  enabled === s.name ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted'
                }`}
                title={enabled === s.name ? t('styleLib.disable') : t('styleLib.enable')}
              >
                {busy === s.name ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
                {enabled === s.name ? t('styleLib.on') : t('styleLib.off')}
              </button>
              <button
                onClick={() => handleDelete(s.name)}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title={t('styleLib.delete')}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {previewName && (
        <div className="border rounded-md p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground truncate">{previewName}</span>
            {!editingPreview ? (
              <button
                onClick={handleStartEdit}
                className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] border hover:bg-muted transition-colors shrink-0"
              >
                <Pencil className="w-3 h-3" />
                {t('styleLib.edit')}
              </button>
            ) : (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  {t('styleLib.save')}
                </button>
                <button
                  onClick={() => setEditingPreview(false)}
                  className="h-6 px-2 rounded text-[11px] border hover:bg-muted transition-colors"
                >
                  {t('common.cancel')}
                </button>
              </div>
            )}
          </div>
          {editingPreview ? (
            <textarea
              value={editDraft}
              onChange={e => setEditDraft(e.target.value)}
              className="w-full h-40 rounded border bg-background px-2 py-1.5 text-[11px] font-serif focus-visible:outline-none resize-y"
              placeholder={t('styleLib.editPlaceholder')}
            />
          ) : !previewLoaded ? (
            <pre className="text-[11px] whitespace-pre-wrap font-serif">{t('styleLib.loading')}</pre>
          ) : preview ? (
            <pre className="text-[11px] whitespace-pre-wrap font-serif max-h-48 overflow-y-auto">{preview}</pre>
          ) : (
            <p className="text-[11px] text-muted-foreground">{t('styleLib.emptyContent')}</p>
          )}
        </div>
      )}
    </div>
  )
}

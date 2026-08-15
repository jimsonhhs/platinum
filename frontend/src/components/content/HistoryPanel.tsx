import { useState, useEffect } from 'react'
import { History, X, RotateCcw, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '@/hooks/useApp'

interface Props {
  novelId: number
  relPath: string // 如 chapters/006.md、drafts/006.md、user_outlines/006.md
  allowRestore?: boolean // 正文大纲等只读场景隐藏恢复按钮（默认 true）
  onClose: () => void
  onRestored: () => void
}

export default function HistoryPanel({ novelId, relPath, allowRestore = true, onClose, onRestored }: Props) {
  const app = useApp()
  const { t } = useTranslation()
  const [entries, setEntries] = useState<{ name: string; size: number; mtime: string; words: number }[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState('')
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    app.ListHistory(novelId, relPath).then(list => {
      if (!alive) return
      setEntries(list ?? [])
      if (list && list.length > 0) setSelected(list[0].name)
    }).catch(err => {
      if (alive) setError(err instanceof Error ? err.message : String(err))
    }).finally(() => {
      if (alive) setLoading(false)
    })
    return () => { alive = false }
  }, [app, novelId, relPath])

  useEffect(() => {
    if (!selected) { setPreview(''); return }
    let alive = true
    setPreview('')
    app.GetContent(novelId, `history://${relPath}|${selected}`).then(c => {
      if (alive) setPreview(c ?? '')
    }).catch(() => {
      if (alive) setPreview(t('content.historyPreviewFailed'))
    })
    return () => { alive = false }
  }, [app, novelId, selected, t])

  async function handleRestore() {
    if (!selected) return
    if (!confirm(t('content.restoreHistoryConfirm') + `\n${selected}`)) return
    setRestoring(true)
    setError(null)
    try {
      await app.RestoreHistory(novelId, relPath, selected)
      onRestored()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-[720px] max-w-[92vw] h-[520px] max-h-[85vh] rounded-xl border bg-background shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
          <span className="text-sm font-medium flex items-center gap-2">
            <History className="w-4 h-4" />
            {t('content.historyTitle')}
            <span className="text-[11px] font-mono text-muted-foreground">{relPath}</span>
          </span>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* 列表 */}
          <div className="w-64 shrink-0 border-r overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : entries.length === 0 ? (
              <p className="text-[11px] text-muted-foreground px-2 py-3">{t('content.draftHistoryEmpty')}</p>
            ) : (
              entries.map(e => (
                <button
                  key={e.name}
                  onClick={() => setSelected(e.name)}
                  className={`w-full text-left px-2.5 py-2 rounded-md transition-colors ${
                    selected === e.name ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                  }`}
                >
                  <div className="text-[11px] font-mono truncate">{e.mtime}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {t('content.historyWords', { n: e.words })} · {t('content.historySize', { n: e.size })}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* 预览 */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 min-h-0 overflow-auto p-4">
              <pre className="text-xs leading-relaxed whitespace-pre-wrap font-serif">{preview}</pre>
            </div>
            <div className="flex items-center justify-between px-3 py-2 border-t shrink-0">
              {error ? <span className="text-[11px] text-destructive truncate">{error}</span> : <span />}
              {allowRestore && (
                <button
                  onClick={handleRestore}
                  disabled={!selected || restoring}
                  className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {restoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  {t('content.restoreHistory')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

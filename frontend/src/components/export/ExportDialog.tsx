import { useState, useEffect } from 'react'
import { BookOpen, FileText, AlignLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '@/hooks/useApp'
import type { chapter, novel } from '@/hooks/useApp'

interface Props {
  open: boolean
  novelId: number | null
  novelTitle: string
  onClose: () => void
  onExport: (format: 'epub' | 'markdown' | 'txt', selected: number[]) => Promise<void>
}

const FORMATS = [
  { id: 'epub' as const, label: 'EPUB', descKey: 'export.epubDesc', icon: BookOpen },
  { id: 'markdown' as const, label: 'Markdown', descKey: 'export.markdownDesc', icon: FileText },
  { id: 'txt' as const, label: 'TXT', descKey: 'export.textDesc', icon: AlignLeft },
] as const

export default function ExportDialog({ open, novelId, novelTitle, onClose, onExport }: Props) {
  const { t } = useTranslation()
  const app = useApp()
  const [format, setFormat] = useState<'epub' | 'markdown' | 'txt'>('epub')
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [chapters, setChapters] = useState<chapter.Chapter[]>([])
  const [volumes, setVolumes] = useState<novel.Volume[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!open || !novelId) return
    setError('')
    setSuccess(false)
    app.GetChapters(novelId).then(list => {
      setChapters(list ?? [])
      setSelected(new Set((list ?? []).map(c => c.chapter_number)))
    }).catch(() => {})
    app.GetVolumes(novelId).then(v => setVolumes(v ?? [])).catch(() => {})
  }, [open, novelId, app])

  function toggleChapter(num: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(num)) next.delete(num)
      else next.add(num)
      return next
    })
  }

  function toggleAll(on: boolean) {
    setSelected(on ? new Set(chapters.map(c => c.chapter_number)) : new Set())
  }

  function toggleVolume(v: number, on: boolean) {
    setSelected(prev => {
      const next = new Set(prev)
      for (const c of chapters) {
        if ((c.volume || 1) === v) {
          if (on) next.add(c.chapter_number)
          else next.delete(c.chapter_number)
        }
      }
      return next
    })
  }

  function volumeSelectedCount(v: number): number {
    return chapters.filter(c => (c.volume || 1) === v && selected.has(c.chapter_number)).length
  }
  function volumeTotalCount(v: number): number {
    return chapters.filter(c => (c.volume || 1) === v).length
  }

  async function handleExport() {
    if (selected.size === 0) {
      setError(t('export.noSelection'))
      return
    }
    setExporting(true)
    setError('')
    try {
      await onExport(format, [...selected])
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-background rounded-xl shadow-2xl border w-[560px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h3 className="text-base font-semibold">{t('export.title')}：{novelTitle}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none px-1">✕</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          {/* 格式 */}
          <div className="grid grid-cols-3 gap-2">
            {FORMATS.map(f => (
              <button
                key={f.id}
                onClick={() => setFormat(f.id)}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-colors ${
                  format === f.id ? 'ring-2 ring-primary border-primary' : 'hover:bg-muted'
                }`}
              >
                <f.icon className="w-5 h-5" />
                <span className="text-sm font-medium">{f.label}</span>
                <span className="text-[10px] text-muted-foreground text-center">{t(f.descKey)}</span>
              </button>
            ))}
          </div>

          {/* 章节选择 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t('export.selectChapters')}（{selected.size}/{chapters.length}）
              </span>
              <div className="flex items-center gap-2 text-[11px]">
                <button onClick={() => toggleAll(true)} className="text-primary hover:underline">{t('export.selectAll')}</button>
                <button onClick={() => toggleAll(false)} className="text-muted-foreground hover:underline">{t('export.selectNone')}</button>
              </div>
            </div>
            <div className="border rounded-md max-h-56 overflow-y-auto p-2 space-y-1.5">
              {volumes.map((vol, vi) => {
                const v = vi + 1
                const volChs = chapters.filter(c => (c.volume || 1) === v)
                if (volChs.length === 0) return null
                const vSel = volumeSelectedCount(v)
                const vTot = volumeTotalCount(v)
                const vAll = vSel === vTot && vTot > 0
                return (
                  <div key={v}>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={vAll}
                        onChange={e => toggleVolume(v, e.target.checked)}
                        className="accent-primary"
                      />
                      <span className="text-xs font-medium truncate">{vol.name}</span>
                      <button
                        onClick={() => toggleVolume(v, !vAll)}
                        className="text-[10px] text-muted-foreground hover:underline ml-auto"
                      >
                        {vAll ? t('export.selectNone') : t('export.selectAll')}
                      </button>
                    </div>
                    <div className="pl-5 grid grid-cols-4 gap-x-1 gap-y-0.5 mt-0.5">
                      {volChs.map(c => (
                        <label key={c.id} className="flex items-center gap-1 text-[11px] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selected.has(c.chapter_number)}
                            onChange={() => toggleChapter(c.chapter_number)}
                            className="accent-primary"
                          />
                          <span className="truncate tabular-nums">{String(c.chapter_number).padStart(3, '0')}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
          {success && <p className="text-xs text-green-600">{t('export.success')}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t shrink-0">
          <button onClick={onClose} className="h-8 px-4 rounded-md text-xs border hover:bg-muted transition-colors">
            {t('common.cancel')}
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || selected.size === 0}
            className="h-8 px-4 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {exporting ? t('common.exporting') : t('common.export')}
          </button>
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw, Trash2, Inbox, FileText, Wrench } from 'lucide-react'
import { toastError } from '@/lib/utils'
import { useApp } from '@/hooks/useApp'
import Markdown from '@/components/Markdown'
import type { trash } from '@/lib/wailsjs/go/models'

export default function TrashView({ novelId }: { novelId: number }) {
  const app = useApp()
  const { t } = useTranslation()
  const [items, setItems] = useState<trash.Item[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<trash.Item | null>(null)
  const [preview, setPreview] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [purging, setPurging] = useState(false)

  const keyOf = (it: trash.Item) => `${it.type}:${it.id}`

  const load = useCallback(async () => {
    if (!novelId) { setItems([]); setLoading(false); return }
    setLoading(true)
    try {
      const list = await app.ListTrashItems(novelId)
      setItems(list ?? [])
    } catch (err) {
      toastError(t('trash.loadFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [app, novelId, t])

  useEffect(() => { load() }, [load])

  async function selectItem(it: trash.Item) {
    setSelected(it)
    setPreview('')
    setPreviewLoading(true)
    try {
      const c = await app.GetTrashItemContent({ type: it.type, id: it.id })
      setPreview(c ?? '')
    } catch (err) {
      toastError(t('trash.loadFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setPreviewLoading(false)
    }
  }

  async function afterAction() {
    setSelected(null)
    setPreview('')
    setSelectedKeys([])
    await load()
  }

  const toggleSelect = (key: string) => {
    setSelectedKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  const allSelected = items.length > 0 && selectedKeys.length === items.length

  async function handleBatchPurge() {
    const targets = items.filter(it => selectedKeys.includes(keyOf(it)))
    if (targets.length === 0) return
    if (!confirm(t('trash.confirmPurgeSelected', { count: targets.length }))) return
    setPurging(true)
    try {
      await Promise.all(targets.map(it => app.PurgeTrashItem({ type: it.type, id: it.id })))
      await afterAction()
    } catch (err) {
      toastError(t('trash.purgeFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      console.error(err)
    } finally {
      setPurging(false)
    }
  }

  const chapters = items.filter(i => i.type === 'chapter')
  const skills = items.filter(i => i.type === 'skill')

  const labelOf = (it: trash.Item) =>
    it.type === 'chapter'
      ? `${t('trash.chapterLabel', { n: it.name })}${it.title ? ` ${it.title}` : ''}`
      : it.name

  async function handleRestore(it: trash.Item) {
    try {
      await app.RestoreTrashItem({ type: it.type, id: it.id })
      await afterAction()
    } catch (err) {
      toastError(t('trash.restoreFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      console.error(err)
    }
  }

  async function handlePurge(it: trash.Item) {
    if (!confirm(t('trash.confirmPurge') + `「${labelOf(it)}」？` + t('trash.irreversible'))) return
    try {
      await app.PurgeTrashItem({ type: it.type, id: it.id })
      await afterAction()
    } catch (err) {
      toastError(t('trash.purgeFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      console.error(err)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      <div className="px-6 py-4 border-b shrink-0">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Inbox className="w-4 h-4 text-muted-foreground" />
          {t('trash.title')}
        </h2>
        <p className="text-xs text-muted-foreground mt-1">{t('trash.hint')}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <p className="text-xs text-muted-foreground">{t('trash.loading')}</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Inbox className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-xs">{t('trash.empty')}</p>
          </div>
        ) : (
          <div className="space-y-6 max-w-3xl">
            {/* 批量选择工具栏 */}
            <div className="flex items-center justify-between border rounded-md px-3 py-2">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedKeys(allSelected ? [] : items.map(keyOf))}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {allSelected ? t('trash.selectNone') : t('trash.selectAll')}
                </button>
                {selectedKeys.length > 0 && (
                  <span className="text-xs text-muted-foreground">{t('trash.selectedCount', { count: selectedKeys.length })}</span>
                )}
              </div>
              {selectedKeys.length > 0 && (
                <button
                  onClick={handleBatchPurge}
                  disabled={purging}
                  className="flex items-center gap-1 px-2.5 py-1 rounded text-xs border hover:bg-muted text-destructive hover:text-destructive transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-3 h-3" />
                  {purging ? t('trash.purging') : t('trash.purgeSelected')}
                </button>
              )}
            </div>

            {chapters.length > 0 && (
              <TrashGroup
                title={t('trash.chapters')}
                items={chapters}
                icon={<FileText className="w-3.5 h-3.5" />}
                labelOf={labelOf}
                selectedId={selected ? `${selected.type}:${selected.id}` : null}
                selectedKeys={selectedKeys}
                onToggleSelect={toggleSelect}
                onSelect={selectItem}
                onRestore={handleRestore}
                onPurge={handlePurge}
                t={t}
              />
            )}
            {skills.length > 0 && (
              <TrashGroup
                title={t('trash.skills')}
                items={skills}
                icon={<Wrench className="w-3.5 h-3.5" />}
                labelOf={labelOf}
                selectedId={selected ? `${selected.type}:${selected.id}` : null}
                selectedKeys={selectedKeys}
                onToggleSelect={toggleSelect}
                onSelect={selectItem}
                onRestore={handleRestore}
                onPurge={handlePurge}
                t={t}
              />
            )}

            {/* 预览面板 */}
            {selected && (
              <div className="border rounded-md">
                <div className="flex items-center justify-between px-3 py-2 border-b">
                  <p className="text-sm font-medium truncate">{labelOf(selected)}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleRestore(selected)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs border hover:bg-muted transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                      {t('trash.restore')}
                    </button>
                    <button
                      onClick={() => handlePurge(selected)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs border hover:bg-muted text-destructive hover:text-destructive transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      {t('trash.purge')}
                    </button>
                  </div>
                </div>
                <div className="max-h-96 overflow-y-auto p-4">
                  {previewLoading ? (
                    <p className="text-xs text-muted-foreground">{t('trash.loading')}</p>
                  ) : preview ? (
                    <Markdown content={preview} />
                  ) : (
                    <p className="text-xs text-muted-foreground">{t('trash.noPreview')}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function TrashGroup({ title, items, icon, labelOf, selectedId, selectedKeys, onToggleSelect, onSelect, onRestore, onPurge, t }: {
  title: string
  items: trash.Item[]
  icon: React.ReactNode
  labelOf: (it: trash.Item) => string
  selectedId: string | null
  selectedKeys: string[]
  onToggleSelect: (key: string) => void
  onSelect: (it: trash.Item) => void
  onRestore: (it: trash.Item) => void
  onPurge: (it: trash.Item) => void
  t: (key: string, opts?: any) => string
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-2">
        {icon}
        {title}
        <span className="text-[10px] text-muted-foreground/60">({items.length})</span>
      </div>
      <div className="border rounded-md divide-y divide-border">
        {items.map(it => {
          const key = `${it.type}:${it.id}`
          const active = selectedId === key
          return (
            <div
              key={key}
              onClick={() => onSelect(it)}
              className={`flex items-center gap-3 px-3 py-2.5 group cursor-pointer transition-colors ${active ? 'bg-muted/50' : 'hover:bg-muted/30'}`}
            >
              <input
                type="checkbox"
                checked={selectedKeys.includes(key)}
                onChange={() => onToggleSelect(key)}
                onClick={e => e.stopPropagation()}
                className="accent-primary shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{labelOf(it)}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {it.original_path} · {t('trash.trashedAt')}: {it.trashed_at}
                  {it.source === 'user' ? ` · ${t('trash.globalSkill')}` : ''}
                </p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); onRestore(it) }}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs border hover:bg-muted transition-colors shrink-0"
                title={t('trash.restore')}
              >
                <RotateCcw className="w-3 h-3" />
                {t('trash.restore')}
              </button>
              <button
                onClick={e => { e.stopPropagation(); onPurge(it) }}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs border hover:bg-muted text-destructive hover:text-destructive transition-colors shrink-0"
                title={t('trash.purge')}
              >
                <Trash2 className="w-3 h-3" />
                {t('trash.purge')}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

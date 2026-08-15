import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Plus, X, Trash2, Pencil, Loader2, Inbox } from 'lucide-react'
import { toastError } from '@/lib/utils'
import { useApp } from '@/hooks/useApp'
import type { setting } from '@/lib/wailsjs/go/models'

export default function SettingsView({ novelId, focusId }: { novelId: number; focusId: number | null }) {
  const app = useApp()
  const { t } = useTranslation()
  const [items, setItems] = useState<setting.SettingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [newContent, setNewContent] = useState('')
  const focusRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    if (!novelId) { setItems([]); setLoading(false); return }
    setLoading(true)
    try {
      setItems((await app.ListSettings(novelId)) ?? [])
    } catch (err) {
      toastError(t('settingsView.loadFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setLoading(false)
    }
  }, [app, novelId, t])

  useEffect(() => { load() }, [load])

  // 聚焦：滚动到指定条目并高亮
  useEffect(() => {
    if (focusId != null) {
      const el = document.getElementById(`setting-item-${focusId}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('ring-2', 'ring-primary')
        setTimeout(() => el.classList.remove('ring-2', 'ring-primary'), 2500)
      }
    }
  }, [focusId, items])

  const groups = useMemo(() => {
    const m = new Map<string, setting.SettingItem[]>()
    for (const it of items) {
      const k = it.category || '—'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(it)
    }
    return Array.from(m.entries())
  }, [items])

  async function handleCreate() {
    if (!newCategory.trim() || !newContent.trim()) return
    try {
      await app.SaveSetting({ novel_id: novelId, id: 0, category: newCategory.trim(), content: newContent.trim() })
      setNewCategory('')
      setNewContent('')
      setShowCreate(false)
      await load()
    } catch (err) {
      toastError(t('settingsView.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      <div className="px-6 py-4 border-b shrink-0 flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Globe className="w-4 h-4 text-muted-foreground" />
          {t('settingsView.title')} {t('settingsView.count', { count: items.length })}
        </h2>
        <button
          onClick={() => setShowCreate(v => !v)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs border hover:bg-muted transition-colors shrink-0"
        >
          {showCreate ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {showCreate ? t('settingsView.cancel') : t('settingsView.newSetting')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6 max-w-3xl">
            {/* 新建设定表单 */}
            {showCreate && (
              <div className="border rounded-md p-3 space-y-2">
                <label className="block text-xs text-muted-foreground">
                  {t('settingsView.category')}
                  <input
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value)}
                    placeholder={t('settingsView.categoryPlaceholder')}
                    className="mt-1 w-full h-8 rounded-md border bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </label>
                <label className="block text-xs text-muted-foreground">
                  {t('settingsView.content')}
                  <textarea
                    value={newContent}
                    onChange={e => setNewContent(e.target.value)}
                    placeholder={t('settingsView.contentPlaceholder')}
                    rows={4}
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                  />
                </label>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => setShowCreate(false)}
                    className="h-8 px-3 rounded-md text-xs border hover:bg-muted transition-colors"
                  >
                    {t('settingsView.cancel')}
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!newCategory.trim() || !newContent.trim()}
                    className="h-8 px-3 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {t('settingsView.create')}
                  </button>
                </div>
              </div>
            )}

            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Inbox className="w-10 h-10 text-muted-foreground/30 mb-3" />
                <p className="text-xs">{t('settingsView.empty')}</p>
              </div>
            ) : (
              groups.map(([cat, list]) => (
                <div key={cat}>
                  <div className="text-xs font-semibold text-muted-foreground mb-2">
                    {cat}
                    <span className="text-[10px] text-muted-foreground/60 ml-1.5">({list.length})</span>
                  </div>
                  <div className="space-y-2">
                    {list.map(it => (
                      <div key={it.id} id={`setting-item-${it.id}`} ref={focusId === it.id ? focusRef : undefined} className="rounded-md transition-shadow">
                        <SettingCard item={it} novelId={novelId} onChanged={load} t={t} />
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SettingCard({ item, novelId, onChanged, t }: {
  item: setting.SettingItem
  novelId: number
  onChanged: () => Promise<void>
  t: (key: string, opts?: any) => string
}) {
  const app = useApp()
  const [editing, setEditing] = useState(false)
  const [category, setCategory] = useState(item.category)
  const [content, setContent] = useState(item.content)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setCategory(item.category)
    setContent(item.content)
    setEditing(false)
  }, [item.id, item.category, item.content])

  async function handleSave() {
    setSaving(true)
    try {
      await app.SaveSetting({ novel_id: novelId, id: item.id, category, content })
      await onChanged()
    } catch (err) {
      toastError(t('settingsView.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(t('settingsView.confirmDelete'))) return
    try {
      await app.DeleteSetting(novelId, item.id)
      await onChanged()
    } catch (err) {
      toastError(t('settingsView.deleteFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  if (editing) {
    return (
      <div className="border rounded-md p-3 space-y-2 bg-background">
        <label className="block text-xs text-muted-foreground">
          {t('settingsView.category')}
          <input
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="mt-1 w-full h-8 rounded-md border bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          {t('settingsView.content')}
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={6}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-y"
          />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={() => { setEditing(false); setCategory(item.category); setContent(item.content) }}
            className="h-8 px-3 rounded-md text-xs border hover:bg-muted transition-colors"
          >
            {t('settingsView.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !category.trim() || !content.trim()}
            className="h-8 px-3 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? t('settingsView.saving') : t('settingsView.save')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="border rounded-md p-3 bg-background group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-muted-foreground/70 mb-0.5">{item.category}</p>
          <p className="text-xs whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{item.content}</p>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={() => setEditing(true)}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title={t('settingsView.edit')}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleDelete}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
            title={t('settingsView.delete')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

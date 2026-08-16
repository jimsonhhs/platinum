import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, Trash2, LayoutGrid } from 'lucide-react'
import { useApp } from '@/hooks/useApp'
import { toastError } from '@/lib/utils'

interface SandboxItem {
  id: string
  name: string
  description: string
}

interface Props {
  novelId: number
  currentId: string
  onSelect: (id: string) => void
}

// 左侧栏沙盘列表：与章节列表同栏位，管理多份沙盘（新建/切换/改名/删除/简介）
export default function SandboxList({ novelId, currentId, onSelect }: Props) {
  const { t } = useTranslation()
  const app = useApp()
  const [items, setItems] = useState<SandboxItem[]>([])

  const load = useCallback(async () => {
    try {
      const list = (await app.ListSandboxes(novelId)) as any[] | null
      setItems((list ?? []).map(i => ({ id: i.id, name: i.name, description: i.description })))
    } catch (err) { toastError(String(err)) }
  }, [app, novelId])

  useEffect(() => { load() }, [load])

  // 列表变动（新建/改名/删除）后刷新；切书时刷新
  useEffect(() => {
    const handler = () => load()
    window.addEventListener('sandbox:list-changed', handler)
    return () => window.removeEventListener('sandbox:list-changed', handler)
  }, [load])

  async function handleCreate() {
    const name = prompt(t('sandbox.createPrompt'))
    if (!name || !name.trim()) return
    try {
      const id = await app.CreateSandbox(novelId, name.trim(), '')
      window.dispatchEvent(new CustomEvent('sandbox:list-changed'))
      onSelect(id)
    } catch (err) { toastError(String(err)) }
  }

  async function handleRename(item: SandboxItem) {
    const name = prompt(t('sandbox.renamePrompt'), item.name)
    if (!name || !name.trim()) return
    const desc = prompt(t('sandbox.descPrompt'), item.description) ?? ''
    try {
      await app.UpdateSandboxMeta(novelId, item.id, name.trim(), desc)
      window.dispatchEvent(new CustomEvent('sandbox:list-changed'))
    } catch (err) { toastError(String(err)) }
  }

  async function handleDelete(item: SandboxItem) {
    if (!confirm(t('sandbox.deleteConfirm') + `「${item.name}」？`)) return
    try {
      await app.DeleteSandbox(novelId, item.id)
      window.dispatchEvent(new CustomEvent('sandbox:list-changed'))
      if (item.id === currentId) onSelect('') // 删当前：通知画布清空，随后自动选第一份
    } catch (err) { toastError(String(err)) }
  }

  return (
    <>
      <div className="flex items-center justify-between px-3 py-2.5 border-b">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t('sandbox.listTitle')}
        </span>
        <button onClick={handleCreate} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={t('sandbox.new')}>
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <LayoutGrid className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-[11px] text-muted-foreground">{t('sandbox.listEmpty')}</p>
          </div>
        ) : items.map((item, idx) => (
          <div
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={`group w-full px-3 py-2 text-left cursor-pointer transition-colors border-b border-border/40 ${currentId === item.id ? 'bg-primary/10' : 'hover:bg-muted/50'}`}
          >
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-[10px] font-mono text-muted-foreground/70">{String(idx + 1).padStart(2, '0')}</span>
              <span className="flex-1 text-xs font-medium truncate">{item.name}</span>
              <button
                onClick={e => { e.stopPropagation(); handleRename(item) }}
                className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground transition-opacity"
                title={t('sandbox.rename')}
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={e => { e.stopPropagation(); handleDelete(item) }}
                className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-red-500 transition-opacity"
                title={t('sandbox.delete')}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            {item.description && (
              <p className="text-[10px] text-muted-foreground/70 truncate mt-0.5">{item.description}</p>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

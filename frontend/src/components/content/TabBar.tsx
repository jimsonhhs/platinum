import { useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface Props {
  tabs: { id: string; type: string; title: string }[]
  activeTabId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCloseOthers: (keepId: string) => void
  onCloseAll: () => void
}

export default function TabBar({ tabs, activeTabId, onSelect, onClose, onCloseOthers, onCloseAll }: Props) {
  const { t } = useTranslation()
  const [ctxTab, setCtxTab] = useState<string | null>(null)

  if (tabs.length === 0) return null

  return (
    <div className="flex items-center bg-muted/30 border-b shrink-0">
      {/* 标签滚动区 */}
      <div className="flex items-center overflow-x-auto flex-1 min-w-0">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`group flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-r shrink-0 transition-colors select-none ${
              tab.id === activeTabId
                ? 'bg-background text-foreground border-t-2 border-t-blue-500 -mt-[1px]'
                : 'text-muted-foreground hover:bg-muted/50'
            } ${tab.type === 'diff' ? 'italic' : ''}`}
            onClick={() => onSelect(tab.id)}
            onContextMenu={e => {
              e.preventDefault()
              setCtxTab(tab.id)
            }}
          >
            <span className="truncate max-w-[160px]">{tab.title}</span>
            <button
              className="ml-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity cursor-pointer"
              onClick={e => { e.stopPropagation(); onClose(tab.id) }}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      {/* 关闭其他标签页（固定可见，一眼看到） */}
      <button
        onClick={() => { if (activeTabId) onCloseOthers(activeTabId); else onCloseAll() }}
        className="shrink-0 flex items-center gap-1 h-6 px-2.5 my-1 ml-1 border-l border-border/60 pl-2.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
        title={t('content.tabCloseOthers')}
      >
        <X className="w-3 h-3" />
        {t('content.tabCloseOthers')}
      </button>

      {/* 右键菜单 */}
      {ctxTab && (
        <div
          className="fixed z-50 w-44 rounded-md border bg-background shadow-lg py-1"
          style={{ left: 40, top: 60 }}
          onMouseLeave={() => setCtxTab(null)}
        >
          <button
            onClick={() => { onClose(ctxTab); setCtxTab(null) }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
          >
            {t('content.tabClose')}
          </button>
          <button
            onClick={() => { onCloseOthers(ctxTab); setCtxTab(null) }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
          >
            {t('content.tabCloseOthers')}
          </button>
          <button
            onClick={() => { onCloseAll(); setCtxTab(null) }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
          >
            {t('content.tabCloseAll')}
          </button>
        </div>
      )}
    </div>
  )
}

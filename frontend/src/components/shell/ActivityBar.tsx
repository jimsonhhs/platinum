import type { LucideIcon } from 'lucide-react'
import { Library, List, Search, Settings, Users, MapPin, GitBranch, History, Eye, Wrench, Sparkles, Trash2, ArchiveRestore, Globe, LayoutGrid } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface Activity {
  id: string
  icon: LucideIcon
  labelKey: string
  disabled?: boolean
  // 受书籍 AI 配置控制：关闭则不在左侧显示（undefined = 不受控）
  module?: 'outline' | 'character' | 'timeline' | 'reader' | 'arc' | 'platinum'
}

const activities: Activity[] = [
  { id: 'search', icon: Search, labelKey: 'shell.search' },
  { id: 'novels', icon: Library, labelKey: 'shell.bookshelf' },
  { id: 'sandbox', icon: LayoutGrid, labelKey: 'shell.sandbox' },
  { id: 'style-samples', icon: Sparkles, labelKey: 'shell.extract' },
  { id: 'setting', icon: Globe, labelKey: 'shell.novelSettings' },
  { id: 'chapters', icon: List, labelKey: 'shell.chapters' },
  { id: 'preferences', icon: Settings, labelKey: 'shell.preference', module: 'platinum' },
  { id: 'characters', icon: Users, labelKey: 'shell.characters', module: 'character' },
  { id: 'locations', icon: MapPin, labelKey: 'shell.locations' },
  { id: 'storyarcs', icon: GitBranch, labelKey: 'shell.arcs', module: 'arc' },
  { id: 'timeline', icon: History, labelKey: 'shell.timeline', module: 'timeline' },
  { id: 'reader', icon: Eye, labelKey: 'shell.readerView', module: 'reader' },
  { id: 'skills', icon: Wrench, labelKey: 'shell.skills' },
  { id: 'archive', icon: ArchiveRestore, labelKey: 'shell.archive' },
  { id: 'trash', icon: Trash2, labelKey: 'shell.trash' },
]

interface Props {
  activeId: string
  onSelect: (id: string) => void
  // 当前书启用的维护模块（关闭的模块左侧不显示）；undefined = 全部显示
  enabledModules?: string[]
}

export default function ActivityBar({ activeId, onSelect, enabledModules }: Props) {
  const { t } = useTranslation()

  const visible = activities.filter(a => {
    if (!a.module) return true
    if (!enabledModules) return true
    return enabledModules.includes(a.module)
  })

  return (
    <nav className="w-12 flex flex-col items-center py-2 gap-1 border-r bg-sidebar select-none cursor-default overflow-y-auto">
      {visible.map((a, i) => {
        const isActive = a.id === activeId
        return (
          <div key={a.id} className="w-full flex flex-col items-center">
            <button
              disabled={a.disabled}
              onClick={() => onSelect(a.id)}
              title={`${t(a.labelKey)}${a.disabled ? t('shell.comingSoon') : ''}`}
              className={`relative w-10 flex flex-col items-center justify-center rounded-lg py-1 transition-all duration-200
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                ${a.disabled
                  ? 'text-muted-foreground/40 cursor-not-allowed'
                  : isActive
                    ? 'text-foreground bg-muted'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
            >
              {isActive && !a.disabled && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />
              )}
              <a.icon className="w-5 h-5" />
              <span className="text-[9px] leading-tight mt-0.5 max-w-full px-0.5 truncate">{t(a.labelKey)}</span>
            </button>
            {/* 分组分割线：搜索/书架 之后、设定/章节 之后 */}
            {(i === 2 || i === 4) && <div className="w-6 h-px bg-border my-1 mx-auto" />}
          </div>
        )
      })}
    </nav>
  )
}

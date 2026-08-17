import { useState } from 'react'
import { Settings, Cpu, Palette, GitGraph } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ModelConfigTab from './ModelConfigTab'
import GeneralConfigTab from './GeneralConfigTab'
import AppearanceTab from './AppearanceTab'
import GitHistoryList from '@/components/git/GitHistoryList'
import GitCommitView from '@/components/git/GitCommitView'
import type { git } from '@/lib/wailsjs/go/models'

type Tab = 'general' | 'appearance' | 'model' | 'git'

interface Props {
  open: boolean
  onClose: () => void
  onSaved?: () => void
  initialTab?: Tab
  novelId?: number // 创作历史需要当前小说
}

export default function SettingsDialog({ open, onClose, onSaved, initialTab = 'model', novelId }: Props) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  const [gitFile, setGitFile] = useState<git.FileDiff | null>(null)

  if (!open) return null

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: t('settings.general'), icon: <Settings className="w-4 h-4" /> },
    { id: 'appearance', label: t('settings.appearance'), icon: <Palette className="w-4 h-4" /> },
    { id: 'model', label: t('settings.modelConfig'), icon: <Cpu className="w-4 h-4" /> },
    { id: 'git', label: t('shell.gitHistory'), icon: <GitGraph className="w-4 h-4" /> },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* 弹窗 */}
      <div className="relative bg-background rounded-xl shadow-2xl border flex w-[880px] h-[700px] max-w-[95vw] max-h-[90vh]">
        {/* 关闭按钮：弹窗级右上角，避开各 Tab 内容区右上角的操作按钮 */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          ✕
        </button>

        {/* 左侧导航 */}
        <nav className="w-[160px] border-r py-4 px-2 flex flex-col gap-1 shrink-0">
          <div className="text-sm font-medium px-3 pb-3 text-foreground">{t('settings.title')}</div>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                activeTab === tab.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        {/* 右侧内容区：顶部留出关闭按钮的空间（pr-12） */}
        <div className="flex-1 p-5 pl-5 pt-10 pr-12 flex flex-col min-w-0 overflow-hidden">
          {/* 关闭按钮 */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            ✕
          </button>

          {activeTab === 'model' ? (
            <ModelConfigTab onSaved={onSaved} />
          ) : activeTab === 'appearance' ? (
            <AppearanceTab />
          ) : activeTab === 'git' ? (
            novelId ? (
              <div className="flex-1 min-h-0 flex gap-4">
                <div className="w-80 shrink-0 min-h-0 overflow-y-auto border rounded-md">
                  <GitHistoryList novelId={novelId} onSelectFile={setGitFile} />
                </div>
                <div className="flex-1 min-w-0 min-h-0 border rounded-md overflow-hidden">
                  <GitCommitView file={gitFile} />
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                {t('settings.gitNeedsNovel')}
              </div>
            )
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <GeneralConfigTab />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

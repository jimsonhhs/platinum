import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useApp } from '@/hooks/useApp'
import type { imp, novel, chapter } from '@/hooks/useApp'
import type { git } from '@/lib/wailsjs/go/models'
import ActivityBar from '@/components/shell/ActivityBar'
import StatusBar from '@/components/shell/StatusBar'
import SidePanel from '@/components/sidebar/SidePanel'
import ContentPanel, { type ContentPanelHandle } from '@/components/content/ContentPanel'
import CharacterListView from '@/components/character/CharacterListView'
import LocationListView from '@/components/location/LocationListView'
import ArcListView from '@/components/storyarc/ArcListView'
import TimelineView from '@/components/timeline/TimelineView'
import ReaderView from '@/components/reader/ReaderView'
import PreferenceView from '@/components/preference/PreferenceView'
import BookshelfView from '@/components/novel/BookshelfView'
import NovelEditDialog from '@/components/novel/NovelEditDialog'
import AISettingsDialog from '@/components/novel/AISettingsDialog'
import NovelDeleteDialog from '@/components/novel/NovelDeleteDialog'
import ImportProgressDialog from '@/components/novel/ImportProgressDialog'
import ExportDialog from '@/components/export/ExportDialog'
import ChatPanel, { type ChatPanelHandle } from '@/components/chat/ChatPanel'
import GitHubLink from '@/components/shell/GitHubLink'
import SettingsDialog from '@/components/settings/SettingsDialog'
import HelpDialog from '@/components/help/HelpDialog'
import ProfileView from '@/components/profile/ProfileView'
import GitCommitView from '@/components/git/GitCommitView'
import TrashView from '@/components/trash/TrashView'
import ArchiveView from '@/components/archive/ArchiveView'
import SettingsView from '@/components/setting/SettingsView'
import SandboxView from '@/components/sandbox/SandboxView'
import ExtractWorkspaceView from '@/components/extract/ExtractWorkspaceView'
import UpdateDialog from '@/components/update/UpdateDialog'
import ErrorBoundary from '@/components/shared/ErrorBoundary'
import { search } from '@/lib/wailsjs/go/models'
import type { update as updateModels } from '@/lib/wailsjs/go/models'
import { CheckUpdate } from '@/lib/wailsjs/go/app/App'
import { Settings, User, HelpCircle, Moon, Sun, Leaf, Contrast } from 'lucide-react'
import { WindowMinimise, WindowToggleMaximise, Quit } from '@/lib/wailsjs/runtime/runtime'
import Logo from '@/components/Logo'
import { useTheme, type Theme } from '@/hooks/useTheme'
import { useLayoutState } from '@/hooks/useLayoutState'
import { useWindowState } from '@/hooks/useWindowState'
import { useImportNovel } from '@/hooks/useImportNovel'
import { toastError } from '@/lib/utils'

const THEME_ICON: Record<Theme, React.ReactNode> = {
  light: <Moon className="w-5 h-5" />,
  dark: <Sun className="w-5 h-5" />,
  'eye-care': <Leaf className="w-5 h-5" />,
  'black-yellow': <Contrast className="w-5 h-5" />,
}

interface Props {
  initialNovelId: number
  initialShowHelp?: boolean
}

export default function WorkspaceView({ initialNovelId, initialShowHelp }: Props) {
  const { t } = useTranslation()
  const THEME_LABEL: Record<Theme, string> = {
  light: t('workspace.darkMode'),
  dark: t('workspace.lightMode'),
  'eye-care': t('theme.eyeCare'),
  'black-yellow': t('theme.blackYellow'),
}
  const app = useApp()
  const contentRef = useRef<ContentPanelHandle>(null)
  const chatRef = useRef<ChatPanelHandle>(null)

  const [novels, setNovels] = useState<novel.Novel[]>([])
  const [activeNovelId, setActiveNovelId] = useState(initialNovelId)
  const [activePanel, setActivePanel] = useState(initialNovelId ? 'chapters' : 'novels')
  const [sidebarPanel, setSidebarPanel] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<search.Result[]>([])
  const [characterFocusId, setCharacterFocusId] = useState<number>(0)
  const [locationFocusId, setLocationFocusId] = useState<number>(0)
  const [timelineFocusId, setTimelineFocusId] = useState<number>(0)
  const [arcFocusId, setArcFocusId] = useState<number>(0)
  const [readerFocusId, setReaderFocusId] = useState<number>(0)
  const [preferenceFocusId, setPreferenceFocusId] = useState<number>(0)
  const [styleSampleFocusId, setStyleSampleFocusId] = useState<number | null>(null)
  const [sandboxId, setSandboxId] = useState('')
  const prevPanelRef = useRef(activePanel)

  // 从沙盘界面切走 → 自动保存当前沙盘
  useEffect(() => {
    if (prevPanelRef.current === 'sandbox' && activePanel !== 'sandbox') {
      window.dispatchEvent(new CustomEvent('sandbox:auto-save'))
    }
    prevPanelRef.current = activePanel
  }, [activePanel])
  const [settingFocusId, setSettingFocusId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [aiSettingsNovel, setAiSettingsNovel] = useState<novel.Novel | null>(null)
  const [tabTarget, setTabTarget] = useState<{ path: string; title: string } | null>(null)
  const [activeContent, setActiveContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [activeSkillName, setActiveSkillName] = useState<string | null>(null)
  const [selectedGitFile, setSelectedGitFile] = useState<git.FileDiff | null>(null)
  const [platformOS, setPlatformOS] = useState('')
  const loadedRef = useRef(false)
  const { theme, toggle: toggleTheme } = useTheme()
  const { isMaximised, setIsMaximised } = useWindowState()
  const { sidePanelWidth, chatPanelWidth, setSidePanelWidth, setChatPanelWidth } = useLayoutState()
  const [sidebarClosed, setSidebarClosed] = useState(false)

  // ── 更新检查 ────────────────────────────────────────────
  const [showUpdate, setShowUpdate] = useState(false)
  const [reminderMinutes, setReminderMinutes] = useState(10)
  const [remindOpen, setRemindOpen] = useState(false)
  const [remindFiles, setRemindFiles] = useState<git.FileChange[]>([])
  const remindDismissedUntilRef = useRef(0)
  const [updateResult, setUpdateResult] = useState<updateModels.CheckResult | null>(null)

  // ── 书籍管理弹窗 ──────────────────────────────────────
  const [editingNovel, setEditingNovel] = useState<novel.Novel | null>(null)
  const [deletingNovel, setDeletingNovel] = useState<novel.Novel | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [exportNovelId, setExportNovelId] = useState<number | null>(null)

  // ── 窗口状态 ────────────────────────────────────────────

  useEffect(() => {
    app.GetPlatform().then((info) => {
      if (info.os) setPlatformOS(info.os as string)
    })
  }, [app])

  // ── 首次进入自动弹帮助 ──────────────────────────────────

  useEffect(() => {
    if (initialShowHelp) setShowHelp(true)
  }, [initialShowHelp])

  // ── 启动后延迟检查更新 ──────────────────────────────────

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const result = await CheckUpdate(false)
        if (result && result.hasUpdate) {
          setUpdateResult(result)
          setShowUpdate(true)
        }
      } catch { /* 静默失败 */ }
    }, 30_000)
    return () => clearTimeout(timer)
  }, [])

  // ── 作品列表 ────────────────────────────────────────────

  const loadNovels = useCallback(async () => {
    const list = await app.GetNovels()
    setNovels(list ?? [])
    loadedRef.current = true
  }, [app])

  const handleImportedNovel = useCallback(async (res: imp.ImportResult) => {
    await loadNovels()
    setActiveNovelId(res.novel_id)
    setActivePanel('chapters')
    contentRef.current?.closeAllTabs()
    setTabTarget(null)
    setActiveContent('')
    setSelectedGitFile(null)
    await app.SetActiveNovel({ novel_id: res.novel_id })
    if (confirm(t('novel.aiConfigReminder'))) {
      const list = await app.GetNovels()
      const n = list?.find(x => x.id === res.novel_id)
      if (n) setAiSettingsNovel(n)
    }
  }, [app, loadNovels, t])

  const importNovel = useImportNovel({ app, onImported: handleImportedNovel })

  // 沙盘「跳转完整页面」：切到对应面板并聚焦实体
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as { panel: string; entityId: number; novelId: number }
      if (!d) return
      setSidebarPanel(null)
      setActivePanel(d.panel)
      // 聚焦对应实体
      if (d.panel === 'characters') setCharacterFocusId(d.entityId)
      else if (d.panel === 'locations') setLocationFocusId(d.entityId)
      else if (d.panel === 'timeline') setTimelineFocusId(d.entityId)
      else if (d.panel === 'settings') setSettingFocusId(d.entityId)
    }
    window.addEventListener('sandbox:open-entity', handler)
    return () => window.removeEventListener('sandbox:open-entity', handler)
  }, [])

  // 进入沙盘面板或切换书籍时：自动选中第一份沙盘（若无当前选择）
  useEffect(() => {
    if (activePanel !== 'sandbox' || !activeNovelId) return
    if (sandboxId) return
    app.ListSandboxes(activeNovelId).then(list => {
      const items = (list ?? []) as any[]
      if (items.length > 0) setSandboxId(items[0].id)
    }).catch(() => {})
  }, [activePanel, activeNovelId, sandboxId, app])

  useEffect(() => { loadNovels() }, [loadNovels])

  // ── 维护提醒定时检查（本地 git 检测，零 token；弹窗等待用户回应，不重复打扰） ──

  const loadReminderSetting = useCallback(() => {
    app.GetSettings().then(s => {
      if (typeof s?.maintain_reminder_minutes === 'number') setReminderMinutes(s.maintain_reminder_minutes)
    }).catch(() => {})
  }, [app])

  useEffect(() => { loadReminderSetting() }, [loadReminderSetting])

  useEffect(() => {
    if (!activeNovelId || reminderMinutes <= 0) return
    const intervalMs = reminderMinutes * 60_000
    const timer = setInterval(async () => {
      if (remindOpen || Date.now() < remindDismissedUntilRef.current) return
      try {
        const changes = await app.GetChangedFiles(activeNovelId)
        if (changes && changes.length > 0) {
          setRemindFiles(changes)
          setRemindOpen(true)
        }
      } catch { /* 静默失败，下轮再试 */ }
    }, intervalMs)
    return () => clearInterval(timer)
  }, [app, activeNovelId, reminderMinutes, remindOpen])

  function handleRemindNow() {
    setRemindOpen(false)
    handleMaintainChanges(remindFiles, ['outline', 'character', 'timeline', 'reader', 'arc', 'platinum'])
  }

  function handleRemindLater() {
    setRemindOpen(false)
    remindDismissedUntilRef.current = Date.now() + reminderMinutes * 60_000
  }

  // ── SidePanel → ContentPanel 桥接 ─────────────────────────

  function handleSelectChapter(ch: chapter.Chapter, viewMode?: string) {
    // 标题格式：章节名（AI索引号XXX），XXX=三位文件号（与文件名 001.md 一致，避免 AI 混淆）
    const idx = String(ch.chapter_number).padStart(3, '0')
    const chTitle = ch.title
      ? `${ch.title}（${t('sidebar.aiIndex', { n: idx })}）`
      : t('sidebar.aiIndex', { n: idx })
    setTabTarget({ path: ch.file_path, title: chTitle })
    contentRef.current?.openFile(ch.file_path, chTitle, false, viewMode)
  }

  function handleSelectGoink() {
    setTabTarget({ path: 'platinum.md', title: t('workspace.storyStatus') })
    contentRef.current?.openFile('platinum.md', t('workspace.storyStatus'))
  }

  // ── Approval ────────────────────────────────────────────

  async function handleApprove(toolId: string, feedback: string) {
    try {
      await app.ApproveTool(toolId, true, feedback)
      await contentRef.current?.handleDiffApprove(toolId)
    } catch (err) {
      toastError(String(err))
    }
  }

  async function handleReject(toolId: string, feedback: string) {
    try {
      await app.ApproveTool(toolId, false, feedback)
      contentRef.current?.handleDiffReject(toolId)
    } catch (err) {
      toastError(String(err))
    }
  }

  function handleApprovalFileEdit(data: {
    path: string; title: string; diff: string; original: string; modified: string
    changeType: string; reason: string; toolId: string
  }) {
    contentRef.current?.openDiffTab(data)
  }

  // ── 自动选择小说 ────────────────────────────────────────

  useEffect(() => {
    if (!loadedRef.current) return
    const exists = novels.find(n => n.id === activeNovelId)
    if (!exists && novels.length > 0) {
      const first = novels[0]
      setActiveNovelId(first.id)
      setActivePanel('chapters')
      app.SetActiveNovel({ novel_id: first.id })
    } else if (novels.length === 0) {
      setActivePanel('novels')
    }
  }, [app, novels, activeNovelId])

  function handleActivitySelect(id: string) {
    const currentPanel = sidebarPanel ?? activePanel
    if (id === currentPanel && !sidebarClosed) {
      setSidebarClosed(true)
      return
    }
    setSidebarClosed(false)
    if (id === 'search') {
      setSidebarPanel('search')
    } else {
      setSidebarPanel(null)
      setActivePanel(id)
      contentRef.current?.clearHighlight()
    }
  }

  // 当前书的 AI 功能配置：决定左侧活动栏显示哪些模块（关闭不显示）
  const enabledModules = useMemo(() => {
    const n = novels.find(x => x.id === activeNovelId)
    if (!n) return undefined
    const cfgRaw = (n as any)?.ai_config || ''
    if (!cfgRaw) return undefined // 空配置 = 全开
    try {
      const cfg = JSON.parse(cfgRaw)
      if (Array.isArray(cfg.maint) && cfg.maint.length > 0) return cfg.maint
    } catch { /* ignore */ }
    return undefined
  }, [novels, activeNovelId])

  function handleSelectGitFile(file: git.FileDiff) {
    setSelectedGitFile(file)
  }

  function handleSearchNavigateEntity(panelId: string, entityId: number) {
    setCharacterFocusId(0)
    setLocationFocusId(0)
    setTimelineFocusId(0)
    setArcFocusId(0)
    setReaderFocusId(0)
    setPreferenceFocusId(0)
    switch (panelId) {
      case 'characters': setCharacterFocusId(entityId); break
      case 'locations': setLocationFocusId(entityId); break
      case 'timeline': setTimelineFocusId(entityId); break
      case 'storyarcs': setArcFocusId(entityId); break
      case 'reader': setReaderFocusId(entityId); break
      case 'preferences': setPreferenceFocusId(entityId); break
    }
    setActivePanel(panelId)
  }

  function handleSearchNavigateChapter(filePath: string, title: string, _chapterNum: number, matchPos: number, matchLen: number) {
    flushSync(() => setActivePanel('chapters'))
    if (matchPos >= 0 && matchLen > 0) {
      contentRef.current?.openFileWithHighlight(filePath, title, matchPos, matchLen)
    } else {
      contentRef.current?.openFile(filePath, title)
    }
  }

  async function handleSelectNovel(n: novel.Novel) {
    try {
      setActiveNovelId(n.id)
      setActivePanel('chapters')
      contentRef.current?.closeAllTabs()
      setTabTarget(null)
      setActiveContent('')
      setSelectedGitFile(null)
      await app.SetActiveNovel({ novel_id: n.id })
    } catch (err) { console.error(err) }
  }

  async function handleCreateNovel() {
    try {
      if (!title.trim()) return
      const n = await app.CreateNovel({ title: title.trim(), description: description.trim() })
      if (n) {
        setTitle('')
        setDescription('')
        setShowCreate(false)
        await loadNovels()
        setActiveNovelId(n.id)
        setActivePanel('chapters')
        await app.SetActiveNovel({ novel_id: n.id })
        if (confirm(t('novel.aiConfigReminder'))) {
          setAiSettingsNovel(n)
        }
      }
    } catch (err) { console.error(err) }
  }

  async function handleCreateNovelFromDialog(input: { title: string; description: string; genre: string }) {
    try {
      const n = await app.CreateNovel({
        title: input.title, description: input.description, genre: input.genre,
      })
      if (n) {
        setShowCreateDialog(false)
        await loadNovels()
        setActiveNovelId(n.id)
        setActivePanel('chapters')
        await app.SetActiveNovel({ novel_id: n.id })
        if (confirm(t('novel.aiConfigReminder'))) {
          setAiSettingsNovel(n)
        }
      }
    } catch (err) { console.error(err); throw err }
  }

  async function handleUpdateNovel(input: { title: string; description: string; genre: string }) {
    if (!editingNovel) return
    try {
      await app.UpdateNovel(editingNovel.id, {
        title: input.title, description: input.description, genre: input.genre,
      })
      setEditingNovel(null)
      await loadNovels()
    } catch (err) { console.error(err); throw err }
  }

  async function handleSaveAISettings(input: { break_words: string; break_words_1: string; break_words_2: string; break_words_3: string; ai_config: string }) {
    const novel = aiSettingsNovel ?? editingNovel
    if (!novel) return
    try {
      await app.UpdateNovel(novel.id, {
        break_words: input.break_words,
        break_words_1: input.break_words_1,
        break_words_2: input.break_words_2,
        break_words_3: input.break_words_3,
        ai_config: input.ai_config,
      })
      await loadNovels()
    } catch (err) { console.error(err); throw err }
  }

  async function handleDeleteNovel() {
    if (!deletingNovel) return
    try {
      await app.DeleteNovel(deletingNovel.id)
      setDeletingNovel(null)
      await loadNovels()
    } catch (err) { console.error(err); throw err }
  }

  async function handleDeleteChapter(novelId: number, chapterNumber: number) {
    try {
      await app.DeleteChapter({ novel_id: novelId, chapter_number: chapterNumber })
      // 若该章节标签页处于打开状态则关闭，避免后续保存时重建文件
      const filePath = `chapters/${String(chapterNumber).padStart(3, '0')}.md`
      contentRef.current?.closeFile(filePath)
    } catch (err) { console.error(err); throw err }
  }

  async function handleNewSkill(name: string) {
    const fileName = name.trim()
    if (!fileName) return
    const path = `skills/${fileName}.md`
    // 先写入带合法 frontmatter 的模板，避免空文件保存时被格式校验拦下
    const template = t('skill.newTemplate', { name: fileName })
    try {
      await app.SaveContent({ novel_id: activeNovelId, path, content: template })
    } catch (err) {
      toastError(t('skill.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      console.error(err)
      return
    }
    setActiveSkillName(`${t('workspace.skillLabel')}${fileName}`)
    contentRef.current?.openFile(path, `${t('workspace.skillLabel')}${fileName}`, false, 'edit')
  }

  async function handleMaintainChanges(files: git.FileChange[], parts: string[]) {
    const lines = files.map(f => `- ${f.path} (+${f.insertions}/-${f.deletions})`).join('\n')
    const partKeys: Record<string, string> = {
      outline: 'sidebar.maintainPartOutline',
      character: 'sidebar.maintainPartCharacter',
      timeline: 'sidebar.maintainPartTimeline',
      reader: 'sidebar.maintainPartReader',
      arc: 'sidebar.maintainPartArc',
      goink: 'sidebar.maintainPartPlatinum',
    }
    const partLines = parts.map(p => `- ${t(partKeys[p] ?? p)}`).join('\n')
    const msg = t('sidebar.maintainMessage', { files: lines, parts: partLines })
    const ok = await chatRef.current?.send(msg)
    if (!ok) toastError(t('sidebar.noChatSession'))
  }

  async function handleExportNovel(format: 'epub' | 'markdown' | 'txt', selected: number[]) {
    if (exportNovelId == null) return
    try {
      await app.ExportNovel(exportNovelId, format, selected)
    } catch (err) { console.error(err); throw err }
  }

  async function handleSaveCover(novelID: number, file: File) {
    try {
      const buf = await file.arrayBuffer()
      await app.SaveCover(novelID, Array.from(new Uint8Array(buf)))
    } catch (err) { console.error(err) }
  }

  const activeNovel = novels.find(n => n.id === activeNovelId)

  // ── 窗口按钮样式 ────────────────────────────────────────

  const winBtn = 'w-12 h-full flex items-center justify-center cursor-pointer text-foreground/80 hover:text-foreground hover:bg-black/25 hover:shadow-md transition-all'
  const closeBtn = 'w-12 h-full flex items-center justify-center cursor-pointer text-foreground/80 hover:text-destructive-foreground hover:bg-destructive transition-colors'

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header
        className="h-11 flex items-center border-b bg-sidebar shrink-0 select-none cursor-default"
        style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
        onDoubleClick={() => { WindowToggleMaximise(); setIsMaximised(prev => !prev) }}
      >
        <Logo className="h-7 w-7 ml-3" />
        <span className="text-sm font-medium pl-2 flex-1">
          {activeNovel?.title ?? t('workspace.appName')}
        </span>
        <div className="flex items-center h-full" style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}>
          <GitHubLink />
          <button
            onClick={() => setActivePanel('profile')}
            className={`text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-8 h-8 flex items-center justify-center ml-2 ${activePanel === 'profile' ? 'text-foreground' : ''}`}
            title={t('workspace.profile')}
          >
            <User className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowHelp(true)}
            className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-8 h-8 flex items-center justify-center"
            title={t('workspace.help')}
          >
            <HelpCircle className="w-5 h-5" />
          </button>
          <button
            onClick={toggleTheme}
            className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-8 h-8 flex items-center justify-center"
            title={THEME_LABEL[theme]}
          >
            {THEME_ICON[theme]}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-8 h-8 flex items-center justify-center mr-1"
            title={t('workspace.settings')}
          >
            <Settings className="w-5 h-5" />
          </button>
          {platformOS !== 'darwin' && (
            <>
              <button onClick={WindowMinimise} className={winBtn} title={t('workspace.minimize')}>
                <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6h7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>
              </button>
              <button
                onClick={() => { WindowToggleMaximise(); setIsMaximised(prev => !prev) }}
                className={winBtn}
                title={isMaximised ? t('workspace.restore') : t('workspace.maximize')}
              >
                {isMaximised ? (
                  <svg width="12" height="12" viewBox="0 0 12 12">
                    <rect x="4" y="1.5" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" strokeWidth=".9" />
                    <rect x="1.5" y="2.5" width="6.5" height="6.5" rx="1" fill="var(--color-sidebar)" stroke="currentColor" strokeWidth=".9" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" stroke="currentColor" strokeWidth=".9" rx=".5" fill="none" /></svg>
                )}
              </button>
              <button onClick={Quit} className={closeBtn} title={t('workspace.close')}>
                <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <ActivityBar activeId={sidebarPanel ?? activePanel} onSelect={handleActivitySelect} enabledModules={enabledModules} />

        {!sidebarClosed && (
          <SidePanel
            activePanel={sidebarPanel ?? activePanel}
            novels={novels}
            novelId={activeNovelId}
            onSelectNovel={handleSelectNovel}
            onSelectChapter={handleSelectChapter}
            onSelectGoink={handleSelectGoink}
            onEditNovelSettings={() => { if (activeNovel) setEditingNovel(activeNovel) }}
            onEditAISettings={() => { if (activeNovel) setAiSettingsNovel(activeNovel) }}
            onDeleteChapter={handleDeleteChapter}
            onMaintainChanges={handleMaintainChanges}
            onExportNovel={(id) => setExportNovelId(id)}
            target={tabTarget}
            showCreate={showCreate}
            setShowCreate={setShowCreate}
            title={title}
            setTitle={setTitle}
            description={description}
            setDescription={setDescription}
            onCreateNovel={handleCreateNovel}
            activeSkillName={activeSkillName}
            onSelectSkill={(path, title, readOnly) => {
              setActiveSkillName(title)
              contentRef.current?.openFile(path, title, readOnly)
            }}
            onEditSkill={(path, title, readOnly) => {
              setActiveSkillName(title)
              contentRef.current?.openFile(path, title, readOnly, 'edit')
            }}
            onNewSkill={handleNewSkill}
            onSearchNavigateEntity={handleSearchNavigateEntity}
            onSearchNavigateChapter={handleSearchNavigateChapter}
            searchQuery={searchQuery}
            searchResults={searchResults}
            onSearchChange={(q, r) => { setSearchQuery(q); setSearchResults(r) }}
            onSelectGitFile={handleSelectGitFile}
            onSelectStyleSample={(id) => setStyleSampleFocusId(id)}
            onSelectSetting={(id) => setSettingFocusId(id)}
            activeSettingId={settingFocusId}
            sandboxId={sandboxId}
            onSelectSandbox={setSandboxId}
            sidePanelWidth={sidePanelWidth}
            onSidePanelResize={setSidePanelWidth}
          />
        )}

        {activePanel === 'novels' ? (
          <BookshelfView
            novels={novels}
            activeNovelId={activeNovelId}
            onSelectNovel={handleSelectNovel}
            onEditNovel={setEditingNovel}
            onDeleteNovel={setDeletingNovel}
            onCreateNovel={() => setShowCreateDialog(true)}
            onSaveCover={handleSaveCover}
            onExportNovel={(n) => setExportNovelId(n.id)}
            onImportNovel={() => importNovel.startImport()}
          />
        ) : activePanel === 'setting' ? (
          <ErrorBoundary>
            <SettingsView novelId={activeNovelId} focusId={settingFocusId} />
          </ErrorBoundary>
        ) : activePanel !== 'characters' && activePanel !== 'locations' && activePanel !== 'storyarcs' && activePanel !== 'timeline' && activePanel !== 'reader' && activePanel !== 'preferences' && activePanel !== 'profile' && activePanel !== 'git' && activePanel !== 'style-samples' && activePanel !== 'sandbox' && (
          <ContentPanel ref={contentRef} novelId={activeNovelId} onContentChange={setActiveContent} onDirtyChange={setIsDirty} />
        )}

        {/* 沙盘：视觉化世界地图 */}
        <div className={activePanel === 'sandbox' ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
          <ErrorBoundary>
            <SandboxView novelId={activeNovelId} sandboxId={sandboxId} />
          </ErrorBoundary>
        </div>

        {/* Always mounted: pattern extraction is a long-running task, unmounting would interrupt progress listeners */}
        <div className={activePanel === 'style-samples' ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
          <ErrorBoundary>
            <ExtractWorkspaceView novelId={activeNovelId} focusSampleId={styleSampleFocusId} onFocusSampleHandled={() => setStyleSampleFocusId(null)} />
          </ErrorBoundary>
        </div>
        {activePanel === 'characters' ? (
          <ErrorBoundary>
            <CharacterListView novelId={activeNovelId} focusId={characterFocusId} />
          </ErrorBoundary>
        ) : activePanel === 'locations' ? (
          <ErrorBoundary>
            <LocationListView novelId={activeNovelId} focusId={locationFocusId} />
          </ErrorBoundary>
        ) : activePanel === 'storyarcs' ? (
          <ErrorBoundary>
            <ArcListView novelId={activeNovelId} focusArcId={arcFocusId} />
          </ErrorBoundary>
        ) : activePanel === 'timeline' ? (
          <ErrorBoundary>
            <TimelineView novelId={activeNovelId} focusEntryId={timelineFocusId} />
          </ErrorBoundary>
        ) : activePanel === 'reader' ? (
          <ErrorBoundary>
            <ReaderView novelId={activeNovelId} focusId={readerFocusId} />
          </ErrorBoundary>
        ) : activePanel === 'preferences' ? (
          <ErrorBoundary>
            <PreferenceView novelId={activeNovelId} focusId={preferenceFocusId} />
          </ErrorBoundary>
        ) : activePanel === 'git' ? (
          <ErrorBoundary>
            <GitCommitView file={selectedGitFile} />
          </ErrorBoundary>
        ) : activePanel === 'trash' ? (
          <ErrorBoundary>
            <TrashView novelId={activeNovelId} />
          </ErrorBoundary>
        ) : activePanel === 'archive' ? (
          <ErrorBoundary>
            <ArchiveView />
          </ErrorBoundary>
        ) : activePanel === 'profile' ? (
          <ErrorBoundary>
            <ProfileView />
          </ErrorBoundary>
        ) : null}

        {activePanel !== 'profile' && (
          <ChatPanel ref={chatRef} novelId={activeNovelId} onApprove={handleApprove} onReject={handleReject} onApprovalFileEdit={handleApprovalFileEdit} chatPanelWidth={chatPanelWidth} onChatPanelResize={setChatPanelWidth} />
        )}
      </div>

      <StatusBar content={activeContent} isDirty={isDirty} />

      <SettingsDialog
        open={showSettings}
        novelId={activeNovelId}
        onClose={() => {
          setShowSettings(false)
          loadReminderSetting()
        }}
        initialTab="general"
      />

      <HelpDialog
        open={showHelp}
        onClose={() => setShowHelp(false)}
      />

      <NovelEditDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onSave={handleCreateNovelFromDialog}
      />
      <NovelEditDialog
        open={!!editingNovel}
        novel={editingNovel}
        onClose={() => setEditingNovel(null)}
        onSave={handleUpdateNovel}
      />
      <AISettingsDialog
        open={!!aiSettingsNovel}
        novel={aiSettingsNovel}
        onClose={() => setAiSettingsNovel(null)}
        onSave={handleSaveAISettings}
      />

      <NovelDeleteDialog
        open={!!deletingNovel}
        novelTitle={deletingNovel?.title ?? ''}
        onClose={() => setDeletingNovel(null)}
        onConfirm={handleDeleteNovel}
      />

      <ExportDialog
        open={exportNovelId !== null}
        novelId={exportNovelId}
        novelTitle={novels.find(n => n.id === exportNovelId)?.title ?? ''}
        onClose={() => setExportNovelId(null)}
        onExport={handleExportNovel}
      />

      <ImportProgressDialog
        {...importNovel.dialogProps}
        maxChapters={importNovel.maxChapters}
        setMaxChapters={importNovel.setMaxChapters}
        modelKey={importNovel.modelKey}
        setModelKey={importNovel.setModelKey}
        modelOptions={importNovel.modelOptions}
        onStartLLM={importNovel.startLLMImport}
      />

      <UpdateDialog
        open={showUpdate}
        result={updateResult}
        onClose={() => setShowUpdate(false)}
      />

      {remindOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-80 rounded-lg border bg-background shadow-lg p-4 space-y-3">
            <p className="text-sm font-medium">{t('sidebar.maintainRemindTitle')}</p>
            <p className="text-xs text-muted-foreground">
              {t('sidebar.maintainRemindBody', { count: remindFiles.length })}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={handleRemindLater}
                className="h-8 px-3 rounded-md text-xs border hover:bg-muted transition-colors"
              >
                {t('sidebar.remindLater')}
              </button>
              <button
                onClick={handleRemindNow}
                className="h-8 px-3 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                {t('sidebar.maintainNow')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

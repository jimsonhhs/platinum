import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import { type OnMount, DiffEditor } from '@monaco-editor/react'
import { FileText, Loader2, History, Undo2, Redo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toastError } from '@/lib/utils'
import { useApp } from '@/hooks/useApp'
import { useEditorTabs } from '@/hooks/useEditorTabs'
import { useTheme } from '@/hooks/useTheme'
import { EventsOn } from '@/lib/wailsjs/runtime/runtime'
import TabBar from './TabBar'
import ContentEditor from './ContentEditor'
import OutlineViewer from './OutlineViewer'
import ReferenceDrawer from './ReferenceDrawer'
import SkillPreview from './SkillPreview'
import HistoryPanel from './HistoryPanel'
import SkillEditForm from '@/components/skill/SkillEditForm'
import Markdown from '@/components/Markdown'
import { outlinePath, userOutlinePath, draftPath, isContentPath, isOutlinePath, isSkillPath, skillNameFromPath } from './types'
import type { EditorTab } from './types'
import './ContentPanel.css'

import { useEditorPrefs } from '@/hooks/useEditorPrefs'
import { MONACO_THEME, ensureMonacoThemes, getPrefs } from '@/lib/editorTheme'

export interface ContentPanelHandle {
  openFile: (path: string, title: string, readOnly?: boolean, initialViewMode?: string) => void
  openFileWithHighlight: (path: string, title: string, matchPos: number, matchLen: number) => void
  clearHighlight: () => void
  closeAllTabs: () => void
  closeFile: (path: string) => void
  openDiffTab: (data: {
    path: string; title: string; diff: string; original: string; modified: string
    changeType: string; reason: string; toolId: string
  }) => void
  handleDiffApprove: (toolId: string) => Promise<void>
  handleDiffReject: (toolId: string) => void
}

interface Props {
  novelId: number
  onContentChange?: (content: string) => void
  onDirtyChange?: (isDirty: boolean) => void
}

const ContentPanel = forwardRef<ContentPanelHandle, Props>(function ContentPanel(
  { novelId, onContentChange, onDirtyChange }, ref
) {
  const app = useApp()
  const { t } = useTranslation()
  const {
    tabs, activeTab, activeTabId,
    openTab, closeTab, closeAllTabs, closeOtherTabs, setActiveTabId,
    updateTab, openDiffTab, initRef,
  } = useEditorTabs(novelId)

  const { theme } = useTheme()
  const [showReference, setShowReference] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [showDraftUpdated, setShowDraftUpdated] = useState(false)
  const [historyTarget, setHistoryTarget] = useState<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userOutlineSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const savingRef = useRef<{ id: string; path: string; content: string } | null>(null)
  const pendingHighlightRef = useRef<{ matchPos: number; matchLen: number } | null>(null)
  const didApplyHighlightRef = useRef(false) // handleEditorMount 已应用高亮时跳过清除
  const novelIdRef = useRef(novelId)
  const tabsRef = useRef(tabs)

  useEffect(() => { novelIdRef.current = novelId }, [novelId])
  useEffect(() => { tabsRef.current = tabs }, [tabs])

  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [])

  useEffect(() => {
    if (activeTab?.type === 'file') {
      onContentChange?.(activeTab.content ?? '')
    }
  }, [activeTab, onContentChange])

  useEffect(() => {
    onDirtyChange?.(activeTab?.isDirty ?? false)
  }, [activeTab?.isDirty, onDirtyChange])

  // 从 localStorage 恢复 tab 后，自动加载文件内容
  const loadedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    // novelId 变化时重置
    loadedRef.current.clear()
  }, [novelId])
  useEffect(() => {
    if (!initRef.current) return
    const needsLoad = tabs.filter(tab => tab.type === 'file' && tab.content == null && !loadedRef.current.has(tab.id))
    if (needsLoad.length === 0) return
    for (const tab of needsLoad) {
      loadedRef.current.add(tab.id)
      app.GetContent(novelId, tab.path).then(content => {
        updateTab(tab.id, { content: content ?? '' })
      }).catch(() => {
        updateTab(tab.id, { content: t('content.loadFailedCloseTab') })
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- initRef.current is mutable and not a valid dependency; effect should only re-run when tabs/novelId change
  }, [tabs, novelId, app, t, updateTab])

  // Ctrl+Shift+V 切换技能预览
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'V') {
        const tab = tabs.find(t => t.id === activeTabId)
        if (tab?.type === 'file' && (isSkillPath(tab.path) || tab.path === 'platinum.md')) {
          e.preventDefault()
          const newMode = tab.viewMode === 'preview' ? 'content' : 'preview'
          updateTab(tab.id, { viewMode: newMode })
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [tabs, activeTabId, updateTab])

  // ── 切换 viewMode：按需加载大纲（正文大纲 + 用户大纲 + 草稿） ──────

  const handleSetViewMode = useCallback((tabId: string, mode: 'content' | 'outline' | 'userOutline' | 'draft') => {
    const tab = tabs.find(t => t.id === tabId)
    if (!tab) return

    // 切到草稿视图：先加载草稿内容，再切换视图（保证编辑器挂载时 model 已带内容）
    if (mode === 'draft' && tab.type === 'file') {
      const isChapter = isContentPath(tab.path) && tab.path !== 'platinum.md'
      if (isChapter) {
        const num = parseInt(tab.path.replace(/.*\//, '').replace('.md', ''))
        if (num) {
          app.GetContent(novelId, draftPath(num)).then(dc => {
            updateTab(tabId, { viewMode: 'draft', draftContent: dc || '' })
          }).catch(() => {
            updateTab(tabId, { viewMode: 'draft', draftContent: '' })
          })
          return
        }
      }
    }

    updateTab(tabId, { viewMode: mode })

    // 切换到大纲/用户大纲视图时，如未加载则加载
    if ((mode === 'outline' || mode === 'userOutline') && tab.type === 'file') {
      const isChapter = isContentPath(tab.path) && tab.path !== 'platinum.md'
      if (isChapter) {
        const num = parseInt(tab.path.replace(/.*\//, '').replace('.md', ''))
        if (!tab.outlineContent) {
          app.GetContent(novelId, outlinePath(num)).then(oc => {
            updateTab(tabId, { outlineContent: oc || '' })
          }).catch(() => {
            updateTab(tabId, { outlineContent: '' })
          })
        }
        if (!tab.userOutlineContent) {
          app.GetContent(novelId, userOutlinePath(num)).then(uc => {
            updateTab(tabId, { userOutlineContent: uc || '' })
          }).catch(() => {
            updateTab(tabId, { userOutlineContent: '' })
          })
        }
      }
    }
  }, [novelId, tabs, app, updateTab])

  // ── 保存逻辑 ────────────────────────────────────────────

  const doSave = useCallback(async (tabId: string, path: string, content: string) => {
    if (!novelIdRef.current) return
    try {
      await app.SaveContent({ novel_id: novelIdRef.current, path, content })
      updateTab(tabId, { isDirty: false })
    } catch (err) {
      toastError(t('common.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      console.error(err)
    }
  }, [app, updateTab, t])

  // Ctrl+S 立即保存
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 's') {
        e.preventDefault()
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        const s = savingRef.current
        if (s) doSave(s.id, s.path, s.content)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [doSave])

  const handleEditorChange = useCallback((tabId: string, value: string | undefined) => {
    const content = value ?? ''
    updateTab(tabId, { content, isDirty: true })
    onContentChange?.(content)

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    const tab = tabs.find(t => t.id === tabId)
    if (!tab) return
    savingRef.current = { id: tabId, path: tab.path, content }
    saveTimerRef.current = setTimeout(() => {
      if (!savingRef.current) return
      const s = savingRef.current
      doSave(s.id, s.path, s.content)
    }, 500)
  }, [tabs, updateTab, doSave, onContentChange])

  const handleUserOutlineChange = useCallback((tabId: string, value: string | undefined) => {
    const content = value ?? ''
    updateTab(tabId, { userOutlineContent: content, isDirty: true })

    if (userOutlineSaveTimerRef.current) clearTimeout(userOutlineSaveTimerRef.current)
    const tab = tabs.find(t => t.id === tabId)
    if (!tab) return
    const num = parseInt(tab.path.replace(/.*\//, '').replace('.md', ''))
    if (!num) return
    const path = userOutlinePath(num)
    userOutlineSaveTimerRef.current = setTimeout(async () => {
      try {
        await app.SaveContent({ novel_id: novelIdRef.current, path, content })
        updateTab(tabId, { isDirty: false })
      } catch (err) {
        toastError(t('common.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      }
    }, 500)
  }, [tabs, updateTab, app, t])

  const handleDraftChange = useCallback((tabId: string, value: string | undefined) => {
    const content = value ?? ''
    updateTab(tabId, { draftContent: content, isDirty: true })

    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current)
    const tab = tabs.find(t => t.id === tabId)
    if (!tab) return
    const num = parseInt(tab.path.replace(/.*\//, '').replace('.md', ''))
    if (!num) return
    const path = draftPath(num)
    draftSaveTimerRef.current = setTimeout(async () => {
      try {
        await app.SaveContent({ novel_id: novelIdRef.current, path, content })
        updateTab(tabId, { isDirty: false })
      } catch (err) {
        toastError(t('common.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      }
    }, 500)
  }, [tabs, updateTab, app, t])

  async function flushPendingSaves() {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    if (draftSaveTimerRef.current) { clearTimeout(draftSaveTimerRef.current); draftSaveTimerRef.current = null }
    if (userOutlineSaveTimerRef.current) { clearTimeout(userOutlineSaveTimerRef.current); userOutlineSaveTimerRef.current = null }
    const tab = tabs.find(t => t.id === activeTabId)
    if (!tab || tab.type !== 'file') return
    const isChapter = isContentPath(tab.path) && tab.path !== 'platinum.md'
    const num = isChapter ? parseInt(tab.path.replace(/.*\//, '').replace('.md', '')) : 0
    if (tab.content != null) {
      try { await doSave(tab.id, tab.path, tab.content) } catch {}
    }
    if (num && tab.draftContent != null) {
      try { await app.SaveContent({ novel_id: novelIdRef.current, path: draftPath(num), content: tab.draftContent }); updateTab(tab.id, { isDirty: false }) } catch {}
    }
    if (num && tab.userOutlineContent != null) {
      try { await app.SaveContent({ novel_id: novelIdRef.current, path: userOutlinePath(num), content: tab.userOutlineContent }); updateTab(tab.id, { isDirty: false }) } catch {}
    }
  }

  async function handleImportDraft() {
    const tab = tabs.find(t => t.id === activeTabId)
    if (!tab || tab.type !== 'file') return
    const num = parseInt(tab.path.replace(/.*\//, '').replace('.md', ''))
    if (!num) return
    const draftLen = (tab.draftContent ?? '').length
    const bodyLen = (tab.content ?? '').length
    if (!confirm(t('content.draftImportConfirm', { n: num, draft: draftLen, body: bodyLen }))) return
    try {
      await app.ImportDraft(novelIdRef.current, num)
      toastError(t('content.draftImported'))
      // 刷新正文内容
      app.GetContent(novelIdRef.current, tab.path).then(c => updateTab(tab.id, { content: c ?? '' })).catch(() => {})
    } catch (err) {
      toastError(t('content.draftImportFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      console.error(err)
    }
  }

  async function handleCopyToDraft() {
    const tab = tabs.find(t => t.id === activeTabId)
    if (!tab || tab.type !== 'file') return
    const num = parseInt(tab.path.replace(/.*\//, '').replace('.md', ''))
    if (!num) return
    if (!confirm(t('content.copyToDraftConfirm'))) return
    try {
      await flushPendingSaves()
      await app.CopyToDraft(novelIdRef.current, num)
      app.GetContent(novelIdRef.current, draftPath(num)).then(dc => {
        updateTab(tab.id, { draftContent: dc || '' })
        // 兜底：若草稿编辑器已挂载，直接写入（不依赖受控 value 更新链）
        try { editorRef.current?.setValue(dc ?? '') } catch {}
      }).catch(() => {})
    } catch (err) {
      toastError(t('content.copyToDraftFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      console.error(err)
    }
  }

  // 对比草稿与正文差异（只读 diff 标签页）
  async function handleCompareDraft() {
    const tab = tabs.find(t => t.id === activeTabId)
    if (!tab || tab.type !== 'file') return
    const num = parseInt(tab.path.replace(/.*\//, '').replace('.md', ''))
    if (!num) return
    try {
      await flushPendingSaves()
      const [body, draftText] = await Promise.all([
        app.GetContent(novelIdRef.current, tab.path),
        app.GetContent(novelIdRef.current, draftPath(num)),
      ])
      openDiffTab({
        path: draftPath(num),
        title: `${t('content.compareDraftTitle')} ${tab.title ?? ''}`,
        diff: '',
        original: body ?? '',
        modified: draftText ?? '',
        changeType: 'compare',
        reason: 'draft-vs-body',
        toolId: `compare-draft-${num}`,
      })
    } catch (err) {
      toastError(t('content.compareDraftFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      console.error(err)
    }
  }

  // 历史面板：当前视图对应的文件（正文/草稿/用户大纲/正文大纲）
  function openHistory() {
    const tab = tabs.find(t => t.id === activeTabId)
    if (!tab || tab.type !== 'file') return
    const vm = tab.viewMode || 'content'
    if (vm === 'content') { setHistoryTarget(tab.path); return }
    if (vm === 'userOutline') {
      const num = parseInt(tab.path.replace(/.*\//, '').replace('.md', ''))
      if (num) setHistoryTarget(userOutlinePath(num))
      return
    }
    if (vm === 'draft') {
      const num = parseInt(tab.path.replace(/.*\//, '').replace('.md', ''))
      if (num) setHistoryTarget(draftPath(num))
      return
    }
    if (vm === 'outline') {
      const num = parseInt(tab.path.replace(/.*\//, '').replace('.md', ''))
      if (num) setHistoryTarget(outlinePath(num))
    }
  }

  const monacoRef = useRef<any>(null)

  // 将 rune 偏移转为 Monaco 行列号（1-based）
  function runeOffsetToMonaco(text: string, runeOffset: number): { line: number; col: number } {
    let runeCount = 0
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const lineRunes = [...lines[i]].length
      if (runeCount + lineRunes >= runeOffset) {
        return { line: i + 1, col: (runeOffset - runeCount) + 1 }
      }
      runeCount += lineRunes + 1 // +1 for \n
    }
    return { line: lines.length, col: 1 }
  }

  const doHighlight = useCallback((editor: Parameters<OnMount>[0], content: string, matchPos: number, matchLen: number) => {
    const monaco = monacoRef.current
    if (!monaco || !editor.getModel()) return

    const totalLines = editor.getModel()!.getLineCount()
    const { line, col } = runeOffsetToMonaco(content, matchPos)
    const clampedEnd = Math.min(matchPos + matchLen, [...content].length)
    const { line: endLine, col: endCol } = runeOffsetToMonaco(content, clampedEnd)
    const ctxEnd = Math.min(endLine + 1, totalLines)

    const decorations: any[] = [
      {
        range: new monaco.Range(Math.max(1, line - 1), 1, ctxEnd, 1),
        options: { isWholeLine: true, className: 'search-context-highlight' },
      },
      {
        range: new monaco.Range(line, col, endLine, endCol),
        options: { className: 'search-keyword-highlight' },
      },
    ]

    const collection = (editor as any)._searchDecorations
    if (collection) collection.clear()
    ;(editor as any)._searchDecorations = editor.createDecorationsCollection(decorations)

    editor.revealPositionInCenter({ lineNumber: line, column: col })
    editor.setPosition({ lineNumber: line, column: col })
  }, [])

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    // 注册护眼/黑黄/自定义 Monaco 主题并应用
    const prefs = getPrefs()
    const themeName = ensureMonacoThemes(monaco, prefs.customFg, prefs.customBg)
    try { monaco.editor.setTheme(themeName) } catch { /* ignore */ }
    editor.onDidBlurEditorText(() => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      const s = savingRef.current
      if (!s) return
      doSave(s.id, s.path, s.content)
    })
    // 编辑器挂载后检查待处理高亮（直接取 Monaco model 内容，避免 ref 时序问题）。
    const pending = pendingHighlightRef.current
    if (pending) {
      const content = editor.getModel()?.getValue()
      if (content) {
        doHighlight(editor, content, pending.matchPos, pending.matchLen)
        pendingHighlightRef.current = null
        didApplyHighlightRef.current = true
      }
    }
  }, [doSave, doHighlight])

  // 主题/自定义颜色变化时，对已挂载的编辑器即时应用
  const editorPrefs = useEditorPrefs()
  const editorTheme = (editorPrefs.customFg || editorPrefs.customBg) ? 'platinum-custom' : MONACO_THEME[theme]
  useEffect(() => {
    const monaco = monacoRef.current
    if (!monaco?.editor) return
    const name = ensureMonacoThemes(monaco, editorPrefs.customFg, editorPrefs.customBg)
    try { monaco.editor.setTheme(name) } catch { /* ignore */ }
  }, [theme, editorPrefs.customFg, editorPrefs.customBg])

  // ── 离开页面自动存档：切视图/切标签时，把上一个视图对应文件归档到历史 ──
  const lastViewRef = useRef<{ id: string | null; mode: string } | null>(null)
  useEffect(() => {
    const prev = lastViewRef.current
    const curMode = (tabsRef.current.find(t => t.id === activeTabId)?.viewMode) || 'content'
    lastViewRef.current = { id: activeTabId, mode: curMode }
    if (!prev || !prev.id) return
    if (prev.id === activeTabId && prev.mode === curMode) return
    const tab = tabsRef.current.find(t => t.id === prev.id)
    if (!tab || tab.type !== 'file') return
    const isChapter = isContentPath(tab.path) && tab.path !== 'platinum.md'
    const num = isChapter ? parseInt(tab.path.replace(/.*\//, '').replace('.md', '')) : 0
    let rel: string | null = null
    if (prev.mode === 'content') rel = tab.path
    else if (prev.mode === 'draft' && num) rel = draftPath(num)
    else if (prev.mode === 'userOutline' && num) rel = userOutlinePath(num)
    else if (prev.mode === 'outline' && num) rel = outlinePath(num)
    if (rel) app.ArchiveHistory(novelIdRef.current, rel).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, tabs])

  // ── file:changed 事件监听 ─────────────────────────────────
  // 用 ref 读取最新 tabs，避免因 tabs 变化频繁重建订阅丢失事件

  useEffect(() => {
    const unsub = EventsOn('file:changed', async (data: any) => {
      if (data.novel_id !== novelIdRef.current) return

      for (const tab of tabsRef.current) {
        if (tab.type !== 'file') continue

        let needRefresh = false
        let refreshKey: 'content' | 'outlineContent' | 'userOutlineContent' | 'draftContent' = 'content'

        if (tab.path === data.path) {
          needRefresh = true
          refreshKey = 'content'
        } else {
          const isChapter = isContentPath(tab.path) && tab.path !== 'platinum.md'
          const num = isChapter ? parseInt(tab.path.replace(/.*\//, '').replace('.md', '')) : 0
          const derivedOutline = isChapter ? outlinePath(num) : null
          const derivedUserOutline = isChapter ? userOutlinePath(num) : null
          const derivedDraft = isChapter ? draftPath(num) : null
          if (derivedOutline && derivedOutline === data.path) {
            needRefresh = true
            refreshKey = 'outlineContent'
          } else if (derivedUserOutline && derivedUserOutline === data.path) {
            needRefresh = true
            refreshKey = 'userOutlineContent'
          } else if (derivedDraft && derivedDraft === data.path) {
            needRefresh = true
            refreshKey = 'draftContent'
            if (viewMode !== 'draft') {
              setShowDraftUpdated(true)
            }
          }
        }

        if (needRefresh) {
          try {
            const fresh = await app.GetContent(data.novel_id, data.path)
            const patch: Partial<EditorTab> = { [refreshKey]: fresh }
            if (refreshKey === 'content') patch.isDirty = false
            updateTab(tab.id, patch)
          } catch { /* 文件可能被删 */ }
        }
      }
    })
    return () => unsub()
  }, [app, updateTab])

  // ── 打开/激活文件 tab ──────────────────────────────────

  const titleFromPath = useCallback((p: string): string => {
    if (p.startsWith('chapters/')) {
      const num = parseInt(p.replace('chapters/', '').replace('.md', ''))
      return t('sidebar.aiIndex', { n: num })
    }
    if (p === 'platinum.md') return t('content.storyStatus')
    if (isSkillPath(p)) return `${t('content.skillLabel')}${skillNameFromPath(p)}`
    return p
  }, [t])

  const doOpenFile = useCallback((path: string, title?: string, readOnly?: boolean, initialViewMode?: string) => {
    const display = title || titleFromPath(path)
    const existing = tabs.find(t => t.path === path && t.type === 'file')
    if (existing) {
      if (initialViewMode) {
        updateTab(existing.id, { viewMode: initialViewMode as EditorTab['viewMode'] })
      }
      // 以大纲类视图打开时，如尚未加载则补加载
      if ((initialViewMode === 'outline' || initialViewMode === 'userOutline') && isContentPath(path) && path !== 'platinum.md') {
        const num = parseInt(path.replace(/.*\//, '').replace('.md', ''))
        if (num) {
          if (!existing.outlineContent) {
            app.GetContent(novelId, outlinePath(num)).then(oc => updateTab(existing.id, { outlineContent: oc || '' })).catch(() => {})
          }
          if (!existing.userOutlineContent) {
            app.GetContent(novelId, userOutlinePath(num)).then(uc => updateTab(existing.id, { userOutlineContent: uc || '' })).catch(() => {})
          }
        }
      }
      setActiveTabId(existing.id)
      onContentChange?.(existing.content ?? '')
      return
    }

    const skReadOnly = readOnly ?? path.startsWith('/builtin/skills/')
    const initialMode: EditorTab['viewMode'] = initialViewMode as EditorTab['viewMode'] ||
      (skReadOnly ? 'preview' : (isSkillPath(path) ? 'preview' : 'content'))

    const isChapter = isContentPath(path) && path !== 'platinum.md'
    const num = isChapter ? parseInt(path.replace(/.*\//, '').replace('.md', '')) : 0
    const wantOutline = isChapter && num > 0 && (initialMode === 'outline' || initialMode === 'userOutline' || initialMode === 'draft')

    setIsLoading(true)
    Promise.all([
      app.GetContent(novelId, path),
      wantOutline ? app.GetContent(novelId, outlinePath(num)) : Promise.resolve(''),
      wantOutline ? app.GetContent(novelId, userOutlinePath(num)) : Promise.resolve(''),
      wantOutline ? app.GetContent(novelId, draftPath(num)) : Promise.resolve(''),
    ]).then(([c, oc, uc, dc]) => {
      const content = c ?? ''
      openTab({
        type: 'file', path, title: display, content,
        outlineContent: wantOutline ? (oc || '') : undefined,
        userOutlineContent: wantOutline ? (uc || '') : undefined,
        draftContent: wantOutline ? (dc || '') : undefined,
        isDirty: false, viewMode: initialMode, readOnly: skReadOnly,
      })
      onContentChange?.(content)
    }).catch(() => {
      openTab({ type: 'file', path, title: display, content: '', isDirty: false, viewMode: initialMode, readOnly: skReadOnly })
      onContentChange?.('')
    }).finally(() => setIsLoading(false))
  }, [novelId, tabs, app, openTab, setActiveTabId, onContentChange, titleFromPath, updateTab])


  const clearHighlight = useCallback(() => {
    const editor = editorRef.current as any
    if (editor?._searchDecorations) {
      editor._searchDecorations.clear()
      editor._searchDecorations = null
    }
  }, [])

  const doOpenFileWithHighlight = useCallback((path: string, title: string, matchPos: number, matchLen: number) => {
    if (matchPos < 0) {
      doOpenFile(path, title)
      return
    }
    const existing = tabs.find(t => t.path === path && t.type === 'file')
    // 当前激活的 tab：直接应用高亮，不走 pending（setActiveTabId 同值不触发 effect）
    if (existing && existing.id === activeTabId && existing.content && editorRef.current) {
      doHighlight(editorRef.current, existing.content, matchPos, matchLen)
      return
    }
    pendingHighlightRef.current = { matchPos, matchLen }
    if (existing) {
      setActiveTabId(existing.id)
      return
    }
    doOpenFile(path, title)
  }, [doOpenFile, tabs, activeTabId, setActiveTabId, doHighlight])

  // tab 切换 / 内容就绪：有 pending 且 editor model 存活就应用高亮，否则清除旧高亮。
  // didApplyHighlightRef：handleEditorMount 在 layout effect 阶段消费 pending 后，
  // 标记跳过后续 effect 的清除，避免刚设的高亮被擦除。
  useEffect(() => {
    if (didApplyHighlightRef.current) {
      didApplyHighlightRef.current = false
      return
    }
    const editor = editorRef.current as any
    const pending = pendingHighlightRef.current
    // 必须检查 editor.getModel()：key 变化导致 ContentEditor 重建时，
    // unmount/remount 之间 editorRef 可能指向已销毁的旧 editor（model 为 null），
    // 此时不应消费 pending，留给 handleEditorMount 处理。
    if (pending && activeTab?.content && editor?.getModel()) {
      doHighlight(editor, activeTab.content, pending.matchPos, pending.matchLen)
      pendingHighlightRef.current = null
      return
    }
    if (editor?._searchDecorations) {
      editor._searchDecorations.clear()
      editor._searchDecorations = null
    }
  }, [activeTab?.id, activeTab?.content, doHighlight])

  function filePathFromDiff(diffPath: string): { filePath: string; viewMode: 'content' | 'outline' } {
    if (isOutlinePath(diffPath)) {
      return { filePath: diffPath.replace('outlines/', 'chapters/'), viewMode: 'outline' }
    }
    return { filePath: diffPath, viewMode: 'content' }
  }

  // ── 审批操作（由 WorkspaceView 通过 ref 调用）───────────

  const handleDiffApprove = useCallback(async (toolId: string) => {
    const dt = tabs.find(t => t.type === 'diff' && t.toolId === toolId)
    if (!dt) return

    const { filePath, viewMode } = filePathFromDiff(dt.path)
    const ft = tabs.find(t => t.type === 'file' && t.path === filePath)

    if (ft) {
      try {
        const fresh = await app.GetContent(novelId, dt.path)
        const patch: Partial<EditorTab> = { viewMode }
        if (viewMode === 'outline') {
          patch.outlineContent = fresh
        } else {
          patch.content = fresh
          patch.isDirty = false
        }
        updateTab(ft.id, patch)
      } catch { /* ignored */ }
    }

    closeTab(dt.id)
    doOpenFile(filePath)
  }, [novelId, tabs, app, updateTab, closeTab, doOpenFile])

  const handleDiffReject = useCallback((toolId: string) => {
    const dt = tabs.find(t => t.type === 'diff' && t.toolId === toolId)
    if (!dt) return

    const { filePath } = filePathFromDiff(dt.path)
    closeTab(dt.id)
    doOpenFile(filePath)
  }, [tabs, closeTab, doOpenFile])

  // ── 暴露给父组件的方法 ──────────────────────────────────

  const closeFile = useCallback((path: string) => {
    tabs.filter(t => t.type === 'file' && t.path === path).forEach(t => closeTab(t.id))
  }, [tabs, closeTab])

  useImperativeHandle(ref, () => ({
    openFile: doOpenFile,
    openFileWithHighlight: doOpenFileWithHighlight,
    clearHighlight,
    closeAllTabs,
    closeFile,
    openDiffTab,
    handleDiffApprove,
    handleDiffReject,
  }), [doOpenFile, doOpenFileWithHighlight, clearHighlight, closeAllTabs, closeFile, openDiffTab, handleDiffApprove, handleDiffReject])


  // ── 渲染 ────────────────────────────────────────────────

  const tabBtnClass = (active: boolean) =>
    `px-3 py-1 text-xs rounded transition-colors cursor-pointer ${
      active ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
    }`

  // 空状态
  if (!activeTab) {
    return (
      <main className="flex-1 bg-background flex flex-col min-w-0 min-h-0 border-r overflow-hidden">
        <TabBar tabs={tabs} activeTabId={activeTabId} onSelect={setActiveTabId} onClose={closeTab} onCloseOthers={closeOtherTabs} onCloseAll={closeAllTabs} />
        <div className="flex-1 flex items-center justify-center">
          {tabs.length === 0 ? (
            <div className="text-center">
              <FileText className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">{t('content.selectOrCreateChapter')}</p>
            </div>
          ) : (
            <div className="text-center">
              <FileText className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">{t('content.selectTab')}</p>
            </div>
          )}
        </div>
      </main>
    )
  }

  // Diff tab
  if (activeTab.type === 'diff') {
    const isOutline = activeTab.path?.startsWith('outlines/')

    return (
      <main className="flex-1 bg-background flex flex-col min-w-0 min-h-0 border-r overflow-hidden">
        <TabBar tabs={tabs} activeTabId={activeTabId} onSelect={setActiveTabId} onClose={closeTab} onCloseOthers={closeOtherTabs} onCloseAll={closeAllTabs} />
        <div className="flex items-center px-4 py-2 border-b shrink-0 select-none">
          <span className="text-sm font-medium truncate">{activeTab.title}</span>
        </div>
        <div className="flex-1 overflow-auto">
          {isOutline ? (
            <div className="p-6">
              <Markdown content={activeTab.modified ?? ''} />
            </div>
          ) : (
            <DiffEditor
              height="100%"
              language="markdown"
              theme={MONACO_THEME[theme]}
              original={activeTab.original}
              modified={activeTab.modified}
              onMount={editor => {
                setTimeout(() => {
                  const modified = editor.getModifiedEditor()
                  const changes = editor.getLineChanges()
                  if (changes?.length) {
                    modified.revealLineInCenter(changes[0].modifiedStartLineNumber)
                    modified.setPosition({ lineNumber: changes[0].modifiedStartLineNumber, column: 1 })
                  }
                }, 100)
              }}
              options={{
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 15,
                lineHeight: 26,
                fontFamily: "'Noto Serif SC', 'Source Han Serif SC', serif",
                lineNumbers: 'off',
                wordWrap: 'on',
                automaticLayout: true,
                readOnly: true,
                renderSideBySide: false,
                renderIndicators: true,
              }}
            />
          )}
        </div>
      </main>
    )
  }

  // File tab
  const viewMode = activeTab.viewMode || 'content'

  return (
    <main className="flex-1 bg-background flex flex-col min-w-0 min-h-0 border-r overflow-hidden">
      <TabBar tabs={tabs} activeTabId={activeTabId} onSelect={setActiveTabId} onClose={closeTab} onCloseOthers={closeOtherTabs} onCloseAll={closeAllTabs} />
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0 select-none">
        <span className="text-sm font-medium truncate">{activeTab.title}</span>
        <div className="flex items-center gap-0.5 shrink-0">
          {viewMode === 'draft' && (
            <>
              <button
                onClick={handleCompareDraft}
                title={t('content.compareDraftTitle')}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs border hover:bg-muted transition-colors ml-1"
              >
                {t('content.compareDraft')}
              </button>
              <button
                onClick={handleCopyToDraft}
                title={t('content.draftHint')}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs border hover:bg-muted transition-colors ml-1"
              >
                {t('content.copyToDraft')}
              </button>
              <button
                onClick={handleImportDraft}
                title={t('content.draftImportHint')}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity ml-1"
              >
                {t('content.draftImport')}
              </button>
            </>
          )}
          <button
            onClick={() => setShowReference(v => !v)}
            title={t('content.reference')}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs border hover:bg-muted transition-colors ml-1"
          >
            {t('content.viewSettings')}
          </button>
          <button
            onClick={() => (editorRef.current as any)?.trigger('toolbar', 'undo', null)}
            title="Ctrl+Z"
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs border hover:bg-muted transition-colors ml-1"
          >
            <Undo2 className="w-3.5 h-3.5" />
            {t('content.undo')}
          </button>
          <button
            onClick={() => (editorRef.current as any)?.trigger('toolbar', 'redo', null)}
            title="Ctrl+Y"
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs border hover:bg-muted transition-colors ml-1"
          >
            <Redo2 className="w-3.5 h-3.5" />
            {t('content.redo')}
          </button>
          {activeTab.path === 'platinum.md' ? (
            <button
              onClick={() => updateTab(activeTab.id, { viewMode: viewMode === 'preview' ? 'content' : 'preview' })}
              className={tabBtnClass(viewMode === 'preview')}
            >
              {t('content.preview')}
            </button>
          ) : isSkillPath(activeTab.path) ? (
            <>
              <button
                onClick={() => updateTab(activeTab.id, { viewMode: 'preview' })}
                className={tabBtnClass(viewMode === 'preview')}
              >
                {t('content.preview')}
              </button>
              {!activeTab.readOnly && (
                <button
                  onClick={() => updateTab(activeTab.id, { viewMode: 'edit' })}
                  className={tabBtnClass(viewMode === 'edit')}
                >
                  {t('content.edit')}
                </button>
              )}
            </>
          ) : (
            <>
              <button
                onClick={openHistory}
                title={t('content.historyTitle')}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs border hover:bg-muted transition-colors ml-1"
              >
                <History className="w-3.5 h-3.5" />
                {t('content.draftHistory')}
              </button>
              <button onClick={() => handleSetViewMode(activeTab.id, 'content')} className={tabBtnClass(viewMode === 'content')}>
                {t('content.body')}
              </button>
              <button onClick={() => handleSetViewMode(activeTab.id, 'draft')} className={tabBtnClass(viewMode === 'draft')}>
                {t('content.draft')}
              </button>
              <button onClick={() => handleSetViewMode(activeTab.id, 'userOutline')} className={tabBtnClass(viewMode === 'userOutline')}>
                {t('content.userOutline')}
              </button>
              <button onClick={() => handleSetViewMode(activeTab.id, 'outline')} className={tabBtnClass(viewMode === 'outline')}>
                {t('content.bodyOutline')}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-h-0 min-w-0">
        {showDraftUpdated && viewMode !== 'draft' && (
          <button
            onClick={() => { if (activeTabId) { handleSetViewMode(activeTabId, 'draft'); setShowDraftUpdated(false) } }}
            className="w-full flex items-center justify-between px-4 py-1.5 text-xs bg-primary/10 text-primary hover:bg-primary/15 transition-colors shrink-0"
          >
            <span>{t('content.draftUpdatedHint')}</span>
            <span className="underline">{t('content.viewDraft')}</span>
          </button>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : viewMode === 'preview' ? (
          <SkillPreview key="view-preview" content={activeTab.content ?? ''} />
        ) : viewMode === 'edit' ? (
          <SkillEditForm
            key="view-edit"
            content={activeTab.content ?? ''}
            readOnly={activeTab.readOnly}
            onSave={async (newContent) => {
              await doSave(activeTab.id, activeTab.path, newContent as string)
              updateTab(activeTab.id, { viewMode: 'preview' })
            }}
            onCancel={() => updateTab(activeTab.id, { viewMode: 'preview' })}
          />
        ) : viewMode === 'userOutline' ? (
          <ContentEditor
            key="view-useroutline"
            value={activeTab.userOutlineContent ?? ''}
            onChange={v => handleUserOutlineChange(activeTab.id, v)}
            onMount={handleEditorMount}
            editorTheme={editorTheme}
            fontSize={editorPrefs.fontSize}
            lineSpacing={editorPrefs.lineSpacing}
            fontFamily={editorPrefs.fontFamily}
          />
        ) : viewMode === 'draft' ? (
          <ContentEditor
            key="view-draft"
            value={activeTab.draftContent ?? ''}
            onChange={v => handleDraftChange(activeTab.id, v)}
            onMount={handleEditorMount}
            editorTheme={editorTheme}
            fontSize={editorPrefs.fontSize}
            lineSpacing={editorPrefs.lineSpacing}
            fontFamily={editorPrefs.fontFamily}
          />
        ) : viewMode === 'outline' ? (
          <ContentEditor
            key="view-outline"
            value={activeTab.outlineContent ?? ''}
            onChange={() => {}}
            onMount={handleEditorMount}
            editorTheme={editorTheme}
            fontSize={editorPrefs.fontSize}
            lineSpacing={editorPrefs.lineSpacing}
            fontFamily={editorPrefs.fontFamily}
            readOnly
          />
        ) : viewMode === 'content' ? (
          <ContentEditor
            key="view-content"
            value={activeTab.content ?? ''}
            onChange={v => handleEditorChange(activeTab.id, v)}
            onMount={handleEditorMount}
            editorTheme={editorTheme}
            fontSize={editorPrefs.fontSize}
            lineSpacing={editorPrefs.lineSpacing}
            fontFamily={editorPrefs.fontFamily}
          />
        ) : (
          <OutlineViewer content={activeTab.outlineContent ?? ''} />
        )}
        </div>
        {showReference && (
          <ReferenceDrawer novelId={novelId} onClose={() => setShowReference(false)} />
        )}
        {historyTarget && (
          <HistoryPanel
            novelId={novelId}
            relPath={historyTarget}
            allowRestore={viewMode !== 'outline'}
            onClose={() => setHistoryTarget(null)}
            onRestored={() => {
              // 恢复后刷新当前视图内容
              const tab = tabs.find(t => t.id === activeTabId)
              if (!tab || tab.type !== 'file') return
              const isChapter = isContentPath(tab.path) && tab.path !== 'platinum.md'
              const num = isChapter ? parseInt(tab.path.replace(/.*\//, '').replace('.md', '')) : 0
              if (viewMode === 'content') {
                app.GetContent(novelId, tab.path).then(c => updateTab(tab.id, { content: c ?? '' })).catch(() => {})
              } else if (viewMode === 'draft' && num) {
                app.GetContent(novelId, draftPath(num)).then(dc => updateTab(tab.id, { draftContent: dc || '' })).catch(() => {})
              } else if (viewMode === 'userOutline' && num) {
                app.GetContent(novelId, userOutlinePath(num)).then(uc => updateTab(tab.id, { userOutlineContent: uc || '' })).catch(() => {})
              }
            }}
          />
        )}
      </div>
    </main>
  )
})

export default ContentPanel

import { useState, useCallback, useEffect, useRef } from 'react'
import type { EditorTab } from '@/components/content/types'

let idSeq = 0
function nextId(prefix: string) { return `${prefix}_${++idSeq}` }

export function useEditorTabs(novelId: number) {
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const prevNovelIdRef = useRef(novelId)
  const initRef = useRef(false)
  const activeTabIdRef = useRef(activeTabId)
  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])

  // 注：标签页不做跨会话 localStorage 恢复。
  // 原因：goink_tabs_all 只按 novelId 存，未区分数据目录；换目录后 novelId 撞车会把
  // 旧目录/旧书的标签页带到新书里（用户反馈"打开新书出现老书标签页"）。
  // 标签页现在为会话级：每次启动为空，切书清空，避免任何串台。
  useEffect(() => { initRef.current = true }, [])

  // novelId 变化：切书时清空标签集
  useEffect(() => {
    if (!initRef.current) return
    const oldKey = String(prevNovelIdRef.current)
    const newKey = String(novelId)
    if (oldKey === newKey) return
    prevNovelIdRef.current = novelId
    setTabs([])
    setActiveTabId(null)
  }, [novelId])

  const activeTab = tabs.find(t => t.id === activeTabId) ?? null

  const openTab = useCallback((tab: Omit<EditorTab, 'id'> & { id?: string }) => {
    const id = tab.id ?? nextId(tab.type)
    setTabs(prev => {
      const existing = prev.find(t => t.path === tab.path && t.type === tab.type)
      if (existing) { setActiveTabId(existing.id); return prev }
      return [...prev, { ...tab, id }]
    })
    setActiveTabId(id)
  }, [])

  const closeAllTabs = useCallback(() => {
    setTabs([])
    setActiveTabId(null)
  }, [])

  const closeOtherTabs = useCallback((keepId: string) => {
    setTabs(prev => prev.filter(t => t.id === keepId))
    setActiveTabId(keepId)
  }, [])

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      if (prev.length <= 1) {
        setActiveTabId(null)
        return []
      }
      const idx = prev.findIndex(t => t.id === id)
      const next = prev.filter(t => t.id !== id)
      if (activeTabIdRef.current === id) {
        const newIdx = Math.min(idx, next.length - 1)
        setActiveTabId(next[newIdx].id)
      }
      return next
    })
  }, [])

  const updateTab = useCallback((id: string, patch: Partial<EditorTab>) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
  }, [])

  const openDiffTab = useCallback((data: {
    path: string; title: string; diff: string; original: string; modified: string
    changeType: string; reason: string; toolId: string
  }) => {
    const id = nextId('diff')
    setTabs(prev => [...prev, { id, type: 'diff', ...data }])
    setActiveTabId(id)
    return id
  }, [])

  return {
    tabs, activeTab, activeTabId,
    openTab, closeTab, closeAllTabs, closeOtherTabs, setActiveTabId,
    updateTab, openDiffTab,
    initRef,
  }
}

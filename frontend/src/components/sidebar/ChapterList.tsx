import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, FileText, Pencil, Download, Trash2, ScanSearch, Settings2, Layers, GripVertical, Zap } from 'lucide-react'
import { toastError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useApp } from '@/hooks/useApp'
import type { chapter, novel } from '@/hooks/useApp'
import type { git } from '@/lib/wailsjs/go/models'
import { EventsOn } from '@/lib/wailsjs/runtime/runtime'

interface Props {
  novelId: number
  target: { path: string; title: string } | null
  onSelectChapter: (ch: chapter.Chapter, viewMode?: string) => void
  onSelectGoink: () => void
  onEditNovelSettings?: () => void
  onEditAISettings?: () => void
  onExportNovel: () => void
  onDeleteChapter?: (novelId: number, chapterNumber: number) => void
  onMaintainChanges?: (files: git.FileChange[], parts: string[]) => void
}

const BLOCK_SIZE = 100

function pad(n: number): string { return String(n).padStart(3, '0') }

export default function ChapterList({ novelId, target, onSelectChapter, onSelectGoink, onEditNovelSettings, onEditAISettings, onExportNovel, onDeleteChapter, onMaintainChanges }: Props) {
  const { t } = useTranslation()
  const app = useApp()

  const [chapters, setChapters] = useState<chapter.Chapter[]>([])
  const [volumes, setVolumes] = useState<novel.Volume[]>([])
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set())
  const [collapsedVolumes, setCollapsedVolumes] = useState<Set<number>>(new Set())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [loadError, setLoadError] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [fileChanges, setFileChanges] = useState<git.FileChange[] | null>(null)
  const [pendingChanges, setPendingChanges] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [chapterViewMode, setChapterViewMode] = useState<'content' | 'outline' | 'userOutline' | 'draft'>('content')
  const [maintainParts, setMaintainParts] = useState<string[]>([
    'outline', 'character', 'timeline', 'reader', 'arc', 'platinum',
  ])
  // ── 拖拽（章节/卷）──────
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragVolume, setDragVolume] = useState<number | null>(null)
  const [ctxChapter, setCtxChapter] = useState<chapter.Chapter | null>(null)
  // 多选（Ctrl+点击；拖拽时整组移动）
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const rangeAnchorRef = useRef<number | null>(null)
  // 拖拽插入指示（DOM 级，避免 dragover 高频 setState）
  const chapterRowRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const volumeHeaderRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const volumeBodyRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const dragTargetRef = useRef<{ kind: 'chapter' | 'volume'; id: number; after: boolean } | null>(null)
  const lastHoverElRef = useRef<HTMLDivElement | null>(null)
  // 拖拽开始时就固化的拖拽章节集（防止拖拽过程中多选被 click 清空）
  const dragSetRef = useRef<number[]>([])

  const MAINTAIN_PART_KEYS: { id: string; labelKey: string }[] = [
    { id: 'outline', labelKey: 'sidebar.maintainPartOutline' },
    { id: 'character', labelKey: 'sidebar.maintainPartCharacter' },
    { id: 'timeline', labelKey: 'sidebar.maintainPartTimeline' },
    { id: 'reader', labelKey: 'sidebar.maintainPartReader' },
    { id: 'arc', labelKey: 'sidebar.maintainPartArc' },
    { id: 'platinum', labelKey: 'sidebar.maintainPartPlatinum' },
  ]

  const loadChapters = useCallback(async () => {
    if (!novelId) { setChapters([]); return }
    try {
      const list = await app.GetChapters(novelId)
      setChapters(list ?? [])
      setLoadError('')
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [novelId, app])

  const loadVolumes = useCallback(async () => {
    if (!novelId) { setVolumes([]); return }
    try {
      setVolumes((await app.GetVolumes(novelId)) ?? [])
    } catch { /* ignore */ }
  }, [novelId, app])

  useEffect(() => { loadChapters(); loadVolumes() }, [loadChapters, loadVolumes])

  // 松开修饰键（Ctrl/Shift）= 选择完成 → 固化拖拽集（拖动时无需再按任何键）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'Control' || e.key === 'Shift' || e.key === 'Meta') && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        if (selectedIds.size > 1) {
          dragSetRef.current = [...selectedIds]
          app.LogFrontend('keyup lock [' + [...selectedIds].join(',') + ']').catch(() => {})
        }
      }
    }
    document.addEventListener('keyup', handler)
    return () => document.removeEventListener('keyup', handler)
  }, [selectedIds, app])

  useEffect(() => {
    const unsub = EventsOn('file:changed', (data: any) => {
      if (data.novel_id !== novelId) return
      if (data.path && (data.path.startsWith('chapters/') || data.path.startsWith('outlines/') || data.path.startsWith('user_outlines/') || data.path === 'platinum.md')) {
        setPendingChanges(true)
        loadChapters()
      }
    })
    return () => unsub()
  }, [novelId, loadChapters])

  // ── 卷内章节（按 sort_order 升序）────────────────────────

  const chaptersByVolume = useMemo(() => {
    const byVol = new Map<number, chapter.Chapter[]>()
    for (const ch of chapters) {
      const v = ch.volume || 1
      if (!byVol.has(v)) byVol.set(v, [])
      byVol.get(v)!.push(ch)
    }
    for (const list of byVol.values()) list.sort((a, b) => (a.sort_order ?? a.chapter_number) - (b.sort_order ?? b.chapter_number))
    return byVol
  }, [chapters])

  // 卷内分块（性能保护）
  function blocksFor(list: chapter.Chapter[]) {
    const blocks: { key: string; start: number; end: number; chs: chapter.Chapter[] }[] = []
    for (let i = 0; i < list.length; i += BLOCK_SIZE) {
      const slice = list.slice(i, Math.min(i + BLOCK_SIZE, list.length))
      blocks.push({
        key: `${slice[0].volume}-${i / BLOCK_SIZE}`,
        start: slice[0].chapter_number,
        end: slice[slice.length - 1].chapter_number,
        chs: slice,
      })
    }
    return blocks
  }

  function toggleBlock(key: string) {
    setExpandedBlocks(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleVolume(v: number) {
    setCollapsedVolumes(prev => {
      const next = new Set(prev)
      if (next.has(v)) next.delete(v)
      else next.add(v)
      return next
    })
  }

  async function handleCreateVolume() {
    try {
      const vols = [...volumes, { name: t('sidebar.volumeDefaultName', { n: volumes.length + 1 }) }]
      await app.SaveVolumes(novelId, vols)
      loadVolumes()
    } catch (err) {
      toastError(String(err))
    }
  }

  // 在指定卷新建章节（点击即建，标题默认文件号）
  async function handleCreateChapterInVolume(v: number) {
    try {
      await app.CreateChapter({ novel_id: novelId, title: '', volume: v })
      loadChapters()
    } catch (err) {
      toastError(String(err))
    }
  }

  async function handleRenameVolume(v: number) {
    const vols = volumes
    const cur = vols[v - 1]?.name ?? ''
    const name = prompt(t('sidebar.volumeNamePlaceholder'), cur)
    if (!name || !name.trim() || name === cur) return
    try {
      await app.RenameVolume(novelId, v, name.trim())
      loadVolumes()
    } catch (err) {
      toastError(String(err))
    }
  }

  async function handleDeleteVolume(v: number) {
    if (volumes.length <= 1) {
      alert(t('sidebar.cannotDeleteLastVolume'))
      return
    }
    if (!confirm(t('sidebar.deleteVolumeConfirm'))) return
    try {
      await app.DeleteVolume(novelId, v)
      loadVolumes()
      loadChapters()
    } catch (err) {
      toastError(String(err))
    }
  }

  // ── 卷头 drop：卷拖拽→卷排序；章节拖拽→移动到该卷末尾 ──
  async function handleDropOnVolumeHeader(targetVol: number, e: React.DragEvent) {
    e.preventDefault()
    // 章节拖到卷头：归入该卷末尾（跨卷移动；用固化拖拽集支持整组）
    if (dragId != null) {
      try {
        const src = chapters.find(c => c.id === dragId)
        const ids = dragSetRef.current.length > 0 ? dragSetRef.current : (src ? dragSet(src) : [dragId])
        await moveChapters(ids, targetVol, endOfVolumeOrder(targetVol))
      } catch (err) {
        toastError(String(err))
      } finally {
        setDragId(null)
      }
      return
    }
    // 卷拖拽：按蓝线位置（dragTargetRef 的 after）调整卷顺序
    if (dragVolume == null || dragVolume === targetVol) { setDragVolume(null); return }
    const tgt = dragTargetRef.current
    const after = tgt && tgt.kind === 'volume' && tgt.id === targetVol ? tgt.after : true
    try {
      const vols = [...volumes]
      const from = dragVolume - 1
      let to = targetVol - 1
      const arr = vols.map((_, i) => i + 1)
      const [moved] = arr.splice(from, 1)
      if (to > from) to -= 1 // 移除后目标位置修正
      arr.splice(after ? to + 1 : to, 0, moved)
      await app.ReorderVolumes(novelId, arr)
      await loadVolumes()
      await loadChapters()
    } catch (err) {
      toastError(String(err))
    } finally {
      setDragVolume(null)
    }
  }

  // ── 拖拽调序（编号不变，只改 sort_order / volume）──────

  // 计算拖拽集合：若被拖章节在多选组内 → 整组；否则单章
  function dragSet(ch: chapter.Chapter): number[] {
    if (selectedIds.has(ch.id) && selectedIds.size > 1) {
      return [...selectedIds]
    }
    return [ch.id]
  }

  function clearDragIndicator() {
    const el = lastHoverElRef.current
    if (el) {
      el.classList.remove('drag-indicator-before', 'drag-indicator-after', 'drag-volume-hover')
      lastHoverElRef.current = null
    }
    dragTargetRef.current = null
    volumeHeaderRefs.current.forEach(h => h.classList.remove('drag-volume-hover', 'drag-indicator-before', 'drag-indicator-after', 'drag-vol-before', 'drag-vol-after'))
    volumeBodyRefs.current.forEach(h => h.classList.remove('drag-volume-hover'))
  }

  // 卷头 dragover：卷拖拽 → 插入线指示；章节拖拽 → 卷框淡蓝高亮
  function handleDragOverVolumeHeader(v: number, e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation() // 阻止冒泡到卷体
    const el = volumeHeaderRefs.current.get(v)
    if (!el) return
    if (dragVolume != null) {
      // 卷拖拽：按鼠标上下半显示插入线
      const rect = el.getBoundingClientRect()
      const after = e.clientY > rect.top + rect.height / 2
      const prev = lastHoverElRef.current
      const prevTarget = dragTargetRef.current
      if (prev && prev !== el) {
        prev.classList.remove('drag-indicator-before', 'drag-indicator-after', 'drag-volume-hover', 'drag-vol-before', 'drag-vol-after')
      }
      if (prevTarget && prevTarget.kind === 'volume' && prevTarget.id === v && prevTarget.after === after) {
        return
      }
      el.classList.remove('drag-indicator-before', 'drag-indicator-after', 'drag-vol-before', 'drag-vol-after')
      el.classList.add(after ? 'drag-vol-after' : 'drag-vol-before')
      lastHoverElRef.current = el
      dragTargetRef.current = { kind: 'volume', id: v, after }
      return
    }
    if (dragId != null) {
      // 章节拖拽：卷框淡蓝高亮
      const prev = lastHoverElRef.current
      if (prev && prev !== el) {
        prev.classList.remove('drag-indicator-before', 'drag-indicator-after', 'drag-volume-hover')
      }
      el.classList.add('drag-volume-hover')
      lastHoverElRef.current = el
      dragTargetRef.current = null
    }
  }

  // 章节行 dragover：按鼠标位置计算插入点（行上半=前、下半=后），用 DOM class 显示指示线
  // 章节行 dragover：仅允许 drop，让事件冒泡到列表容器（统一按最近边界画插入线）
  function handleDragOverChapter(_ch: chapter.Chapter, e: React.DragEvent) {
    e.preventDefault()
  }

  // 列表容器 dragover：章节拖拽时按鼠标 Y 找最近的行边界，精确决定插入位置并显示指示线
  function handleDragOverList(e: React.DragEvent) {
    e.preventDefault()
    if (dragId == null) return
    let best: { id: number; after: boolean } | null = null
    let bestDist = Infinity
    for (const [id, el] of chapterRowRefs.current) {
      const r = el.getBoundingClientRect()
      const dTop = Math.abs(e.clientY - r.top)
      const dBottom = Math.abs(e.clientY - r.bottom)
      if (dTop < bestDist) { bestDist = dTop; best = { id, after: false } }
      if (dBottom < bestDist) { bestDist = dBottom; best = { id, after: true } }
    }
    if (!best) return
    const el = chapterRowRefs.current.get(best.id)
    if (!el) return
    const prev = lastHoverElRef.current
    const prevTarget = dragTargetRef.current
    if (prev && prev !== el) {
      prev.classList.remove('drag-indicator-before', 'drag-indicator-after')
    }
    if (prevTarget && prevTarget.kind === 'chapter' && prevTarget.id === best.id && prevTarget.after === best.after) {
      return
    }
    el.classList.remove('drag-indicator-before', 'drag-indicator-after')
    el.classList.add(best.after ? 'drag-indicator-after' : 'drag-indicator-before')
    lastHoverElRef.current = el
    dragTargetRef.current = { kind: 'chapter', id: best.id, after: best.after }
  }

  // 计算插入间隙的分数基准：after=true → (目标章, 下一章) 中间；after=false → (上一章, 目标章) 中间
  function computeBaseOrder(target: chapter.Chapter, after: boolean): number {
    const volChs = chapters
      .filter(c => (c.volume || 1) === (target.volume || 1))
      .sort((a, b) => (a.sort_order ?? a.chapter_number) - (b.sort_order ?? b.chapter_number))
    const idx = volChs.findIndex(c => c.id === target.id)
    const order = target.sort_order ?? target.chapter_number
    if (after) {
      const next = volChs[idx + 1]
      return next ? (order + (next.sort_order ?? next.chapter_number)) / 2 : order + 1
    }
    const prev = volChs[idx - 1]
    return prev ? ((prev.sort_order ?? prev.chapter_number) + order) / 2 : order / 2
  }

  // 卷末尾基准 = 该卷最大序号 + 1
  function endOfVolumeOrder(v: number): number {
    let max = 0
    for (const c of chapters) {
      if ((c.volume || 1) === v) {
        max = Math.max(max, c.sort_order ?? c.chapter_number)
      }
    }
    return max + 1
  }

  async function moveChapters(ids: number[], targetVolume: number, targetOrder: number) {
    try {
      if (ids.length > 1) {
        await app.ReorderChaptersBatch(novelId, ids, targetVolume, targetOrder)
      } else {
        await app.ReorderChapter(novelId, ids[0], targetVolume, targetOrder)
      }
      await app.RecomputePrevChapters(novelId)
      loadChapters()
    } catch (err) {
      toastError(String(err))
    } finally {
      setDragId(null)
      setDragVolume(null)
    }
  }

  async function handleDropOnChapter(target: chapter.Chapter, e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (dragId == null || dragId === target.id) { setDragId(null); return }
    const src = chapters.find(c => c.id === dragId)
    if (!src) { setDragId(null); return }
    // 一律以蓝条位置（dragTargetRef，容器按最近边界算的插入点）为准，与鼠标落在哪一行无关
    const tgt = dragTargetRef.current
    let anchor = target
    let after = true
    if (tgt && tgt.kind === 'chapter') {
      const a = chapters.find(c => c.id === tgt.id)
      if (a) { anchor = a; after = tgt.after }
    }
    const base = computeBaseOrder(anchor, after)
    clearDragIndicator()
    try {
      await moveChapters(dragSetRef.current.length > 0 ? dragSetRef.current : dragSet(src), anchor.volume || 1, base)
    } catch (err) {
      toastError(String(err))
    } finally {
      setDragId(null)
    }
  }

  // ── 卷体 drop：章节拖到卷内任意区域（含折叠/空白）→ 该卷末尾 ──
  function handleDragOverVolumeBody(_v: number, e: React.DragEvent) {
    // 只允许 drop（卷内空白=该卷末尾），不做高亮、不清插入目标（视觉反馈只在卷头框）
    e.preventDefault()
  }

  async function handleDropOnVolumeBody(targetVol: number, e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (dragId == null) { setDragId(null); return }
    const src = chapters.find(c => c.id === dragId)
    if (!src) { setDragId(null); return }
    await moveChapters(dragSetRef.current.length > 0 ? dragSetRef.current : dragSet(src), targetVol, endOfVolumeOrder(targetVol))
  }

  // ── 右键菜单：移动到卷 ──────────────────────────────────

  async function handleMoveToVolume(v: number) {
    if (!ctxChapter) return
    try {
      await app.ReorderChapter(novelId, ctxChapter.id, v, endOfVolumeOrder(v))
      await app.RecomputePrevChapters(novelId)
      loadChapters()
    } catch (err) {
      toastError(String(err))
    } finally {
      setCtxChapter(null)
    }
  }

  function startEdit(ch: chapter.Chapter) {
    setEditingId(ch.id)
    setEditTitle(ch.title)
  }

  async function commitEdit() {
    if (editingId == null) return
    const ch = chapters.find(c => c.id === editingId)
    if (!ch) return
    const newTitle = editTitle.trim()
    if (newTitle && newTitle !== ch.title) {
      try {
        await app.UpdateChapterTitle(novelId, ch.chapter_number, newTitle)
        loadChapters()
      } catch (err) {
        toastError(t('common.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
        console.error(err)
      }
    }
    setEditingId(null)
  }

  function cancelEdit() { setEditingId(null) }

  async function handleDetectChanges() {
    if (!novelId) return
    setPendingChanges(false)
    setDetecting(true)
    try {
      const changes = await app.GetChangedFiles(novelId)
      setFileChanges(changes ?? [])
    } catch (err) {
      toastError(t('sidebar.detectFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      console.error(err)
      setFileChanges([])
    } finally {
      setDetecting(false)
    }
  }

  async function handleDelete(ch: chapter.Chapter) {
    if (!confirm(t('sidebar.confirmDeleteChapter', { title: ch.title }))) return
    try {
      await app.DeleteChapter({ novel_id: novelId, chapter_number: ch.chapter_number })
      onDeleteChapter?.(novelId, ch.chapter_number)
      loadChapters()
    } catch (err) {
      toastError(t('sidebar.chapterDeleteFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      console.error(err)
    }
  }

  function renderChapterRow(ch: chapter.Chapter) {
    const isActive = target?.path === ch.file_path
    const isSelected = selectedIds.has(ch.id)
    return (
      <div
        key={ch.id}
        ref={el => { if (el) chapterRowRefs.current.set(ch.id, el); else chapterRowRefs.current.delete(ch.id) }}
        className={`group flex items-center w-full relative ${isSelected ? 'bg-primary/10' : ''}`}
        draggable
        onMouseDown={e => {
          if (!e.ctrlKey && !e.metaKey && !e.shiftKey && selectedIds.has(ch.id) && selectedIds.size > 1) {
            dragSetRef.current = [...selectedIds]
            app.LogFrontend('mousedown lock [' + [...selectedIds].join(',') + ']').catch(() => {})
          }
        }}
        onDragStart={e => {
          e.dataTransfer.setData('text/plain', String(ch.id))
          e.dataTransfer.effectAllowed = 'move'
          setDragId(ch.id)
          if (dragSetRef.current.length === 0) {
            dragSetRef.current = dragSet(ch) // 未固化时（无多选）单章
          }
        }}
        onDragOver={e => handleDragOverChapter(ch, e)}
        onDrop={e => handleDropOnChapter(ch, e)}
        onDragEnd={() => { clearDragIndicator(); dragSetRef.current = [] }}
        onContextMenu={e => { e.preventDefault(); setCtxChapter(ch) }}
      >
        <button
          onClick={e => {
            e.stopPropagation() // 阻止冒泡到容器（空白解锁逻辑），保证选择不被清空
            if (e.ctrlKey || e.metaKey) {
              // Ctrl+点击：切换单章多选
              setSelectedIds(prev => {
                const next = new Set(prev)
                if (next.has(ch.id)) next.delete(ch.id)
                else next.add(ch.id)
                return next
              })
              rangeAnchorRef.current = ch.id
              return
            }
            if (e.shiftKey) {
              // Shift+点击：从锚点到当前章的范围选择（限定同一卷内，避免跨卷误选）
              const anchor = rangeAnchorRef.current
              const anchorCh = chapters.find(c => c.id === anchor)
              if (anchorCh && anchorCh.volume === ch.volume) {
                const ordered = chapters
                  .filter(c => (c.volume || 1) === (ch.volume || 1))
                  .sort((a, b) => (a.sort_order ?? a.chapter_number) - (b.sort_order ?? b.chapter_number))
                const ai = ordered.findIndex(c => c.id === anchor)
                const bi = ordered.findIndex(c => c.id === ch.id)
                if (ai >= 0 && bi >= 0) {
                  const [lo, hi] = ai < bi ? [ai, bi] : [bi, ai]
                  setSelectedIds(prev => {
                    const next = new Set(prev)
                    for (let i = lo; i <= hi; i++) next.add(ordered[i].id)
                    return next
                  })
                }
              }
              rangeAnchorRef.current = ch.id
              return
            }
            // 普通点击：打开章节 + 该章成为锁定列表唯一成员（单选变蓝）
            setSelectedIds(new Set([ch.id]))
            dragSetRef.current = []
            rangeAnchorRef.current = ch.id
            onSelectChapter(ch, chapterViewMode)
            app.SetCurrentChapter(novelId, ch.chapter_number).catch(() => {})
          }}
          className={`flex items-center gap-2.5 pl-5 pr-2 py-1.5 text-left hover:bg-muted/50 transition-colors flex-1 min-w-0
            ${isActive ? 'bg-primary/10 font-medium' : ''}`}
        >
          {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />}
          <GripVertical className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/70 shrink-0" />
          <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap tabular-nums w-8">
            {pad(ch.chapter_number)}
          </span>
          {editingId === ch.id ? (
            <input
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
              autoFocus
              className="flex-1 min-w-0 h-6 rounded border bg-background px-1 text-xs focus-visible:outline-none"
            />
          ) : (
            <span className="flex-1 truncate text-xs">{ch.title}</span>
          )}
        </button>
        <div className="flex items-center gap-0.5 pr-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={() => startEdit(ch)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={t('sidebar.rename')}>
            <Pencil className="w-3 h-3" />
          </button>
          <button onClick={() => handleDelete(ch)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={t('sidebar.delete')}>
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* 顶部操作按钮（检测/导出/新建卷/新建章）：稀疏大字号平均分布 */}
      <div className="px-3 py-2 border-b">
        <div className="flex items-center gap-1">
          {[
            { icon: <ScanSearch className="w-4 h-4" />, label: t('sidebar.detectChanges'), onClick: handleDetectChanges, badge: pendingChanges },
            { icon: <Download className="w-4 h-4" />, label: t('sidebar.export'), onClick: onExportNovel },
            { icon: <Layers className="w-4 h-4" />, label: t('sidebar.newVolume'), onClick: handleCreateVolume },
          ].map((b, i) => (
            <button
              key={i}
              onClick={b.onClick}
              className="relative flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-md hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
              title={b.label}
            >
              {b.icon}
              <span className="text-[10px] leading-none">{b.label}</span>
              {(b as any).badge && <span className="absolute top-0.5 right-1.5 w-2 h-2 rounded-full bg-destructive" />}
            </button>
          ))}
        </div>
      </div>

      {/* 章节打开视图选择（全局默认：新打开的章节用此视图；点击时当前章节立即切换） */}
      <div className="px-3 pt-1.5 pb-1 border-b bg-muted/20">
        <div className="flex items-center gap-0.5">
          {([
            { id: 'content', label: t('content.body') },
            { id: 'draft', label: t('content.draft') },
            { id: 'userOutline', label: t('content.userOutline') },
            { id: 'outline', label: t('content.bodyOutline') },
          ] as const).map(v => (
            <button
              key={v.id}
              onClick={() => {
                setChapterViewMode(v.id)
                // 若当前正打开某章，立即以新视图重开，右侧同步切换
                if (target?.path?.startsWith('chapters/')) {
                  const num = parseInt(target.path.replace('chapters/', '').replace('.md', ''))
                  const ch = chapters.find(c => c.chapter_number === num)
                  if (ch) onSelectChapter(ch, v.id)
                }
              }}
              className={`flex-1 px-2 py-1 text-[11px] rounded transition-colors ${
                chapterViewMode === v.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground/70 mt-1 px-0.5">{t('sidebar.viewModeGlobal')}</p>
      </div>

      {fileChanges !== null && (
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">
              {detecting ? t('sidebar.detecting') : t('sidebar.detectedChanges', { count: fileChanges.length })}
            </span>
            <button onClick={() => setFileChanges(null)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {t('sidebar.cancel')}
            </button>
          </div>
          {!detecting && fileChanges.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('sidebar.noChanges')}</p>
          ) : !detecting ? (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t('sidebar.maintainFiles')}</p>
                  <button
                    onClick={() => {
                      const all = fileChanges.map(f => f.path)
                      setSelectedFiles(prev => prev.length === all.length ? [] : all)
                    }}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {selectedFiles.length === fileChanges.length ? t('sidebar.selectNone') : t('sidebar.selectAll')}
                  </button>
                </div>
                <ul className="space-y-1 max-h-36 overflow-y-auto border rounded-md px-2 py-1.5">
                  {fileChanges.map(fc => (
                    <li key={fc.path} className="text-xs flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={selectedFiles.includes(fc.path)}
                        onChange={e => {
                          setSelectedFiles(prev =>
                            e.target.checked ? [...prev, fc.path] : prev.filter(p => p !== fc.path)
                          )
                        }}
                        className="accent-primary shrink-0"
                      />
                      <span className="shrink-0 w-6 text-right tabular-nums text-green-600">+{fc.insertions}</span>
                      <span className="shrink-0 w-6 text-right tabular-nums text-red-500">-{fc.deletions}</span>
                      <span className="truncate">{fc.path}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t('sidebar.maintainParts')}</p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setMaintainParts(MAINTAIN_PART_KEYS.map(p => p.id))} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                      {t('sidebar.selectAll')}
                    </button>
                    <button onClick={() => setMaintainParts([])} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                      {t('sidebar.selectNone')}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-1">
                  {MAINTAIN_PART_KEYS.map(p => (
                    <label key={p.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={maintainParts.includes(p.id)}
                        onChange={e => {
                          setMaintainParts(prev => e.target.checked ? [...prev, p.id] : prev.filter(x => x !== p.id))
                        }}
                        className="accent-primary"
                      />
                      {t(p.labelKey)}
                    </label>
                  ))}
                </div>
              </div>
              <Button
                size="sm"
                className="w-full"
                disabled={selectedFiles.length === 0 || maintainParts.length === 0}
                onClick={() => {
                  onMaintainChanges?.(fileChanges.filter(f => selectedFiles.includes(f.path)), maintainParts)
                  setFileChanges(null)
                  setPendingChanges(false)
                }}
              >
                {t('sidebar.giveToAI')}
              </Button>
            </>
          ) : null}
        </div>
      )}

      <button
        onClick={onEditNovelSettings}
        className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-muted/50 transition-colors relative border-b border-border/50`}
      >
        <Settings2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="flex-1 text-sm truncate">{t('sidebar.novelSettings')}</span>
      </button>

      <button
        onClick={onEditAISettings}
        className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-muted/50 transition-colors relative border-b border-border/50`}
      >
        <Zap className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="flex-1 text-sm truncate">{t('sidebar.aiSettings')}</span>
      </button>

      <button
        onClick={onSelectGoink}
        className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-muted/50 transition-colors relative border-b border-border/50
          ${target?.path === 'platinum.md' ? 'bg-primary/10 font-medium' : ''}`}
      >
        {target?.path === 'platinum.md' && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />
        )}
        <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="flex-1 text-sm truncate">{t('sidebar.storyStatus')}</span>
      </button>

      {/* 卷分组章节列表 */}
      <div
        className="flex-1 overflow-y-auto overscroll-contain"
        onDragOver={handleDragOverList}
        onClick={() => { setSelectedIds(new Set()); dragSetRef.current = [] }}
      >
        {chapters.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <FileText className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              {loadError ? (
                <>
                  <p className="text-xs text-destructive">{loadError}</p>
                  <button onClick={() => loadChapters()} className="text-xs text-primary underline mt-1">{t('common.retry')}</button>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">{t('sidebar.noChapters')}</p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">{t('sidebar.createFirstChapter')}</p>
                </>
              )}
            </div>
          </div>
        ) : (
          volumes.map((vol, vi) => {
            const vNum = vi + 1
            const list = chaptersByVolume.get(vNum) ?? []
            const collapsed = collapsedVolumes.has(vNum)
            return (
              <div
                key={vNum}
                ref={el => { if (el) volumeBodyRefs.current.set(vNum, el); else volumeBodyRefs.current.delete(vNum) }}
                onDragOver={e => handleDragOverVolumeBody(vNum, e)}
                onDrop={e => handleDropOnVolumeBody(vNum, e)}
              >
                {/* 卷头（可拖拽排序：拖到另一卷头调整卷顺序） */}
                <div
                  ref={el => { if (el) volumeHeaderRefs.current.set(vNum, el); else volumeHeaderRefs.current.delete(vNum) }}
                  className="flex items-center gap-1.5 px-3 py-3 border-b border-border/60 bg-muted/20 cursor-pointer select-none"
                  onClick={() => toggleVolume(vNum)}
                  draggable
                  onDragStart={e => { e.dataTransfer.setData('text/plain', String(vNum)); e.dataTransfer.effectAllowed = 'move'; setDragVolume(vNum) }}
                  onDragOver={e => handleDragOverVolumeHeader(vNum, e)}
                  onDrop={e => handleDropOnVolumeHeader(vNum, e)}
                  onDragEnd={() => { clearDragIndicator(); dragSetRef.current = [] }}
                  onContextMenu={e => { e.preventDefault(); setCtxChapter(null) }}
                >
                  <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`} />
                  <Layers className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-medium truncate">{vol.name}</span>
                  <span className="text-[10px] text-muted-foreground/60 ml-auto shrink-0">{list.length}</span>
                  <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    <button onClick={() => handleRenameVolume(vNum)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={t('sidebar.rename')}>
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button onClick={() => handleDeleteVolume(vNum)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={t('sidebar.delete')}>
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleCreateChapterInVolume(vNum)}
                      className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[11px] font-medium hover:bg-primary/20 transition-colors"
                      title={t('sidebar.newChapterInVolume')}
                    >
                      {t('sidebar.newChapter')}
                    </button>
                  </div>
                </div>
                {/* 卷内章节 */}
                {!collapsed && blocksFor(list).map(block => {
                  const isExpanded = expandedBlocks.has(block.key)
                  const range = block.start === block.end
                    ? t('sidebar.chapterN', { n: block.start })
                    : t('sidebar.chapterRange', { start: block.start, end: block.end })
                  return (
                    <div key={block.key}>
                      {list.length > BLOCK_SIZE && (
                        <button
                          onClick={() => toggleBlock(block.key)}
                          className="w-full flex items-center gap-1.5 pl-8 pr-3 py-1 text-left hover:bg-muted/30 transition-colors text-[11px] text-muted-foreground"
                        >
                          <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                          {range}
                        </button>
                      )}
                      {(isExpanded || list.length <= BLOCK_SIZE) && block.chs.map(renderChapterRow)}
                    </div>
                  )
                })}
                {/* 最下方卷：默认投放槽（卷折叠时在卷头下、展开时在最后一行章下） */}
                {vi === volumes.length - 1 && (
                  <div
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => handleDropOnVolumeBody(vNum, e)}
                    className="h-7 mx-2 my-1 rounded-md border border-dashed border-border/50 flex items-center justify-center text-[10px] text-muted-foreground/50 hover:border-primary/50 hover:text-primary/60 transition-colors"
                  >
                    {t('sidebar.dropToEnd')}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* 章节右键菜单：移动到卷 */}
      {ctxChapter && (
        <div
          className="fixed z-50 w-48 rounded-md border bg-background shadow-lg py-1"
          style={{ left: 60, top: 80 }}
          onMouseLeave={() => setCtxChapter(null)}
        >
          <div className="px-3 py-1 text-[10px] text-muted-foreground uppercase tracking-wider">{t('sidebar.moveToVolume')}</div>
          {volumes.map((vol, vi) => (
            <button
              key={vi + 1}
              onClick={() => handleMoveToVolume(vi + 1)}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
            >
              {vol.name}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

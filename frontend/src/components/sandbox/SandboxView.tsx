import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Circle, Square, Waves, Diamond, Triangle, Spline, Trash2, Save, MousePointer2, ExternalLink, Move, PlusCircle, BoxSelect, History, MoveRight, Sparkles, Loader2, Globe2, X, RotateCw, ArrowDownToLine, ArrowUpToLine, ChevronUp, ChevronDown, Undo2, Redo2 } from 'lucide-react'
import { useApp } from '@/hooks/useApp'
import { toastError, toastSuccess, toastInfo } from '@/lib/utils'

// ── 类型 ────────────────────────────────────────────────

type ShapeType = 'world' | 'circle' | 'rect' | 'wave' | 'arc' | 'arrow' | 'diamond' | 'triangle' | 'text' | 'drop' | 'person' | 'event'

interface SandboxShape {
  id: string
  type: ShapeType
  x: number
  y: number
  w: number
  h: number
  rotation: number
  fill: string
  fillOpacity: number
  stroke: string
  strokeWidth: number
  label: string
  textPos: 'top' | 'middle' | 'bottom' | 'left' | 'right'
  entityType: string
  entityId: number
  star: number
  curvature?: number // 弧线弧度：0=平直线，越大弧越弯（默认 0.5）；仅 arc 用
  flipped?: boolean // 水平镜像标记（前端渲染用，不进后端）
}

interface Props {
  novelId: number
  sandboxId: string
}

const SHAPE_TYPES: { type: ShapeType; icon: React.ReactNode; key: string }[] = [
  { type: 'world', icon: <Globe2 className="w-4 h-4" />, key: 'sandbox.shapeWorld' },
  { type: 'circle', icon: <Circle className="w-4 h-4" />, key: 'sandbox.shapeCircle' },
  { type: 'rect', icon: <Square className="w-4 h-4" />, key: 'sandbox.shapeRect' },
  { type: 'wave', icon: <Waves className="w-4 h-4" />, key: 'sandbox.shapeWave' },
  { type: 'arc', icon: <Spline className="w-4 h-4" />, key: 'sandbox.shapeArc' },
  { type: 'arrow', icon: <MoveRight className="w-4 h-4" />, key: 'sandbox.shapeArrow' },
  { type: 'diamond', icon: <Diamond className="w-4 h-4" />, key: 'sandbox.shapeDiamond' },
  { type: 'triangle', icon: <Triangle className="w-4 h-4" />, key: 'sandbox.shapeTriangle' },
]

const COLORS = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#b983ff', '#ff8fab', '#8d99ae', '#f9844a']

let idCounter = 0
function newId(): string { return `s${Date.now()}_${idCounter++}` }

// 形状路径（以左上角 (0,0) 为基准，宽 w 高 h）
function shapePath(type: ShapeType, w: number, h: number, shapeCurvature?: number): string {
  switch (type) {
    case 'circle':
      return '' // 用 <ellipse> 渲染
    case 'world':
      return '' // 专属渲染（井字地图）
    case 'rect':
      return ''
    case 'wave':
      // 波浪带：上下对称两条波浪（丝带形，不是底部直线封口）
      return `M0,${h * 0.35} Q${w * 0.25},${h * 0.1} ${w * 0.5},${h * 0.35} Q${w * 0.75},${h * 0.6} ${w},${h * 0.35} L${w},${h * 0.65} Q${w * 0.75},${h * 0.9} ${w * 0.5},${h * 0.65} Q${w * 0.25},${h * 0.4} 0,${h * 0.65} Z`
    case 'arc':
      // 半圆弧（二次贝塞尔）：起点 P0=(0,h)、终点 P2=(w,h)、控制点 C=(w/2, h*(1-curvature))
      // curvature 越大（越接近 1）控制点越靠上，弧度越大；0 时接近平直线
      {
        const c = (shapeCurvature ?? 0.5)
        const cy = h * Math.max(0.02, 1 - c)
        return `M0,${h} Q${w * 0.5},${cy} ${w},${h}`
      }
    case 'arrow':
      // 箭头朝右：横放矩形（2×0.8）+ 等边三角头（边长 1.2，顶点朝右，左边中点接矩形右缘中点）
      {
        const rectW = (w * 2) / (2 + 1.039) // 2 : 1.039（三角横向=边长*sin60）
        const rectH = h * 0.667 // 0.8/1.2
        const top = h / 2 - rectH / 2, bot = h / 2 + rectH / 2
        return `M0,${top} L${rectW},${top} L${rectW},${bot} L0,${bot} Z M${rectW},${h / 2 - h / 2} L${w},${h / 2} L${rectW},${h / 2 + h / 2} Z`
      }
    case 'diamond':
      return `M${w / 2},0 L${w},${h / 2} L${w / 2},${h} L0,${h / 2} Z`
    case 'triangle':
      return `M${w / 2},0 L${w},${h} L0,${h} Z`
    case 'text':
      return '' // 纯文字，无背景
    case 'drop':
    case 'person':
    case 'event':
      return '' // 专属渲染，不走通用 path
  }
}

// ── 主组件 ──────────────────────────────────────────────

export default function SandboxView({ novelId, sandboxId }: Props) {
  const { t } = useTranslation()
  const app = useApp()

  const [shapes, setShapes] = useState<SandboxShape[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()) // 多选集（框选）
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [tool, setTool] = useState<ShapeType | 'move' | 'select' | null>(null)
  const [viewX, setViewX] = useState(0)
  const [viewY, setViewY] = useState(0)
  const [scale, setScale] = useState(1)
  const [previewShape, setPreviewShape] = useState<SandboxShape | null>(null)
  const [editPopup, setEditPopup] = useState<{ id: string; x: number; y: number } | null>(null)
  const [histOpen, setHistOpen] = useState(false)
  const [histList, setHistList] = useState<{ name: string; mtime: string; size: number }[]>([])
  const [arrangeOpen, setArrangeOpen] = useState(false)
  const [arrangePrompt, setArrangePrompt] = useState('')
  const [arranging, setArranging] = useState(false)
  const [entityPickerOpen, setEntityPickerOpen] = useState(false)
  const [pickerTab, setPickerTab] = useState<'world' | 'character' | 'location' | 'timeline'>('world')
  const [worldList, setWorldList] = useState<{ id: number; name: string; desc: string }[]>([])
  const [charList, setCharList] = useState<{ id: number; name: string }[]>([])
  const [locList, setLocList] = useState<{ id: number; name: string }[]>([])
  const [timelineList, setTimelineList] = useState<{ id: number; title: string; star: number }[]>([])
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [dragMode, setDragMode] = useState<'move' | 'resize' | 'rotate' | 'pan' | 'draw' | 'marquee' | null>(null)
  const [dragData, setDragData] = useState<any>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const shapesRef = useRef<SandboxShape[]>([])
  shapesRef.current = shapes
  const [onboardOpen, setOnboardOpen] = useState(false)
  // 撤销/重做历史栈（快照数组，限制 50 步）
  const [undoStack, setUndoStack] = useState<SandboxShape[][]>([])
  const [redoStack, setRedoStack] = useState<SandboxShape[][]>([])
  // 扳机标记：手势中只记一次快照；文本编辑中不重复记
  const gestureActiveRef = useRef(false) // 拖拽手势进行中（move/resize/rotate）
  const gestureSnapshotRef = useRef(false) // 本次手势是否已记录快照
  const textEditRef = useRef(false)
  const colorEditRef = useRef(false) // 取色窗口打开中（点开时记一次，离开时结束）

  // 首次进入沙盘：弹引导窗（localStorage 标记，只看一次）
  useEffect(() => {
    if (!localStorage.getItem('sandbox_onboarded')) {
      setOnboardOpen(true)
      localStorage.setItem('sandbox_onboarded', '1')
    }
  }, [])

  // 反向定位：实体列表点击“定位到沙盘” → 选中沙盘上所有匹配实体（同名全选）+ 自动居中视口
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as { entityType?: string; entityId?: number; name?: string } | undefined
      if (!d) return
      // 匹配：entityType+entityId 相同；或按名称匹配（同名全选）
      const hits = shapes.filter(s => {
        const t = s.entityType || ''
        if (d.entityType && d.entityId) {
          return t === d.entityType && s.entityId === d.entityId
        }
        if (d.name) {
          return s.label === d.name
        }
        return false
      })
      if (hits.length === 0) return
      // 同名全选 + 高亮最近一个
      setSelectedIds(new Set(hits.map(s => s.id)))
      setSelectedId(hits[hits.length - 1].id)
      setPreviewShape(hits[hits.length - 1])
      setEditPopup(null)
      // 自动居中视口：让命中的图标移到视野中央；若太小则放大（约占视口 45% 宽）
      const rect = svgRef.current?.getBoundingClientRect()
      if (rect && rect.width > 0) {
        const target = hits[hits.length - 1]
        const cx = target.x + target.w / 2
        const cy = target.y + target.h / 2
        let ns = scale
        const screenW = target.w * scale
        if (screenW < rect.width * 0.25) {
          ns = Math.max(scale, (rect.width * 0.45) / Math.max(1, target.w))
        }
        setViewX(rect.width / 2 - cx * ns)
        setViewY(rect.height / 2 - cy * ns)
        if (ns !== scale) setScale(ns)
      }
    }
    window.addEventListener('entity:locate-sandbox', handler)
    return () => window.removeEventListener('entity:locate-sandbox', handler)
  }, [shapes, scale])

  const load = useCallback(async () => {
    if (!sandboxId) {
      setShapes([])
      setSelectedId(null)
      setSelectedIds(new Set())
      setPreviewShape(null)
      setDirty(false)
      return
    }
    try {
      const sv = await app.GetSandbox(novelId, sandboxId)
      setShapes((sv?.shapes ?? []) as unknown as SandboxShape[])
      setViewX(sv?.viewX ?? 0)
      setViewY(sv?.viewY ?? 0)
      setScale(sv?.scale && sv.scale > 0 ? sv.scale : 1)
      setSelectedId(null)
      setSelectedIds(new Set())
      setPreviewShape(null)
      setDirty(false)
    } catch (err) { toastError(String(err)) }
  }, [app, novelId, sandboxId])

  useEffect(() => { load() }, [load])

  // AI/MCP 工具写沙盘文件后自动刷新：轮询文件修改时间（避开自身编辑，仅外部改动触发）
  useEffect(() => {
    if (!sandboxId) return
    let lastMtime = 0
    const timer = setInterval(async () => {
      try {
        // 通过后端读文件 mtime（复用 ListSandboxHistory 的 UpdatedAt 不可靠，直接读沙盘）
        const list = await app.ListSandboxes(novelId)
        const cur = (list ?? []).find((s: any) => s.id === sandboxId)
        if (!cur) return
        const t = new Date(cur.updatedAt || 0).getTime()
        if (lastMtime === 0) { lastMtime = t; return }
        if (t > lastMtime) {
          // 若是自己刚保存（3 秒内）产生的 mtime 变化，跳过（避免自动保存重置选中/悬浮窗）
          if (Date.now() - selfSaveAtRef.current < 3000) {
            lastMtime = t
            return
          }
          // 扳机：AI/外部写入沙盘 → 记录当前快照（可撤销到 AI 修改前）
          setUndoStack(prev => [...prev, shapesRef.current].slice(-50))
          setRedoStack([])
          lastMtime = t
          await load()
        }
      } catch { /* 忽略轮询错误 */ }
    }, 3000)
    return () => clearInterval(timer)
  }, [sandboxId, novelId, app, load])

  // 自身保存时间戳 ref：区分“自己刚保存”（不该触发 load）与“外部改动”（该 load）
  const selfSaveAtRef = useRef(0)
  const doSave = useCallback(() => {
    if (!sandboxId) return Promise.resolve()
    return app.SaveSandbox(novelId, sandboxId, { shapes, viewX, viewY, scale } as any)
      .then(() => {
        selfSaveAtRef.current = Date.now()
        setDirty(false)
      })
  }, [app, novelId, sandboxId, shapes, viewX, viewY, scale])

  // 切换到其他界面时自动保存（WorkspaceView 切走时 dispatch sandbox:auto-save）
  useEffect(() => {
    const handler = () => {
      if (!sandboxId) return
      // 有未保存改动才保存
      doSave().catch(err => toastError(String(err)))
    }
    window.addEventListener('sandbox:auto-save', handler)
    return () => window.removeEventListener('sandbox:auto-save', handler)
  }, [sandboxId, doSave])
  // 应用关闭前强制保存（beforeunload）
  useEffect(() => {
    const handler = () => {
      if (!sandboxId || !dirty) return
      doSave().catch(() => {})
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [sandboxId, dirty, doSave])

  const persist = useCallback((next: SandboxShape[]) => {
    setDirty(true)
    // 撤销快照：扳机式记录——
    // 1) 拖拽手势中（move/resize/rotate）：只记录一次（手势开始状态），避免每帧压栈
    // 2) 文本编辑中（改名）：focus 时已记录一次，输入过程不再压栈
    // 3) 其他离散操作（新增/删除/图层/颜色等）：每次都记录
    if (gestureActiveRef.current) {
      // 手势中：仅第一次 persist 记录（手势开始时的状态）
      if (!gestureSnapshotRef.current) {
        setUndoStack(prev => [...prev, shapes].slice(-50))
        setRedoStack([])
        gestureSnapshotRef.current = true
      }
    } else if (!textEditRef.current && !colorEditRef.current) {
      // 非手势且非文本/取色编辑：离散操作，每次都记录
      setUndoStack(prev => [...prev, shapes].slice(-50))
      setRedoStack([])
    }
    setShapes(next)
  }, [shapes])

  // 自动保存兜底：操作停止 2 秒后自动落盘（关进程/切走时数据必已保存）
  useEffect(() => {
    if (!sandboxId || !dirty) return
    const t = setTimeout(() => {
      doSave().catch(err => toastError(String(err)))
    }, 2000)
    return () => clearTimeout(t)
  }, [dirty, sandboxId, doSave])

  async function handleSave() {
    if (!sandboxId) return
    setSaving(true)
    try {
      await doSave()
      toastSuccess(t('sandbox.saved'))
      window.dispatchEvent(new CustomEvent('sandbox:list-changed'))
    } catch (err) { toastError(String(err)) } finally { setSaving(false) }
  }

  // 打开实体选择器：加载小说设定/角色/地点/事件列表
  async function openEntityPicker() {
    setEntityPickerOpen(true)
    setPickerTab('world')
    try {
      const [settings, chars, locs, tls] = await Promise.all([
        app.ListSettings(novelId),
        app.GetCharacters(novelId),
        app.GetLocations(novelId),
        app.GetTimelineEntries(novelId, 1, 100),
      ])
      // 小说设定 = setting_items（世界设定条目，category 作名称）
      const sts = (settings ?? []) as any[]
      setWorldList(sts.map((s: any) => ({
        id: s.id,
        name: s.category || '未分类设定',
        desc: (s.content || '').slice(0, 60),
      })))
      setCharList((chars ?? []).map((c: any) => ({ id: c.id, name: c.name })))
      setLocList((locs ?? []).map((l: any) => ({ id: l.id, name: l.name })))
      setTimelineList((tls ?? []).map((t: any) => ({ id: t.id, title: t.title || '', star: t.importance || 0 })))
    } catch (err) { toastError(String(err)) }
  }

  // 把实体放入画布：按类型专用形状（井字地图/倒水滴/人头梯形/镂空问号）+ 关联实体
  function addEntity(type: 'world' | 'character' | 'location' | 'timeline', id: number, name: string, star = 0) {
    let shapeType: ShapeType
    let color: string
    let w = 120, h = 90
    if (type === 'world') {
      shapeType = 'world'; color = COLORS[3]; w = 640; h = 480 // 小说设定 = 大井字地图容器（关联 setting 实体）
    } else if (type === 'location') {
      shapeType = 'drop'; color = COLORS[3]
    } else if (type === 'character') {
      shapeType = 'person'; color = COLORS[0]
    } else {
      shapeType = 'event'; color = COLORS[1]
    }
    // 关联实体：world → setting（设定条目）；跳转设定页
    const entityType = type === 'world' ? 'setting' : type
    const s: SandboxShape = {
      id: newId(), type: shapeType,
      x: 160 + Math.random() * 200, y: 120 + Math.random() * 160,
      w, h, rotation: 0,
      fill: color, fillOpacity: 0.35,
      stroke: color, strokeWidth: 2,
      label: name, textPos: 'top' as const, entityType, entityId: id, star,
    }
    persist([...shapes, s])
    setSelectedId(s.id)
    setEntityPickerOpen(false)
  }

  // 打开历史：列出当前沙盘的历史版本
  async function openHistory() {
    if (!sandboxId) return
    setHistOpen(true)
    try {
      const list = await app.ListSandboxHistory(novelId, sandboxId)
      setHistList((list ?? []) as any[])
    } catch (err) { toastError(String(err)) }
  }

  // 恢复历史版本
  async function handleRestoreHistory(fileName: string) {
    if (!sandboxId) return
    if (!confirm(t('sandbox.restoreConfirm'))) return
    try {
      await app.RestoreSandboxHistory(novelId, sandboxId, fileName)
      setHistOpen(false)
      toastSuccess(t('sandbox.restored'))
      await load()
      window.dispatchEvent(new CustomEvent('sandbox:list-changed'))
    } catch (err) { toastError(String(err)) }
  }

  // AI 布局：根据设定生成/增量布局
  async function handleArrange() {
    if (!sandboxId) return
    setArranging(true)
    try {
      const settings = await app.GetSettings()
      let key = settings?.selected_model_key || ''
      if (!key) {
        const models = await app.GetModels()
        key = models?.[0]?.Key || ''
      }
      if (!key) {
        toastError(t('sandbox.arrangeNoModel'))
        return
      }
      const [providerName, modelID] = key.split('/')
      await app.ArrangeSandbox({
        novel_id: novelId,
        sandbox_id: sandboxId,
        prompt: arrangePrompt.trim(),
        provider_name: providerName || '',
        model_id: modelID || '',
      })
      setArrangeOpen(false)
      setArrangePrompt('')
      toastSuccess(t('sandbox.arranged'))
      await load()
      window.dispatchEvent(new CustomEvent('sandbox:list-changed'))
    } catch (err) {
      const msg = String(err)
      // 用户主动取消：静默提示，不报错
      if (msg.includes('cancel') || msg.includes('context canceled') || msg.includes('已取消')) {
        toastInfo(t('sandbox.arrangeCancelled'))
      } else {
        toastError(msg)
      }
    } finally {
      setArranging(false)
    }
  }

  // 取消 AI 布局（仅布局进行中时）
  async function handleCancelArrange() {
    try { await app.CancelArrange() } catch { /* ignore */ }
    setArranging(false)
    setArrangeOpen(false)
    toastInfo(t('sandbox.arrangeCancelled'))
  }

  // 点 X / 遮罩关闭弹窗：布局中时提示后台继续
  function closeArrangeDialog() {
    setArrangeOpen(false)
    if (arranging) {
      toastInfo(t('sandbox.arrangeBackgroundHint'))
    }
  }

  function deleteSelected() {
    if (!selectedId) return
    persist(shapes.filter(s => s.id !== selectedId))
    setSelectedId(null)
    setPreviewShape(null)
  }

  // 更新选中形状属性
  function updateSelected(patch: Partial<SandboxShape>) {
    if (!selectedId) return
    persist(shapes.map(s => s.id === selectedId ? { ...s, ...patch } : s))
  }

  // ── 撤销 / 重做 ───────────────────────────────────────

  function undo() {
    if (undoStack.length === 0) return
    const prev = undoStack[undoStack.length - 1]
    setRedoStack(rs => [...rs, shapes].slice(-50))
    setUndoStack(us => us.slice(0, -1))
    setShapes(prev)
    setDirty(true)
  }

  function redo() {
    if (redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    setUndoStack(us => [...us, shapes].slice(-50))
    setRedoStack(rs => rs.slice(0, -1))
    setShapes(next)
    setDirty(true)
  }

  // Delete 键：删除当前选中/悬浮窗形状
  function handleDeleteKey() {
    const target = selectedId || editPopup?.id
    if (!target) return
    persist(shapes.filter(s => s.id !== target))
    if (selectedId === target) setSelectedId(null)
    if (editPopup?.id === target) setEditPopup(null)
    setPreviewShape(null)
  }

  // 键盘监听：Ctrl+Z 撤回 / Ctrl+Y、Ctrl+Shift+Z 回退 / Delete 删除
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      // 输入框/文本域内不拦截（避免误触）
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault()
        redo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        handleDeleteKey()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }) // 每次渲染都重新绑定，闭包拿到最新 shapes/undoStack

  // ── 图层顺序（数组顺序=渲染顺序，后面的盖前面）──

  // 置入底层：移到数组开头
  function sendToBack(id?: string) {
    const target = id || selectedId
    if (!target) return
    const rest = shapes.filter(s => s.id !== target)
    const sel = shapes.find(s => s.id === target)!
    persist([sel, ...rest])
  }

  // 置入顶层：移到数组末尾
  function bringToFront(id?: string) {
    const target = id || selectedId
    if (!target) return
    const rest = shapes.filter(s => s.id !== target)
    const sel = shapes.find(s => s.id === target)!
    persist([...rest, sel])
  }

  // 两个形状包围盒是否重叠（含边）
  function overlaps(a: SandboxShape, b: SandboxShape): boolean {
    return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)
  }

  // 上移：跳到下一个与它重叠的图形之上（无重叠则置顶）
  // 层概念只对重叠图形有意义，避免非重叠图形一格一格挪
  function moveUp(id?: string) {
    const target = id || selectedId
    if (!target) return
    const idx = shapes.findIndex(s => s.id === target)
    if (idx < 0 || idx >= shapes.length - 1) return
    const sel = shapes[idx]
    const next = [...shapes]
    // 从当前往后找第一个与目标重叠的图形
    const hit = next.findIndex((s, i) => i > idx && overlaps(sel, s))
    if (hit < 0) {
      // 没有重叠：直接置顶（移到末尾）
      next.splice(idx, 1)
      next.push(sel)
    } else {
      // 插到该重叠图形之后（即盖在它上面）
      next.splice(idx, 1)
      const afterIdx = next.findIndex(s => s.id === shapes[hit].id)
      next.splice(afterIdx + 1, 0, sel)
    }
    persist(next)
  }

  // 下移：跳到上一个与它重叠的图形之下（无重叠则置底）
  function moveDown(id?: string) {
    const target = id || selectedId
    if (!target) return
    const idx = shapes.findIndex(s => s.id === target)
    if (idx <= 0) return
    const sel = shapes[idx]
    const next = [...shapes]
    // 从当前往前找第一个与目标重叠的图形
    let hit = -1
    for (let i = idx - 1; i >= 0; i--) {
      if (overlaps(sel, shapes[i])) { hit = i; break }
    }
    if (hit < 0) {
      // 没有重叠：直接置底（移到开头）
      next.splice(idx, 1)
      next.unshift(sel)
    } else {
      // 插到该重叠图形之前（即垫在它下面）
      next.splice(idx, 1)
      const beforeIdx = next.findIndex(s => s.id === shapes[hit].id)
      next.splice(beforeIdx, 0, sel)
    }
    persist(next)
  }

  // 旋转 90°（顺时针，累加）
  function rotate90(id?: string) {
    const target = id || selectedId
    if (!target) return
    const sel = shapes.find(s => s.id === target)!
    const base = ((sel.rotation || 0) % 360 + 360) % 360
    persist(shapes.map(s => s.id === target ? { ...s, rotation: base + 90 } : s))
  }

  // ── 指针交互（画布坐标换算）──────────────────────────

  function toCanvas(e: React.PointerEvent): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: (e.clientX - rect.left - viewX) / scale, y: (e.clientY - rect.top - viewY) / scale }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    // 扳机开始：手势可能产生多次 persist，标记为“只记一次快照”
    gestureActiveRef.current = true
    gestureSnapshotRef.current = false
    const target = e.target as Element
    // 点击形状本体 → 选中 + 准备拖动（多选时整组移动）
    const shapeEl = target.closest('[data-shape-id]') as HTMLElement | null
    if (shapeEl) {
      const id = shapeEl.dataset.shapeId!
      const s = shapes.find(x => x.id === id)!
      // 框选模式下点击形状：加入多选集（不打断组）
      if (tool === 'select') {
        setSelectedIds(prev => {
          const next = new Set(prev)
          next.add(id)
          return next
        })
        setSelectedId(id)
        setDragMode('move')
        // 组移动：记录组内所有形状的初始位置
        const group = new Set(selectedIds)
        group.add(id)
        const orig = new Map<string, { x: number; y: number }>()
        for (const gid of group) {
          const gs = shapes.find(x => x.id === gid)
          if (gs) orig.set(gid, { x: gs.x, y: gs.y })
        }
        setDragData({ group, orig, startX: e.clientX, startY: e.clientY })
        return
      }
      // 普通模式：点已多选中的形状 → 整组移动；点未选中的 → 单选
      if (selectedIds.has(id)) {
        const orig = new Map<string, { x: number; y: number }>()
        for (const gid of selectedIds) {
          const gs = shapes.find(x => x.id === gid)
          if (gs) orig.set(gid, { x: gs.x, y: gs.y })
        }
        setDragMode('move')
        setDragData({ group: selectedIds, orig, startX: e.clientX, startY: e.clientY })
        return
      }
      setSelectedId(id)
      setSelectedIds(new Set([id]))
      setDragMode('move')
      setDragData({ id, startX: e.clientX, startY: e.clientY, origX: s.x, origY: s.y })
      return
    }
    // 空白按下
    if (tool === 'select') {
      // 框选：开始画矩形
      const p = toCanvas(e)
      setDragMode('marquee')
      setMarquee({ x: p.x, y: p.y, w: 0, h: 0 })
      setDragData({ startX: p.x, startY: p.y })
      return
    }
    // 画新形状（非 move/select 工具）
    if (tool && tool !== 'move') {
      const p = toCanvas(e)
      const defColor = tool === 'wave' ? '#1565c0' : COLORS[2] // 波浪线默认蓝色
      const s: SandboxShape = {
        id: newId(), type: tool,
        x: p.x - 60, y: p.y - 40, w: 120, h: 80, rotation: 0,
        fill: defColor, fillOpacity: 0.35, stroke: defColor, strokeWidth: 2,
        label: '', textPos: 'top' as const, entityType: '', entityId: 0, star: 0,
      }
      persist([...shapes, s])
      setSelectedId(s.id)
      setTool(null)
      return
    }
    setSelectedId(null)
    setSelectedIds(new Set())
    setPreviewShape(null)
    setEditPopup(null)
    setDragMode('pan')
    setDragData({ startX: e.clientX, startY: e.clientY, origX: viewX, origY: viewY })
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragMode || !dragData) return
    if (dragMode === 'marquee') {
      // 框选：更新矩形
      const p = toCanvas(e)
      setMarquee({
        x: Math.min(dragData.startX, p.x),
        y: Math.min(dragData.startY, p.y),
        w: Math.abs(p.x - dragData.startX),
        h: Math.abs(p.y - dragData.startY),
      })
      return
    }
    if (dragMode === 'move') {
      const dx = (e.clientX - dragData.startX) / scale
      const dy = (e.clientY - dragData.startY) / scale
      if (dragData.group) {
        // 多选整组移动
        persist(shapes.map(s => {
          const o = dragData.orig.get(s.id)
          return o ? { ...s, x: o.x + dx, y: o.y + dy } : s
        }))
      } else {
        persist(shapes.map(s => s.id === dragData.id ? { ...s, x: dragData.origX + dx, y: dragData.origY + dy } : s))
      }
    } else if (dragMode === 'pan') {
      setViewX(dragData.origX + (e.clientX - dragData.startX))
      setViewY(dragData.origY + (e.clientY - dragData.startY))
    } else if (dragMode === 'resize' && dragData) {
      // 轴对齐缩放：角柄固定在 x+w,y+h，鼠标拖到哪宽高就跟随（与旋转无关，逻辑永远一致）
      const s = shapes.find(x => x.id === dragData.id)
      if (!s) return
      const p = toCanvas(e)
      const w = Math.max(30, p.x - s.x)
      const h = Math.max(30, p.y - s.y)
      persist(shapes.map(x => x.id === dragData.id ? { ...x, w, h } : x))
    } else if (dragMode === 'rotate' && dragData) {
      // 自由旋转：计算鼠标相对形状中心的角度；接近 45° 倍数则吸附
      const s = shapes.find(x => x.id === dragData.id)
      if (!s) return
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2
      const p = toCanvas(e)
      let deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90 // 手柄在顶部，+90 使 0°=正上方
      // 45° 吸附（±6° 内）
      const snap = Math.round(deg / 45) * 45
      if (Math.abs(deg - snap) < 6) deg = snap
      persist(shapes.map(x => x.id === dragData.id ? { ...x, rotation: Math.round(deg * 10) / 10 } : x))
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (dragMode === 'marquee' && marquee) {
      // 框选命中：矩形与形状 bbox 相交 → 多选
      const hit = shapes.filter(s => {
        const sx = s.x, sy = s.y, sw = s.w, sh = s.h
        return sx < marquee.x + marquee.w && sx + sw > marquee.x && sy < marquee.y + marquee.h && sy + sh > marquee.y
      })
      if (hit.length > 0) {
        setSelectedIds(new Set(hit.map(s => s.id)))
        setSelectedId(hit[hit.length - 1].id)
        setPreviewShape(hit[0])
      } else {
        setSelectedIds(new Set())
        setSelectedId(null)
        setPreviewShape(null)
      }
      setMarquee(null)
    } else if (dragMode === 'move' && dragData) {
      // 单击（无位移）→ 打开编辑弹窗；拖放 → 吸附（组移动不吸附）
      const moved = Math.abs(e.clientX - dragData.startX) + Math.abs(e.clientY - dragData.startY)
      if (moved < 4) {
        // 单击：打开编辑弹窗（框选工具模式不触发）
        if (tool !== 'select' && dragData.id) {
          const s = shapes.find(x => x.id === dragData.id)
          if (s) {
            setEditPopup({ id: s.id, x: 60, y: 60 })
            setPreviewShape(s)
          }
        }
      } else if (!dragData.group) {
        snapToNearest()
      }
    }
    setDragMode(null)
    setDragData(null)
    // 扳机结束：手势标记复位（下次手势重新记录快照）
    gestureActiveRef.current = false
    gestureSnapshotRef.current = false
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 0.9 : 1.1
    setScale(s => Math.min(2.5, Math.max(0.3, s * factor)))
  }

  // 吸附：选中形状拖放后，若靠近某形状边缘 → 环绕
  function snapToNearest() {
    if (!selectedId) return
    const s = shapes.find(x => x.id === selectedId)!
    if (!s || s.id === selectedId) return
    // 简单吸附：靠近某形状中心 80px 内，吸附到其右侧环绕位
    const others = shapes.filter(x => x.id !== s.id)
    let best: SandboxShape | null = null
    let bestDist = 90
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2
    for (const o of others) {
      const ocx = o.x + o.w / 2, ocy = o.y + o.h / 2
      const d = Math.hypot(cx - ocx, cy - ocy)
      if (d < bestDist) { bestDist = d; best = o }
    }
    if (best) {
      const angle = Math.random() * Math.PI * 2
      const r = best.w / 2 + 60
      const nx = best.x + best.w / 2 + Math.cos(angle) * r - s.w / 2
      const ny = best.y + best.h / 2 + Math.sin(angle) * r - s.h / 2
      persist(shapes.map(x => x.id === s.id ? { ...x, x: nx, y: ny } : x))
    }
  }

  function handleClickShape(e: React.MouseEvent, s: SandboxShape) {
    e.stopPropagation()
    setSelectedId(s.id)
    setPreviewShape(s)
    // 弹窗开着 → 切换目标到当前图形；关着 → 打开
    if (editPopup) {
      setEditPopup({ id: s.id, x: editPopup.x, y: editPopup.y })
    }
  }

  // 跳转完整页面（若关联实体）
  function entityTarget(s: SandboxShape): string | null {
    if (!s.entityType || !s.entityId) return null
    const map: Record<string, string> = { location: 'locations', character: 'characters', timeline: 'timeline', setting: 'settings' }
    return map[s.entityType] || null
  }

  // ── 渲染 ─────────────────────────────────────────────

  const selected = shapes.find(s => s.id === selectedId) || null

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      {/* 工具栏 + 画布 */}

      {/* 工具栏 */}
      <div className="flex items-center gap-1 px-4 py-2 border-b shrink-0 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground mr-1">{t('sandbox.title')}</span>
        <button
          onClick={undo}
          disabled={undoStack.length === 0}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] border hover:bg-muted transition-colors disabled:opacity-40"
          title={t('sandbox.undo')}
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={redo}
          disabled={redoStack.length === 0}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] border hover:bg-muted transition-colors disabled:opacity-40"
          title={t('sandbox.redo')}
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setTool('move')}
          className={`inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] border transition-colors ${tool === 'move' ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted'}`}
          title={t('sandbox.moveTool')}
        >
          <MousePointer2 className="w-3.5 h-3.5" />
        </button>
        {/* 框选工具（虚线矩形）：拖框选中多个形状后整组移动 */}
        <button
          onClick={() => setTool('select')}
          className={`inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] border transition-colors ${tool === 'select' ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted'}`}
          title={t('sandbox.selectTool')}
        >
          <BoxSelect className="w-3.5 h-3.5" />
        </button>
        {SHAPE_TYPES.map(s => (
          <button
            key={s.type}
            onClick={() => setTool(s.type)}
            className={`inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] border transition-colors ${tool === s.type ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted'}`}
            title={t(s.key)}
          >
            {s.icon}
          </button>
        ))}
        <div className="w-px h-5 bg-border mx-1" />
        <button
          onClick={openEntityPicker}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] border hover:bg-muted transition-colors text-primary"
          title={t('sandbox.addEntity')}
        >
          <PlusCircle className="w-3.5 h-3.5" />
          {t('sandbox.addEntity')}
        </button>
        <div className="flex-1" />
        {selected && (
          <>
            {/* 颜色 / 透明度 / 文字 */}
            <div className="flex items-center gap-1 mr-1">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => updateSelected({ stroke: c, fill: c })}
                  className="w-4 h-4 rounded-full border border-black/10 transition-transform hover:scale-110"
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
            <label className="text-[11px] text-muted-foreground mr-1">{t('sandbox.fillOpacity')}</label>
            <input
              type="range" min={0} max={100} value={Math.round(selected.fillOpacity * 100)}
              onChange={e => updateSelected({ fillOpacity: Number(e.target.value) / 100 })}
              className="w-20 h-4 accent-primary"
            />
            <label className="text-[11px] font-medium text-foreground mr-1">{t('sandbox.inputText')}</label>
            <input
              value={selected.label}
              onChange={e => updateSelected({ label: e.target.value })}
              placeholder={t('sandbox.inputTextPlaceholder')}
              className="h-7 w-32 rounded-md border-2 border-primary/60 bg-primary/5 px-2 text-[11px] font-medium focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <select
              value={selected.textPos}
              onChange={e => updateSelected({ textPos: e.target.value as any })}
              className="h-7 rounded-md border bg-background px-1.5 text-[11px] focus:outline-none"
              title={t('sandbox.textPos')}
            >
              <option value="top">{t('sandbox.textPosTop')}</option>
              <option value="middle">{t('sandbox.textPosMiddle')}</option>
              <option value="bottom">{t('sandbox.textPosBottom')}</option>
              <option value="left">{t('sandbox.textPosLeft')}</option>
              <option value="right">{t('sandbox.textPosRight')}</option>
            </select>
            <button onClick={deleteSelected} className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] border hover:bg-destructive/10 hover:text-red-500 transition-colors" title={t('sandbox.delete')}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
        <button
          onClick={() => setArrangeOpen(true)}
          disabled={!sandboxId}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] border hover:bg-muted transition-colors disabled:opacity-40 text-primary"
          title={t('sandbox.arrange')}
        >
          <Sparkles className="w-3.5 h-3.5" />
          {t('sandbox.arrange')}
        </button>
        <button
          onClick={openHistory}
          disabled={!sandboxId}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] border hover:bg-muted transition-colors disabled:opacity-40"
          title={t('sandbox.history')}
        >
          <History className="w-3.5 h-3.5" />
          {t('sandbox.history')}
        </button>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1 h-7 px-3 rounded-md text-[11px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {saving ? '…' : <Save className="w-3.5 h-3.5" />}
          {t('sandbox.save')}
        </button>
      </div>

      {/* 画布 */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <svg
          ref={svgRef}
          className="w-full h-full cursor-crosshair select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
        >
          {/* 网格背景 */}
          <defs>
            <pattern id="grid" width={20 * scale} height={20 * scale} patternUnits="userSpaceOnUse">
              <path d={`M ${20 * scale} 0 L 0 0 0 ${20 * scale}`} fill="none" stroke="var(--border)" strokeWidth="0.5" strokeOpacity="0.5" />
            </pattern>
          </defs>
          <rect x={viewX} y={viewY} width={2000 * scale} height={2000 * scale} fill="url(#grid)" />
          <g transform={`translate(${viewX},${viewY}) scale(${scale})`}>
            {shapes.map(s => (
              <Fragment key={s.id}>
              <g
                data-shape-id={s.id}
                transform={`translate(${s.x},${s.y}) rotate(${s.rotation || 0},${s.w / 2},${s.h / 2})${s.flipped ? ` scale(-1,1) translate(${-s.w},0)` : ''}`}
                onClick={e => handleClickShape(e, s)}
                style={{ cursor: 'move' }}
              >
                {s.type === 'world' ? (
                  // 世界观（井字地图容器）：大圆角矩形 + 内部 3×3 网格线 + 中心圆点 + 名称
                  <>
                    <rect
                      x={0} y={0} width={s.w} height={s.h} rx={18}
                      fill={s.fill} fillOpacity={s.fillOpacity || 0.06} stroke={s.stroke} strokeWidth={s.strokeWidth}
                      strokeDasharray={selectedId === s.id || selectedIds.has(s.id) ? '4 3' : undefined}
                    />
                    {/* 井字网格线 */}
                    <g stroke={s.stroke} strokeWidth={1} opacity={0.45} pointerEvents="none">
                      <line x1={s.w / 3} y1={0} x2={s.w / 3} y2={s.h} />
                      <line x1={(s.w * 2) / 3} y1={0} x2={(s.w * 2) / 3} y2={s.h} />
                      <line x1={0} y1={s.h / 3} x2={s.w} y2={s.h / 3} />
                      <line x1={0} y1={(s.h * 2) / 3} x2={s.w} y2={(s.h * 2) / 3} />
                    </g>
                    {/* 中心圆点 */}
                    <circle cx={s.w / 2} cy={s.h / 2} r={6} fill={s.stroke} opacity={0.6} pointerEvents="none" />
                  </>
                ) : s.type === 'drop' ? (
                  // 倒水滴（地点）：顶部圆润大弧，底部快速收尖变小；下方 45° 侧视同心圆环
                  <>
                    {/* 水滴主体：上半圆润、下半快速收尖 */}
                    <path
                      d={`M${s.w / 2},${s.h * 0.97} C${s.w * 0.3},${s.h * 0.97} ${s.w * 0.16},${s.h * 0.68} ${s.w * 0.16},${s.h * 0.42} C${s.w * 0.16},${s.h * 0.2} ${s.w * 0.36},${s.h * 0.05} ${s.w * 0.5},${s.h * 0.05} C${s.w * 0.64},${s.h * 0.05} ${s.w * 0.84},${s.h * 0.2} ${s.w * 0.84},${s.h * 0.42} C${s.w * 0.84},${s.h * 0.68} ${s.w * 0.7},${s.h * 0.97} ${s.w / 2},${s.h * 0.97} Z`}
                      fill={s.fill} fillOpacity={s.fillOpacity} stroke={s.stroke} strokeWidth={s.strokeWidth}
                      strokeDasharray={selectedId === s.id || selectedIds.has(s.id) ? '4 3' : undefined}
                    />
                    {/* 45° 侧视同心圆环（透视椭圆，外环 + 内环） */}
                    <g fill="none" stroke={s.stroke} strokeWidth={Math.max(1.5, s.strokeWidth * 0.8)}
                      strokeDasharray={selectedId === s.id || selectedIds.has(s.id) ? '4 3' : undefined} opacity={0.85}>
                      <ellipse cx={s.w / 2} cy={s.h * 1.12} rx={s.w * 0.62} ry={s.w * 0.16} />
                      <ellipse cx={s.w / 2} cy={s.h * 1.12} rx={s.w * 0.4} ry={s.w * 0.1} />
                    </g>
                  </>
                ) : s.type === 'person' ? (
                  // 人头梯形（人物）：圆头 + 梯形身，名字在上方
                  <>
                    <circle
                      cx={s.w / 2} cy={s.h * 0.24} r={s.w * 0.18}
                      fill={s.fill} fillOpacity={s.fillOpacity} stroke={s.stroke} strokeWidth={s.strokeWidth}
                      strokeDasharray={selectedId === s.id || selectedIds.has(s.id) ? '4 3' : undefined}
                    />
                    <path
                      d={`M${s.w * 0.28},${s.h * 0.42} L${s.w * 0.72},${s.h * 0.42} L${s.w * 0.6},${s.h * 0.95} L${s.w * 0.4},${s.h * 0.95} Z`}
                      fill={s.fill} fillOpacity={s.fillOpacity} stroke={s.stroke} strokeWidth={s.strokeWidth}
                      strokeDasharray={selectedId === s.id || selectedIds.has(s.id) ? '4 3' : undefined}
                    />
                  </>
                ) : s.type === 'event' ? (
                  // 镂空问号（事件）：粗笔画问号
                  <>
                    {/* 粗笔画镂空问号 */}
                    <g
                      fill="none" stroke={s.stroke} strokeWidth={Math.max(4, s.strokeWidth + 2)}
                      strokeDasharray={selectedId === s.id || selectedIds.has(s.id) ? '4 3' : undefined}
                      strokeLinecap="round" strokeLinejoin="round"
                    >
                      <path d={`M${s.w * 0.3},${s.h * 0.42} C${s.w * 0.3},${s.h * 0.16} ${s.w * 0.7},${s.h * 0.16} ${s.w * 0.7},${s.h * 0.42} C${s.w * 0.7},${s.h * 0.62} ${s.w * 0.5},${s.h * 0.56} ${s.w * 0.5},${s.h * 0.72}`} />
                      <circle cx={s.w * 0.5} cy={s.h * 0.86} r={Math.max(2.5, s.w * 0.045)} fill={s.stroke} stroke="none" />
                    </g>
                  </>
                ) : s.type === 'circle' ? (
                  <ellipse
                    cx={s.w / 2} cy={s.h / 2} rx={s.w / 2} ry={s.h / 2}
                    fill={s.fill} fillOpacity={s.fillOpacity} stroke={s.stroke} strokeWidth={s.strokeWidth}
                    strokeDasharray={selectedId === s.id || selectedIds.has(s.id) ? '4 3' : undefined}
                  />
                ) : s.type === 'rect' ? (
                  <rect
                    x={0} y={0} width={s.w} height={s.h} rx={8}
                    fill={s.fill} fillOpacity={s.fillOpacity} stroke={s.stroke} strokeWidth={s.strokeWidth}
                    strokeDasharray={selectedId === s.id || selectedIds.has(s.id) ? '4 3' : undefined}
                  />
                ) : s.type === 'text' ? (
                  // 文字型：内容在文字层渲染（永远水平），这里只留透明点击区
                  <rect x={0} y={0} width={s.w} height={s.h} fill="transparent" stroke="none" />
                ) : s.type === 'arc' ? (
                  // 半圆弧（二次贝塞尔）：fill 透明 + 粗 stroke 表现"有粗细的弧线"
                  // 透明加厚命中层（同路径 strokeWidth×2.5）保证点击弧线附近可选中，不占整盒
                  <>
                    <path
                      d={shapePath(s.type, s.w, s.h, s.curvature)}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={Math.max(10, (s.strokeWidth + 3) * 2.5)}
                      strokeLinecap="round"
                    />
                    <path
                      d={shapePath(s.type, s.w, s.h, s.curvature)}
                      fill="none"
                      stroke={s.stroke}
                      strokeWidth={Math.max(4, s.strokeWidth + 3)}
                      strokeLinecap="round"
                      strokeDasharray={selectedId === s.id || selectedIds.has(s.id) ? '4 3' : undefined}
                    />
                  </>
                ) : (
                  <path
                    d={shapePath(s.type, s.w, s.h)}
                    fill={s.fill} fillOpacity={s.fillOpacity} stroke={s.stroke} strokeWidth={s.strokeWidth}
                    strokeDasharray={selectedId === s.id || selectedIds.has(s.id) ? '4 3' : undefined}
                  />
                )}
              </g>

              {/* 文字层：不随图形旋转/镜像，永远水平正向，按 textPos 固定在顶/中/下 */}
              {s.type === 'text' ? (
                <g onClick={e => handleClickShape(e, s)} style={{ cursor: 'move' }}>
                  {/* 虚线框（选中时）指示可编辑区域 */}
                  {selectedId === s.id && (
                    <rect x={s.x - 2} y={s.y - 2} width={s.w + 4} height={s.h + 4} fill="none" stroke="var(--primary)" strokeWidth={1} strokeDasharray="4 3" rx={4} />
                  )}
                  {/* foreignObject 内嵌 HTML：支持自动换行（pre-wrap），永远水平 */}
                  <foreignObject x={s.x} y={s.y} width={s.w} height={s.h} pointerEvents="none">
                    <div
                      style={{
                        width: s.w, height: s.h,
                        fontSize: Math.max(12, s.h),
                        lineHeight: 1.3, color: 'var(--foreground)',
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        display: 'flex', alignItems: 'center',
                        overflow: 'hidden', fontFamily: 'inherit',
                      }}
                    >
                      {s.label || ''}
                    </div>
                  </foreignObject>
                </g>
              ) : (
                <g pointerEvents="none">
                  {/* 星标（event 类型，永远水平在问号上方，贴近图形顶缘） */}
                  {s.type === 'event' && s.star > 0 && (
                    <text x={s.x + s.w / 2} y={s.y + s.h * 0.1} textAnchor="middle" fontSize={Math.max(16, Math.min(26, s.w * 0.22))} fill="#f59e0b" fontWeight={700}>
                      {'★'.repeat(Math.max(1, Math.min(5, s.star)))}
                    </text>
                  )}
                  {/* 名称文字：6 个位置（顶/中/底/左/右），左/右为竖排；永远水平正向不随图形旋转/镜像 */}
                  {s.label && (s.type === 'world' || s.type === 'drop' || s.type === 'person' || s.type === 'event' || s.label !== ' ') && (
                    <text
                      x={(() => {
                        const p = s.textPos
                        if (p === 'left') return s.x - 6
                        if (p === 'right') return s.x + s.w + 6
                        return s.x + s.w / 2
                      })()}
                      y={(() => {
                        const p = s.textPos
                        if (p === 'left' || p === 'right') return s.y + s.h / 2
                        if (p === 'top') {
                          // event 顶部还有星标：文字再往上提一个文字高度，避免与星重叠
                          if (s.type === 'event') return s.y - 6 - 20
                          return s.y - 6
                        }
                        if (p === 'bottom') {
                          if (s.type === 'drop') return s.y + s.h * 1.32
                          return s.y + s.h + 12
                        }
                        return s.y + s.h / 2
                      })()}
                      textAnchor={(() => {
                        const p = s.textPos
                        if (p === 'left') return 'end'
                        if (p === 'right') return 'start'
                        return 'middle'
                      })()}
                      dominantBaseline="central"
                      fontSize={s.type === 'world' ? Math.max(12, Math.min(17, s.w / 14))
                        : s.type === 'drop' ? Math.max(11, Math.min(15, s.w / 9))
                        : s.type === 'person' || s.type === 'event' ? 13
                        : Math.max(11, Math.min(16, s.w / 8))}
                      fill="var(--foreground)" fontWeight={s.type === 'world' ? 600 : 500}
                      writingMode={s.textPos === 'left' || s.textPos === 'right' ? 'vertical-rl' : undefined}
                    >
                      {s.type === 'world' ? (s.label || t('sandbox.worldDefault')) : s.label}
                    </text>
                  )}
                </g>
              )}
              </Fragment>
            ))}
            {/* 选中形状的控制柄（独立于旋转：角柄固定在轴对齐右下角，不随形状旋转） */}
            {selected && (() => {
              const rad = ((selected.rotation || 0) * Math.PI) / 180
              const sin = Math.sin(rad), cos = Math.cos(rad)
              const cx = selected.x + selected.w / 2
              const cy = selected.y + selected.h / 2
              // 缩放角柄：轴对齐右下角（不旋转，永远在 x+w, y+h）
              const cornerX = selected.x + selected.w
              const cornerY = selected.y + selected.h
              // 旋转手柄：跟随形状视觉顶部（必须随旋转，否则无法表达角度）
              const hh = selected.h / 2
              const topX = cx + (0 * cos - (hh + 18) * sin)
              const topY = cy + (0 * sin + (hh + 18) * cos)
              return (
                <g pointerEvents="none">
                  {/* 移动抓手（中心十字） */}
                  <circle cx={cx} cy={cy} r={13} fill="var(--background)" stroke="var(--primary)" strokeWidth={1.5} opacity={0.7} />
                  <Move x={cx - 7} y={cy - 7} width={14} height={14} color="var(--primary)" strokeWidth={2} opacity={0.7} />
                  {/* 旋转手柄连线 + 小圆（随旋转） */}
                  <line x1={cx} y1={cy} x2={topX} y2={topY} stroke="var(--primary)" strokeWidth={1} strokeDasharray="3 2" />
                  <circle
                    cx={topX} cy={topY} r={6}
                    fill="var(--background)" stroke="var(--primary)" strokeWidth={1.5}
                    pointerEvents="all" style={{ cursor: 'grab' }}
                    onPointerDown={e => {
                      e.stopPropagation()
                      // 扳机：旋转手势开始 → 只记一次快照
                      gestureActiveRef.current = true
                      gestureSnapshotRef.current = false
                      setDragMode('rotate')
                      setDragData({ id: selected.id })
                    }}
                  />
                  {/* 缩放角柄（轴对齐右下角，不随旋转） */}
                  <rect
                    x={cornerX - 5} y={cornerY - 5} width={10} height={10}
                    fill="var(--primary)" stroke="white" strokeWidth={1}
                    pointerEvents="all" style={{ cursor: 'nwse-resize' }}
                    onPointerDown={e => {
                      e.stopPropagation()
                      // 扳机：缩放手势开始 → 只记一次快照
                      gestureActiveRef.current = true
                      gestureSnapshotRef.current = false
                      setDragMode('resize')
                      setDragData({ id: selected.id })
                    }}
                  />
                </g>
              )
            })()}
            {/* 框选矩形（虚线） */}
            {marquee && (
              <rect
                x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h}
                fill="var(--primary)" fillOpacity={0.08}
                stroke="var(--primary)" strokeWidth={1.5} strokeDasharray="6 4"
                pointerEvents="none"
              />
            )}
          </g>
        </svg>

        {/* 编辑弹窗（单击图形打开，可拖动/关闭；点空白或另一图形自动切换） */}
        {editPopup && (() => {
          const s = shapes.find(x => x.id === editPopup.id)
          if (!s) return null
          return (
            <div
              className="absolute z-30 w-60 rounded-lg border bg-background shadow-xl"
              style={{ left: editPopup.x, top: editPopup.y }}
            >
              <div
                className="flex items-center justify-between px-3 py-1.5 border-b cursor-grab active:cursor-grabbing select-none"
                onPointerDown={e => {
                  e.stopPropagation()
                  const startX = e.clientX, startY = e.clientY, origX = editPopup.x, origY = editPopup.y
                  const move = (ev: PointerEvent) => {
                    setEditPopup({ id: s.id, x: origX + (ev.clientX - startX), y: origY + (ev.clientY - startY) })
                  }
                  const up = () => {
                    window.removeEventListener('pointermove', move)
                    window.removeEventListener('pointerup', up)
                  }
                  window.addEventListener('pointermove', move)
                  window.addEventListener('pointerup', up)
                }}
              >
                <span className="text-[11px] font-medium text-muted-foreground">✥ {t('sandbox.editShape')}</span>
                <button onClick={() => setEditPopup(null)} className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">✕</button>
              </div>
              <div className="p-3 space-y-2">
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">{t('sandbox.inputText')}</label>
                  <input
                    value={s.label}
                    onFocus={() => {
                      // 扳机：进入改名 → 记录一次快照（改名期间输入不重复记录）
                      if (!textEditRef.current) {
                        setUndoStack(prev => [...prev, shapes].slice(-50))
                        setRedoStack([])
                        textEditRef.current = true
                      }
                    }}
                    onBlur={() => { textEditRef.current = false }}
                    onChange={e => persist(shapes.map(x => x.id === s.id ? { ...x, label: e.target.value } : x))}
                    placeholder={t('sandbox.inputTextPlaceholder')}
                    className="w-full h-7 rounded-md border-2 border-primary/60 bg-primary/5 px-2 text-[11px] font-medium focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">{t('sandbox.fillColor')}</label>
                  <div className="flex items-center gap-1 flex-wrap">
                    {COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => persist(shapes.map(x => x.id === s.id ? { ...x, fill: c, stroke: c } : x))}
                        className="w-4 h-4 rounded-full border border-black/10 transition-transform hover:scale-110"
                        style={{ background: c, outline: s.fill === c ? '2px solid var(--primary)' : undefined, outlineOffset: 1 }}
                        title={c}
                      />
                    ))}
                    {/* 自定义颜色：点击弹原生取色窗口 */}
                    <label
                      className="relative w-4 h-4 rounded-full border border-black/10 overflow-hidden cursor-pointer transition-transform hover:scale-110"
                      title={t('sandbox.customColorTitle')}
                      style={{
                        background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
                        outline: COLORS.every(c => c !== s.fill) ? '2px solid var(--primary)' : undefined,
                        outlineOffset: 1,
                      }}
                    >
                      <input
                        type="color"
                        value={COLORS.includes(s.fill) ? '#6bcb77' : s.fill}
                        onFocus={() => {
                          // 扳机：点开取色窗口 → 记录一次快照（选色过程不重复记录，满意才离开）
                          if (!colorEditRef.current) {
                            setUndoStack(prev => [...prev, shapes].slice(-50))
                            setRedoStack([])
                            colorEditRef.current = true
                          }
                        }}
                        onBlur={() => { colorEditRef.current = false }}
                        onChange={e => persist(shapes.map(x => x.id === s.id ? { ...x, fill: e.target.value, stroke: e.target.value } : x))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </label>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">{t('sandbox.fillOpacity')}</label>
                  <input
                    type="range" min={0} max={100} value={Math.round(s.fillOpacity * 100)}
                    onPointerDown={() => {
                      // 扳机：滑块按下 → 记录一次快照，拖动过程不重复记录
                      gestureActiveRef.current = true
                      gestureSnapshotRef.current = false
                    }}
                    onPointerUp={() => {
                      gestureActiveRef.current = false
                      gestureSnapshotRef.current = false
                    }}
                    onChange={e => persist(shapes.map(x => x.id === s.id ? { ...x, fillOpacity: Number(e.target.value) / 100 } : x))}
                    className="w-full h-4 accent-primary"
                  />
                </div>
                {/* 弧度滑块：仅弧线（arc）形状显示，位于透明度下方 */}
                {s.type === 'arc' && (
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">{t('sandbox.curvature')}</label>
                    <input
                      type="range" min={5} max={95} value={Math.round((s.curvature ?? 0.5) * 100)}
                      onPointerDown={() => {
                        gestureActiveRef.current = true
                        gestureSnapshotRef.current = false
                      }}
                      onPointerUp={() => {
                        gestureActiveRef.current = false
                        gestureSnapshotRef.current = false
                      }}
                      onChange={e => persist(shapes.map(x => x.id === s.id ? { ...x, curvature: Number(e.target.value) / 100 } : x))}
                      className="w-full h-4 accent-primary"
                    />
                  </div>
                )}
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">{t('sandbox.textPos')}</label>
                  <select
                    value={s.textPos}
                    onChange={e => persist(shapes.map(x => x.id === s.id ? { ...x, textPos: e.target.value as any } : x))}
                    className="w-full h-7 rounded-md border bg-background px-1.5 text-[11px] focus:outline-none"
                  >
                    <option value="top">{t('sandbox.textPosTop')}</option>
                    <option value="middle">{t('sandbox.textPosMiddle')}</option>
                    <option value="bottom">{t('sandbox.textPosBottom')}</option>
                    <option value="left">{t('sandbox.textPosLeft')}</option>
                    <option value="right">{t('sandbox.textPosRight')}</option>
                  </select>
                </div>

                {/* 图层顺序 + 旋转（带文字说明，从上到下） */}
                <div className="border-t pt-2 space-y-1">
                  <button
                    onClick={() => bringToFront(s.id)}
                    className="w-full flex items-center gap-2 h-7 px-2 rounded-md text-[11px] text-foreground hover:bg-muted transition-colors"
                  >
                    <ArrowUpToLine className="w-3.5 h-3.5 text-muted-foreground" />
                    {t('sandbox.bringToFront')}
                  </button>
                  <button
                    onClick={() => moveUp(s.id)}
                    className="w-full flex items-center gap-2 h-7 px-2 rounded-md text-[11px] text-foreground hover:bg-muted transition-colors"
                  >
                    <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                    {t('sandbox.moveUp')}
                  </button>
                  <button
                    onClick={() => moveDown(s.id)}
                    className="w-full flex items-center gap-2 h-7 px-2 rounded-md text-[11px] text-foreground hover:bg-muted transition-colors"
                  >
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    {t('sandbox.moveDown')}
                  </button>
                  <button
                    onClick={() => sendToBack(s.id)}
                    className="w-full flex items-center gap-2 h-7 px-2 rounded-md text-[11px] text-foreground hover:bg-muted transition-colors"
                  >
                    <ArrowDownToLine className="w-3.5 h-3.5 text-muted-foreground" />
                    {t('sandbox.sendToBack')}
                  </button>
                  <button
                    onClick={() => rotate90(s.id)}
                    className="w-full flex items-center gap-2 h-7 px-2 rounded-md text-[11px] text-foreground hover:bg-muted transition-colors"
                  >
                    <RotateCw className="w-3.5 h-3.5 text-muted-foreground" />
                    {t('sandbox.rotate90')}
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

        {/* 历史版本弹窗 */}
        {histOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => setHistOpen(false)} />
            <div className="relative bg-background rounded-xl shadow-2xl border w-[420px] max-w-[92vw] h-[400px] max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <History className="w-4 h-4 text-primary" />
                  {t('sandbox.history')}
                </h3>
                <button onClick={() => setHistOpen(false)} className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">✕</button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
                {histList.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">{t('sandbox.historyEmpty')}</p>
                ) : histList.map(h => (
                  <div key={h.name} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                    <span className="flex-1 text-xs">{h.mtime}</span>
                    <button
                      onClick={() => handleRestoreHistory(h.name)}
                      className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] border hover:bg-muted transition-colors"
                    >
                      {t('sandbox.restore')}
                    </button>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2 border-t text-[10px] text-muted-foreground shrink-0">
                {t('sandbox.historyHint')}
              </div>
            </div>
          </div>
        )}

        {/* AI 布局弹窗 */}
        {arrangeOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={closeArrangeDialog} />
            <div className="relative bg-background rounded-xl shadow-2xl border w-[440px] max-w-[92vw] flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-primary" />
                  {t('sandbox.arrange')}
                </h3>
                <button onClick={closeArrangeDialog} className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">✕</button>
              </div>
              <div className="p-4 space-y-3">
                {arranging ? (
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      {t('sandbox.arranging')}…
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">{t('sandbox.arrangeBackgroundHint')}</p>
                  </div>
                ) : (
                  <>
                    <textarea
                      value={arrangePrompt}
                      onChange={e => setArrangePrompt(e.target.value)}
                      placeholder={t('sandbox.arrangePlaceholder')}
                      rows={3}
                      className="w-full rounded-md border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                    />
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      <label className="flex items-center gap-1.5">
                        <input type="radio" checked={!arrangePrompt.trim()} readOnly className="accent-primary" />
                        {t('sandbox.arrangeFull')}
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="radio" checked={!!arrangePrompt.trim()} readOnly className="accent-primary" />
                        {t('sandbox.arrangeIncremental')}
                      </label>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{t('sandbox.arrangeHint')}</p>
                    <div className="rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
                      <p className="font-medium text-foreground mb-0.5">{t('sandbox.arrangeBgNoticeTitle')}</p>
                      {t('sandbox.arrangeBgNotice')}
                    </div>
                  </>
                )}
              </div>
              <div className="px-4 py-3 border-t flex justify-end gap-2 shrink-0">
                {arranging ? (
                  <button onClick={handleCancelArrange} className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md text-xs bg-destructive text-white hover:opacity-90 transition-opacity">
                    <X className="w-3.5 h-3.5" />
                    {t('sandbox.cancelArrange')}
                  </button>
                ) : (
                  <>
                    <button onClick={() => setArrangeOpen(false)} className="h-8 px-3 rounded-md text-xs border hover:bg-muted transition-colors">
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={handleArrange}
                      disabled={arranging}
                      className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {t('sandbox.arrange')}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 首次使用引导弹窗 */}
        {onboardOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOnboardOpen(false)} />
            <div className="relative bg-background rounded-xl shadow-2xl border w-[480px] max-w-[92vw] flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <Globe2 className="w-4 h-4 text-primary" />
                  {t('sandbox.onboardTitle')}
                </h3>
                <button onClick={() => setOnboardOpen(false)} className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">✕</button>
              </div>
              <div className="p-4 max-h-[60vh] overflow-y-auto">
                <p className="text-xs leading-relaxed text-foreground whitespace-pre-line">{t('sandbox.onboardBody')}</p>
              </div>
              <div className="px-4 py-3 border-t flex justify-end shrink-0">
                <button onClick={() => setOnboardOpen(false)} className="h-8 px-4 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
                  {t('sandbox.onboardGotIt')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 预览小窗 */}
        {previewShape && (
          <div className="absolute right-3 bottom-3 w-56 rounded-lg border bg-background shadow-lg p-3 space-y-2 z-20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium truncate">{previewShape.label || t('sandbox.unnamed')}</span>
              <button onClick={() => setPreviewShape(null)} className="text-muted-foreground hover:text-foreground text-xs px-1">✕</button>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm border" style={{ background: previewShape.fill, opacity: previewShape.fillOpacity }} />
                {t(`sandbox.shape_${previewShape.type}`)}
              </span>
              {previewShape.entityType && <span>{previewShape.entityType} #{previewShape.entityId}</span>}
            </div>
            {entityTarget(previewShape) && (
              <button
                onClick={() => {
                  const panel = entityTarget(previewShape)!
                  window.dispatchEvent(new CustomEvent('sandbox:open-entity', { detail: { panel, entityId: previewShape.entityId, novelId } }))
                }}
                className="w-full inline-flex items-center justify-center gap-1 h-7 rounded-md text-[11px] border hover:bg-muted transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                {t('sandbox.openEntity')}
              </button>
            )}
          </div>
        )}

        {/* 提示 */}
        <div className="absolute left-3 bottom-3 text-[10px] text-muted-foreground/60 z-10 pointer-events-none">
          {t('sandbox.hint')}
        </div>
      </div>

      {/* 实体选择器弹窗：把角色/地点/事件放入画布 */}
      {entityPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEntityPickerOpen(false)} />
          <div className="relative bg-background rounded-xl shadow-2xl border w-[480px] max-w-[92vw] h-[480px] max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
              <h3 className="text-sm font-semibold">{t('sandbox.addEntity')}</h3>
              <button onClick={() => setEntityPickerOpen(false)} className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">✕</button>
            </div>
            {/* Tab */}
            <div className="flex items-center gap-1 px-4 py-2 border-b shrink-0">
              {([['world', t('sandbox.tabWorld')], ['location', t('sandbox.tabLocations')], ['character', t('sandbox.tabCharacters')], ['timeline', t('sandbox.tabTimeline')]] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  onClick={() => setPickerTab(tab)}
                  className={`h-7 px-3 rounded-md text-xs transition-colors ${pickerTab === tab ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* 列表 */}
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
              {pickerTab === 'world' && (worldList.length === 0 ? <p className="text-xs text-muted-foreground p-3">{t('sandbox.noWorld')}</p> : worldList.map(w => (
                <button key={w.id} onClick={() => addEntity('world', w.id, w.name)} className="w-full text-left px-3 py-2 rounded-md hover:bg-muted transition-colors text-xs">
                  <Globe2 className="w-3.5 h-3.5 inline mr-1.5 text-primary" />
                  {w.name}
                  {w.desc && <span className="block text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{w.desc}</span>}
                </button>
              )))}
              {pickerTab === 'location' && (locList.length === 0 ? <p className="text-xs text-muted-foreground p-3">{t('sandbox.noLocations')}</p> : locList.map(l => (
                <button key={l.id} onClick={() => addEntity('location', l.id, l.name)} className="w-full text-left px-3 py-2 rounded-md hover:bg-muted transition-colors text-xs">
                  📍 {l.name}
                </button>
              )))}
              {pickerTab === 'character' && (charList.length === 0 ? <p className="text-xs text-muted-foreground p-3">{t('sandbox.noCharacters')}</p> : charList.map(c => (
                <button key={c.id} onClick={() => addEntity('character', c.id, c.name)} className="w-full text-left px-3 py-2 rounded-md hover:bg-muted transition-colors text-xs">
                  👤 {c.name}
                </button>
              )))}
              {pickerTab === 'timeline' && (timelineList.length === 0 ? <p className="text-xs text-muted-foreground p-3">{t('sandbox.noTimeline')}</p> : timelineList.map(t => (
                <button key={t.id} onClick={() => addEntity('timeline', t.id, t.title, t.star)} className="w-full text-left px-3 py-2 rounded-md hover:bg-muted transition-colors text-xs">
                  ⚡ {t.title}
                  <span className="ml-2 text-amber-500">{'★'.repeat(Math.max(1, Math.min(5, t.star)))}</span>
                </button>
              )))}
            </div>
            <div className="px-4 py-2 border-t text-[10px] text-muted-foreground shrink-0">
              {t('sandbox.addEntityHint')}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

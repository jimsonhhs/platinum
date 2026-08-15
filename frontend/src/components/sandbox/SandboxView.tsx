import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Circle, Square, Waves, Diamond, Triangle, Spline, Trash2, Save, MousePointer2, ExternalLink, Move, PlusCircle, Type, BoxSelect } from 'lucide-react'
import { useApp } from '@/hooks/useApp'
import { toastError, toastSuccess } from '@/lib/utils'

// ── 类型 ────────────────────────────────────────────────

type ShapeType = 'circle' | 'rect' | 'wave' | 'arc' | 'diamond' | 'triangle' | 'text'

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
  entityType: string
  entityId: number
}

interface Props {
  novelId: number
  sandboxId: string
}

const SHAPE_TYPES: { type: ShapeType; icon: React.ReactNode; key: string }[] = [
  { type: 'circle', icon: <Circle className="w-4 h-4" />, key: 'sandbox.shapeCircle' },
  { type: 'rect', icon: <Square className="w-4 h-4" />, key: 'sandbox.shapeRect' },
  { type: 'wave', icon: <Waves className="w-4 h-4" />, key: 'sandbox.shapeWave' },
  { type: 'arc', icon: <Spline className="w-4 h-4" />, key: 'sandbox.shapeArc' },
  { type: 'diamond', icon: <Diamond className="w-4 h-4" />, key: 'sandbox.shapeDiamond' },
  { type: 'triangle', icon: <Triangle className="w-4 h-4" />, key: 'sandbox.shapeTriangle' },
]

const COLORS = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#b983ff', '#ff8fab', '#8d99ae', '#f9844a']

let idCounter = 0
function newId(): string { return `s${Date.now()}_${idCounter++}` }

// 形状路径（以左上角 (0,0) 为基准，宽 w 高 h）
function shapePath(type: ShapeType, w: number, h: number): string {
  switch (type) {
    case 'circle':
      return '' // 用 <ellipse> 渲染
    case 'rect':
      return ''
    case 'wave':
      // 波浪带：上下对称两条波浪（丝带形，不是底部直线封口）
      return `M0,${h * 0.35} Q${w * 0.25},${h * 0.1} ${w * 0.5},${h * 0.35} Q${w * 0.75},${h * 0.6} ${w},${h * 0.35} L${w},${h * 0.65} Q${w * 0.75},${h * 0.9} ${w * 0.5},${h * 0.65} Q${w * 0.25},${h * 0.4} 0,${h * 0.65} Z`
    case 'arc':
      // 对称弧形（透镜状：上下两条对称弧）
      return `M0,${h * 0.5} A${w * 0.5},${h * 0.5} 0 0 1 ${w},${h * 0.5} A${w * 0.5},${h * 0.5} 0 0 1 0,${h * 0.5} Z`
    case 'diamond':
      return `M${w / 2},0 L${w},${h / 2} L${w / 2},${h} L0,${h / 2} Z`
    case 'triangle':
      return `M${w / 2},0 L${w},${h} L0,${h} Z`
    case 'text':
      return '' // 纯文字，无背景
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
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [entityPickerOpen, setEntityPickerOpen] = useState(false)
  const [pickerTab, setPickerTab] = useState<'character' | 'location' | 'timeline'>('location')
  const [charList, setCharList] = useState<{ id: number; name: string }[]>([])
  const [locList, setLocList] = useState<{ id: number; name: string }[]>([])
  const [timelineList, setTimelineList] = useState<{ id: number; title: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [dragMode, setDragMode] = useState<'move' | 'resize' | 'rotate' | 'pan' | 'draw' | 'marquee' | null>(null)
  const [dragData, setDragData] = useState<any>(null)
  const svgRef = useRef<SVGSVGElement>(null)

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

  const persist = useCallback((next: SandboxShape[]) => {
    setDirty(true)
    setShapes(next)
  }, [])

  async function handleSave() {
    if (!sandboxId) return
    setSaving(true)
    try {
      await app.SaveSandbox(novelId, sandboxId, { shapes, viewX, viewY, scale } as any)
      setDirty(false)
      toastSuccess(t('sandbox.saved'))
      window.dispatchEvent(new CustomEvent('sandbox:list-changed'))
    } catch (err) { toastError(String(err)) } finally { setSaving(false) }
  }

  // 打开实体选择器：加载角色/地点/事件列表
  async function openEntityPicker() {
    setEntityPickerOpen(true)
    setPickerTab('location')
    try {
      const [chars, locs, tls] = await Promise.all([
        app.GetCharacters(novelId),
        app.GetLocations(novelId),
        app.GetTimelineEntries(novelId, 1, 100),
      ])
      setCharList((chars ?? []).map((c: any) => ({ id: c.id, name: c.name })))
      setLocList((locs ?? []).map((l: any) => ({ id: l.id, name: l.name })))
      setTimelineList((tls ?? []).map((t: any) => ({ id: t.id, title: t.title || '' })))
    } catch (err) { toastError(String(err)) }
  }

  // 把实体放入画布：按类型默认形状 + 关联实体
  function addEntity(type: 'character' | 'location' | 'timeline', id: number, name: string) {
    const shapeType: ShapeType = type === 'location' ? 'rect' : type === 'character' ? 'circle' : 'wave'
    const color = type === 'location' ? COLORS[3] : type === 'character' ? COLORS[0] : COLORS[1]
    const s: SandboxShape = {
      id: newId(), type: shapeType,
      x: 160 + Math.random() * 200, y: 120 + Math.random() * 160,
      w: 120, h: 80, rotation: 0,
      fill: color, fillOpacity: 0.35,
      stroke: color, strokeWidth: 2,
      label: name, entityType: type, entityId: id,
    }
    persist([...shapes, s])
    setSelectedId(s.id)
    setEntityPickerOpen(false)
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

  // ── 指针交互（画布坐标换算）──────────────────────────

  function toCanvas(e: React.PointerEvent): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: (e.clientX - rect.left - viewX) / scale, y: (e.clientY - rect.top - viewY) / scale }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
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
      const isText = tool === 'text'
      const s: SandboxShape = {
        id: newId(), type: isText ? 'text' : tool,
        x: p.x - (isText ? 0 : 60), y: p.y - (isText ? 12 : 40),
        w: isText ? 180 : 120, h: isText ? 40 : 80, rotation: 0,
        fill: isText ? 'transparent' : COLORS[2], fillOpacity: isText ? 0 : 0.35,
        stroke: isText ? 'transparent' : COLORS[2], strokeWidth: isText ? 0 : 2,
        label: '', entityType: '', entityId: 0,
      }
      persist([...shapes, s])
      setSelectedId(s.id)
      setTool(null)
      // 文字：立即进入就地编辑
      if (isText) setEditingTextId(s.id)
      return
    }
    setSelectedId(null)
    setSelectedIds(new Set())
    setPreviewShape(null)
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
      const p = toCanvas(e)
      const w = Math.max(30, p.x - dragData.origX)
      const h = Math.max(30, p.y - dragData.origY)
      persist(shapes.map(s => s.id === dragData.id ? { ...s, w, h } : s))
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

  function onPointerUp() {
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
    } else if (dragMode === 'move' && !dragData?.group) {
      // 单形状拖放后吸附（组移动不吸附）
      snapToNearest()
    }
    setDragMode(null)
    setDragData(null)
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
  }

  // 跳转完整页面（若关联实体）
  function entityTarget(s: SandboxShape): string | null {
    if (!s.entityType || !s.entityId) return null
    const map: Record<string, string> = { location: 'locations', character: 'characters', timeline: 'timeline' }
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
        {/* 文字工具（PPT 的 A）：点击画布后就地输入，字号用缩放角柄控制 */}
        <button
          onClick={() => setTool('text')}
          className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] border transition-colors ${tool === 'text' ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted'}`}
          title={t('sandbox.textTool')}
        >
          <Type className="w-3.5 h-3.5" />
          A
        </button>
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
            <input
              value={selected.label}
              onChange={e => updateSelected({ label: e.target.value })}
              placeholder={t('sandbox.labelPlaceholder')}
              className="h-7 w-28 rounded-md border bg-background px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button onClick={deleteSelected} className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] border hover:bg-destructive/10 hover:text-red-500 transition-colors" title={t('sandbox.delete')}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
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
              <g
                key={s.id}
                data-shape-id={s.id}
                transform={`translate(${s.x},${s.y}) rotate(${s.rotation || 0},${s.w / 2},${s.h / 2})`}
                onClick={e => handleClickShape(e, s)}
                style={{ cursor: 'move' }}
              >
                {s.type === 'circle' ? (
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
                  <>
                    {/* 虚线框（选中时）指示可编辑区域 */}
                    {selectedId === s.id && (
                      <rect x={-2} y={-2} width={s.w + 4} height={s.h + 4} fill="none" stroke="var(--primary)" strokeWidth={1} strokeDasharray="4 3" rx={4} />
                    )}
                    <text
                      x={0} y={s.h / 2}
                      textAnchor="start" dominantBaseline="central"
                      fontSize={Math.max(12, s.h)}
                      fill="var(--foreground)" pointerEvents="none"
                    >
                      {s.label || ' '}
                    </text>
                  </>
                ) : (
                  <path
                    d={shapePath(s.type, s.w, s.h)}
                    fill={s.fill} fillOpacity={s.fillOpacity} stroke={s.stroke} strokeWidth={s.strokeWidth}
                    strokeDasharray={selectedId === s.id || selectedIds.has(s.id) ? '4 3' : undefined}
                  />
                )}
                {s.label && s.type !== 'text' && (
                  <text
                    x={s.w / 2} y={s.h / 2}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize={Math.max(11, Math.min(16, s.w / 8))}
                    fill="var(--foreground)" pointerEvents="none"
                  >
                    {s.label}
                  </text>
                )}
                {/* 选中移动抓手提示（十字箭头，纯视觉） */}
                {selectedId === s.id && (
                  <g pointerEvents="none" opacity={0.7}>
                    <circle cx={s.w / 2} cy={s.h / 2} r={13} fill="var(--background)" stroke="var(--primary)" strokeWidth={1.5} />
                    <Move x={s.w / 2 - 7} y={s.h / 2 - 7} width={14} height={14} color="var(--primary)" strokeWidth={2} />
                  </g>
                )}
                {/* 选中旋转手柄（顶部小圆，拖动自由旋转 + 45°吸附） */}
                {selectedId === s.id && (
                  <>
                    <line x1={s.w / 2} y1={s.h / 2} x2={s.w / 2} y2={-18} stroke="var(--primary)" strokeWidth={1} strokeDasharray="3 2" pointerEvents="none" />
                    <circle
                      cx={s.w / 2} cy={-18} r={6}
                      fill="var(--background)" stroke="var(--primary)" strokeWidth={1.5}
                      style={{ cursor: 'grab' }}
                      onPointerDown={e => {
                        e.stopPropagation()
                        setDragMode('rotate')
                        setDragData({ id: s.id })
                      }}
                    />
                  </>
                )}
                {/* 选中缩放角柄 */}
                {selectedId === s.id && (
                  <>
                    <rect x={s.w} y={s.h} width={10} height={10} fill="var(--primary)" stroke="white" strokeWidth={1}
                      style={{ cursor: 'nwse-resize' }}
                      onPointerDown={e => {
                        e.stopPropagation()
                        setDragMode('resize')
                        setDragData({ id: s.id, origX: s.x, origY: s.y })
                      }}
                    />
                  </>
                )}
              </g>
            ))}
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

        {/* 文字就地输入框（A 工具点击后） */}
        {editingTextId && (() => {
          const s = shapes.find(x => x.id === editingTextId)
          if (!s) return null
          const sx = viewX + s.x * scale
          const sy = viewY + s.y * scale
          return (
            <input
              autoFocus
              value={s.label}
              onChange={e => persist(shapes.map(x => x.id === s.id ? { ...x, label: e.target.value } : x))}
              onBlur={() => setEditingTextId(null)}
              onKeyDown={e => { if (e.key === 'Enter') setEditingTextId(null) }}
              className="absolute z-30 rounded border border-primary bg-background px-1.5 outline-none"
              style={{ left: sx, top: sy, width: Math.max(40, s.w * scale), height: Math.max(24, s.h * scale), fontSize: Math.max(12, s.h * scale), fontFamily: 'inherit' }}
              placeholder={t('sandbox.textPlaceholder')}
            />
          )
        })()}

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
              {([['location', t('sandbox.tabLocations')], ['character', t('sandbox.tabCharacters')], ['timeline', t('sandbox.tabTimeline')]] as const).map(([tab, label]) => (
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
                <button key={t.id} onClick={() => addEntity('timeline', t.id, t.title)} className="w-full text-left px-3 py-2 rounded-md hover:bg-muted transition-colors text-xs">
                  ⚡ {t.title}
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

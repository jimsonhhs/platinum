import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, Ban, CheckCircle2, Clock, Flag, Map as MapIcon, Pencil, Plus, Star, Target, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '@/hooks/useApp'
import type { timeline } from '@/hooks/useApp'

const CATEGORIES = [
  { value: 'foreshadowing', label: 'timeline.foreshadowing' },
  { value: 'user_directive', label: 'timeline.userInstruction' },
]

interface Props { novelId: number; focusEntryId?: number }

type Filter = 'all' | 'not_started' | 'pending' | 'foreshadowing' | 'completed' | 'abandoned'

const ENTRY_WINDOW = 20

// 事件状态（4 态 + 已废弃）：not_started 未发生 / pending 进行中 / foreshadowing 伏笔 / completed 已完成 / abandoned 已废弃
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'timeline.all' },
  { key: 'not_started', label: 'timeline.statusNotStarted' },
  { key: 'pending', label: 'timeline.inProgress' },
  { key: 'foreshadowing', label: 'timeline.foreshadowing' },
  { key: 'completed', label: 'timeline.statusCompleted' },
  { key: 'abandoned', label: 'timeline.abandoned' },
]

const STATUSES = [
  { value: 'not_started', label: 'timeline.statusNotStarted' },
  { value: 'pending', label: 'timeline.inProgress' },
  { value: 'foreshadowing', label: 'timeline.foreshadowing' },
  { value: 'completed', label: 'timeline.statusCompleted' },
  { value: 'abandoned', label: 'timeline.abandoned' },
]
const IMPORTANCES = [1, 2, 3, 4, 5]
// 旧数据兼容映射：pending→进行中，resolved→已完成
const LEGACY_STATUS: Record<string, string> = { pending: 'pending', resolved: 'completed', abandoned: 'abandoned' }
function normStatus(s: string): string { return LEGACY_STATUS[s] || s }

function importStars(v: number) {
  return '★'.repeat(Math.max(0, Math.min(5, v)))
}

type EditMode = { type: 'create' } | { type: 'edit'; entry: timeline.TimelineEntry } | null

type EditForm = {
  title: string
  content: string
  location: string
  event_time: string
  characters: string   // JSON 数组字符串
  related_chapters: string
  target_chapter: number
  importance: number
  detail_json: string
  status: string
  resolved_chapter_id: number
  category?: string
  source_chapter_id?: number
  source?: string
}

const EDIT_FORM_EMPTY: EditForm = {
  title: '',
  content: '',
  location: '',
  event_time: '',
  characters: '',
  related_chapters: '',
  target_chapter: 1,
  importance: 3,
  detail_json: '',
  status: 'not_started',
  resolved_chapter_id: 0,
}

function parseChars(raw: string): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    if (Array.isArray(v)) return v.map(String).filter(Boolean)
  } catch { /* 非 JSON 时按顿号/逗号拆 */ }
  return raw.split(/[、，,]/).map(s => s.trim()).filter(Boolean)
}

export default function TimelineView({ novelId, focusEntryId }: Props) {
  const app = useApp()
  const { t } = useTranslation()

  const [entries, setEntries] = useState<timeline.TimelineEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [starFilter, setStarFilter] = useState(0) // 0=全部
  const [locFilter, setLocFilter] = useState('')  // 地点筛选
  const [charFilter, setCharFilter] = useState('') // 人物筛选
  const [windowCenter, setWindowCenter] = useState(0)
  const [editMode, setEditMode] = useState<EditMode>(null)
  const [form, setForm] = useState<EditForm>(EDIT_FORM_EMPTY)
  const [createCat, setCreateCat] = useState('foreshadowing')
  const [saving, setSaving] = useState(false)
  // 人物 tag 编辑
  const [charInput, setCharInput] = useState('')

  const load = useCallback(async () => {
    if (!novelId) { setEntries([]); return }
    setLoading(true)
    setError(null)
    try {
      const [entryList, maxCh] = await Promise.all([
        app.GetTimelineEntries(novelId, 0, 0),
        app.GetMaxChapterNumber(novelId),
      ])
      setEntries(entryList ?? [])
      setWindowCenter(Math.max(1, maxCh))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('timeline.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [app, novelId, t])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (focusEntryId && focusEntryId > 0 && entries.length > 0) {
      const entry = entries.find(e => e.id === focusEntryId)
      if (entry) setWindowCenter(entry.target_chapter || 1)
    }
  }, [focusEntryId, entries])

  const windowFrom = Math.max(1, windowCenter - ENTRY_WINDOW)
  const windowTo = windowCenter + ENTRY_WINDOW

  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
      if (filter !== 'all' && normStatus(e.status) !== filter) return false
      if (starFilter > 0 && e.importance !== starFilter) return false
      if (locFilter && !(e.location || '').includes(locFilter)) return false
      if (charFilter) {
        const chars = parseChars(e.characters)
        if (!chars.some(c => c.includes(charFilter))) return false
      }
      return true
    })
  }, [entries, filter, starFilter, locFilter, charFilter])

  const grouped = useMemo(() => {
    const map = new Map<number, timeline.TimelineEntry[]>()
    for (const e of filteredEntries) {
      const ch = e.target_chapter
      if (!map.has(ch)) map.set(ch, [])
      map.get(ch)!.push(e)
    }
    return [...map.entries()].sort(([a], [b]) => a - b)
  }, [filteredEntries])

  const visibleChapters = grouped.filter(([ch]) => ch >= windowFrom && ch <= windowTo)
  const beforeChapters = grouped.filter(([ch]) => ch < windowFrom)
  const afterChapters = grouped.filter(([ch]) => ch > windowTo)
  const beforeCount = beforeChapters.reduce((s, [, items]) => s + items.length, 0)
  const afterCount = afterChapters.reduce((s, [, items]) => s + items.length, 0)
  const maxChapter = grouped.length > 0 ? grouped[grouped.length - 1][0] : 0

  // 地点/人物筛选选项（来自全部条目去重）
  const locOptions = useMemo(() => {
    const s = new Set<string>()
    for (const e of entries) if (e.location && e.location.trim()) s.add(e.location.trim())
    return [...s].sort()
  }, [entries])
  const charOptions = useMemo(() => {
    const s = new Set<string>()
    for (const e of entries) for (const c of parseChars(e.characters)) s.add(c)
    return [...s].sort()
  }, [entries])

  function shiftWindow(delta: number) {
    setWindowCenter(prev => Math.max(ENTRY_WINDOW + 1, Math.min(maxChapter - ENTRY_WINDOW, prev + delta)))
  }

  const statusStyle = (status: string) => {
    switch (normStatus(status)) {
      case 'not_started': return { icon: Clock, bg: 'bg-tag-blue', text: 'text-tag-blue-foreground', label: t('timeline.statusNotStarted') }
      case 'pending': return { icon: Activity, bg: 'bg-tag-amber', text: 'text-tag-amber-foreground', label: t('timeline.inProgress') }
      case 'foreshadowing': return { icon: Target, bg: 'bg-danger-bg', text: 'text-destructive', label: t('timeline.foreshadowing') }
      case 'completed': return { icon: CheckCircle2, bg: 'bg-tag-green', text: 'text-tag-green-foreground', label: t('timeline.statusCompleted') }
      case 'abandoned': return { icon: Ban, bg: 'bg-secondary', text: 'text-muted-foreground', label: t('timeline.abandoned') }
      default: return { icon: Flag, bg: 'bg-muted', text: 'text-muted-foreground', label: status }
    }
  }

  // ── CRUD handlers ────────────────────────────────────

  function openCreate() {
    setError(null)
    setForm({ ...EDIT_FORM_EMPTY, target_chapter: Math.max(1, windowCenter) })
    setCreateCat('foreshadowing')
    setCharInput('')
    setEditMode({ type: 'create' })
  }

  function openEdit(entry: timeline.TimelineEntry) {
    setError(null)
    setForm({
      title: entry.title,
      content: entry.content || '',
      location: entry.location || '',
      event_time: entry.event_time || '',
      characters: entry.characters || '',
      related_chapters: entry.related_chapters || '',
      target_chapter: entry.target_chapter,
      importance: entry.importance,
      detail_json: entry.detail_json || '',
      status: normStatus(entry.status),
      resolved_chapter_id: entry.resolved_chapter_id,
    })
    setCharInput('')
    setEditMode({ type: 'edit', entry })
  }

  async function handleCreate() {
    if (!form.title.trim()) { setError(t('timeline.pleaseEnterTitle')); return }
    if (!form.target_chapter) { setError(t('timeline.pleaseEnterTargetChapter')); return }
    setSaving(true)
    try {
      await app.CreateTimelineEntry(novelId, {
        category: createCat,
        title: form.title,
        content: form.content,
        location: form.location,
        event_time: form.event_time,
        characters: form.characters,
        related_chapters: form.related_chapters,
        target_chapter: form.target_chapter,
        importance: form.importance,
        source_chapter_id: 0,
        detail_json: form.detail_json,
        source: 'user',
      })
      setEditMode(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('timeline.createFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate() {
    if (!editMode || editMode.type !== 'edit') return
    if (!form.title.trim()) { setError(t('timeline.pleaseEnterTitle')); return }
    setSaving(true)
    try {
      const payload = {
        title: form.title,
        content: form.content,
        location: form.location,
        event_time: form.event_time,
        characters: form.characters,
        related_chapters: form.related_chapters,
        detail_json: form.detail_json,
        target_chapter: form.target_chapter,
        importance: form.importance,
        status: form.status,
        resolved_chapter_id: form.status === 'completed' ? form.resolved_chapter_id || form.target_chapter : 0,
      }
      await app.UpdateTimelineEntry(novelId, editMode.entry.id, payload)
      setEditMode(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('timeline.updateFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(entryId: number) {
    if (!confirm(t('timeline.confirmDelete'))) return
    setSaving(true)
    try {
      await app.DeleteTimelineEntry(novelId, entryId)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('timeline.deleteFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleQuickStatus(entry: timeline.TimelineEntry, newStatus: string) {
    setSaving(true)
    try {
      await app.UpdateTimelineEntry(novelId, entry.id, {
        title: entry.title,
        content: entry.content || '',
        location: entry.location || '',
        event_time: entry.event_time || '',
        characters: entry.characters || '',
        related_chapters: entry.related_chapters || '',
        detail_json: entry.detail_json || '',
        target_chapter: entry.target_chapter,
        importance: entry.importance,
        status: newStatus,
        resolved_chapter_id: newStatus === 'completed' ? entry.target_chapter : 0,
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('timeline.updateStatusFailed'))
    } finally {
      setSaving(false)
    }
  }

  // 人物 tag 编辑：输入框回车/逗号加入
  function addCharTag() {
    const v = charInput.trim()
    if (!v) return
    const cur = parseChars(form.characters)
    if (!cur.includes(v)) cur.push(v)
    setForm(f => ({ ...f, characters: JSON.stringify(cur) }))
    setCharInput('')
  }
  function removeCharTag(idx: number) {
    const cur = parseChars(form.characters)
    cur.splice(idx, 1)
    setForm(f => ({ ...f, characters: JSON.stringify(cur) }))
  }

  // ── Form fields ──────────────────────────────────────

  function renderFormFields(showCategory: boolean, showStatus: boolean) {
    const charTags = parseChars(form.characters)
    return (
      <div className="space-y-3">
        {showCategory && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('timeline.type')}</label>
            <select
              value={createCat}
              onChange={e => setCreateCat(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{t(c.label)}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('timeline.title')}</label>
          <input
            type="text"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={t('timeline.shortTitle')}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('timeline.location')}</label>
            <input
              type="text"
              value={form.location}
              onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={t('timeline.locationPlaceholder')}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('timeline.eventTime')}</label>
            <input
              type="text"
              value={form.event_time}
              onChange={e => setForm(f => ({ ...f, event_time: e.target.value }))}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={t('timeline.eventTimePlaceholder')}
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('timeline.characters')}</label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5">
            {charTags.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                {c}
                <button type="button" onClick={() => removeCharTag(i)} className="text-primary/60 hover:text-primary">✕</button>
              </span>
            ))}
            <input
              type="text"
              value={charInput}
              onChange={e => setCharInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ',' || e.key === '，') { e.preventDefault(); addCharTag() } }}
              onBlur={addCharTag}
              className="flex-1 min-w-[80px] bg-transparent text-xs text-foreground focus:outline-none"
              placeholder={t('timeline.charactersPlaceholder')}
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('timeline.relatedChapters')}</label>
          <input
            type="text"
            value={form.related_chapters}
            onChange={e => setForm(f => ({ ...f, related_chapters: e.target.value }))}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={t('timeline.relatedChaptersPlaceholder')}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('timeline.content')}</label>
          <textarea
            value={form.content}
            onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
            rows={2}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
            placeholder={t('timeline.detailedDescription')}
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('timeline.targetChapter')}</label>
            <input
              type="number"
              value={form.target_chapter}
              onChange={e => setForm(f => ({ ...f, target_chapter: parseInt(e.target.value) || 1 }))}
              min={1}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('timeline.importance')}</label>
            <select
              value={form.importance}
              onChange={e => setForm(f => ({ ...f, importance: parseInt(e.target.value) }))}
              className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {IMPORTANCES.map(i => <option key={i} value={i}>{importStars(i)}</option>)}
            </select>
          </div>
        </div>
        {showStatus && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('timeline.status')}</label>
            <div className="relative">
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {STATUSES.map(si => {
                  const st = statusStyle(si.value)
                  const colorMap: Record<string, string> = {
                    'bg-tag-blue': '#3b82f6',
                    'bg-tag-amber': '#f59e0b',
                    'bg-danger-bg': '#ef4444',
                    'bg-tag-green': '#22c55e',
                    'bg-secondary': '#9ca3af',
                  }
                  return (
                    <option
                      key={si.value}
                      value={si.value}
                      className="bg-white text-foreground"
                      style={{ color: colorMap[st.bg] || '#374151', fontWeight: 500 }}
                    >
                      {t(si.label)}
                    </option>
                  )
                })}
              </select>
              {/* 状态色点（当前选中项） */}
              <span
                className={`pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full ${statusStyle(form.status).bg}`}
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <main className="relative flex-1 min-w-0 overflow-y-auto overscroll-contain bg-background">
      {loading ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('timeline.loading')}</div>
      ) : error ? (
        <div className="flex h-full items-center justify-center text-sm text-destructive">{error}</div>
      ) : (
        <div className="max-w-3xl mx-auto px-5 py-6 space-y-6">
          {/* 事件清单 */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-tag-amber-foreground" />
                <h2 className="text-sm font-semibold text-foreground">
                  {t('timeline.foreshadowingAndInstructions')}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{entries.length} {t('timeline.countUnit')}</span>
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {t('sidebar.chapterRange', { start: windowFrom, end: windowTo })} · {t('storyarc.totalChapters', { count: maxChapter })}
                </span>
                <button onClick={load} className="text-xs text-muted-foreground hover:text-muted-foreground transition-colors">{t('timeline.refresh')}</button>
                <button
                  onClick={openCreate}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                >
                  <Plus className="h-3 w-3" />
                  {t('timeline.new')}
                </button>
              </div>
            </div>

            {/* 筛选：状态 + 星级 + 地点 + 人物 */}
            <div className="space-y-2 mb-4">
              <div className="flex gap-1 flex-wrap">
                {FILTERS.map(f => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`px-3 py-1 rounded text-xs transition-colors ${
                      filter === f.key ? 'bg-card border border-border text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t(f.label)}
                    {f.key !== 'all' && (
                      <span className="ml-1 text-muted-foreground">({entries.filter(e => normStatus(e.status) === f.key).length})</span>
                    )}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* 星级筛选 */}
                <div className="flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 text-tag-amber-foreground" />
                  {[0, 1, 2, 3, 4, 5].map(i => (
                    <button
                      key={i}
                      onClick={() => setStarFilter(i)}
                      className={`px-1.5 py-0.5 rounded text-[11px] transition-colors ${
                        starFilter === i ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
                      }`}
                      title={i === 0 ? t('timeline.all') : `${i}★`}
                    >
                      {i === 0 ? t('timeline.all') : `${i}★`}
                    </button>
                  ))}
                </div>
                {/* 地点筛选 */}
                <select
                  value={locFilter}
                  onChange={e => setLocFilter(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground focus-visible:outline-none"
                >
                  <option value="">{t('timeline.filterAllLocations')}</option>
                  {locOptions.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
                {/* 人物筛选 */}
                <select
                  value={charFilter}
                  onChange={e => setCharFilter(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground focus-visible:outline-none"
                >
                  <option value="">{t('timeline.filterAllCharacters')}</option>
                  {charOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {/* Create form */}
            {editMode?.type === 'create' && (
              <div className="rounded-lg border border-border bg-card p-4 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-foreground">{t('timeline.newEntry')}</span>
                  <button onClick={() => { setEditMode(null); setForm(EDIT_FORM_EMPTY) }} className="p-0.5 rounded text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {renderFormFields(true, false)}
                <div className="flex items-center gap-2 justify-end mt-3">
                  <button onClick={() => { setEditMode(null); setForm(EDIT_FORM_EMPTY) }} className="px-3 py-1 rounded text-xs text-muted-foreground hover:text-foreground transition-colors">{t('timeline.cancel')}</button>
                  <button
                    onClick={handleCreate}
                    disabled={saving || !form.title.trim()}
                    className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {saving ? t('timeline.creating') : t('timeline.create')}
                  </button>
                </div>
              </div>
            )}

            {grouped.length === 0 ? (
              <div className="text-center py-12">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                  <Target className="h-5 w-5" />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {filter === 'all' ? t('timeline.noForeshadowing') : t('timeline.noMatchingEntries')}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {beforeCount > 0 && (
                  <button onClick={() => shiftWindow(-ENTRY_WINDOW)} className="w-full rounded-lg border border-dashed border-border bg-card/60 px-4 py-2.5 text-xs text-muted-foreground hover:bg-card hover:border-border hover:text-foreground transition-colors">
                    ← {t('storyarc.earlierChapters', { start: beforeChapters[0]?.[0], end: beforeChapters[beforeChapters.length - 1]?.[0] })} · {beforeCount} {t('timeline.countUnit')}
                  </button>
                )}

                {visibleChapters.map(([ch, items]) => (
                  <div key={ch}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="text-xs font-medium text-muted-foreground">{t('sidebar.chapterN', { n: ch })}</span>
                      <span className="text-[11px] text-muted-foreground">{items.length} {t('timeline.countUnit')}</span>
                    </div>
                    <div className="space-y-2">
                      {items.map(entry => {
                        const s = statusStyle(entry.status)
                        const CatIcon = s.icon
                        const isEditing = editMode?.type === 'edit' && editMode.entry.id === entry.id
                        const charTags = parseChars(entry.characters)

                        return isEditing ? (
                          <div key={entry.id} className="rounded-lg border border-border bg-card p-4">
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-xs font-semibold text-foreground">{t('storyarc.editing')}{entry.title}</span>
                              <button onClick={() => { setEditMode(null); setForm(EDIT_FORM_EMPTY) }} className="p-0.5 rounded text-muted-foreground hover:text-foreground">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            {renderFormFields(false, true)}
                            <div className="flex items-center gap-2 justify-end mt-3">
                              <button onClick={() => handleDelete(entry.id)} className="px-3 py-1 rounded text-xs text-destructive hover:bg-destructive/10 transition-colors" disabled={saving}>
                                <Trash2 className="h-3 w-3 inline mr-1" />{t('timeline.delete')}
                              </button>
                              <button onClick={() => { setEditMode(null); setForm(EDIT_FORM_EMPTY) }} className="px-3 py-1 rounded text-xs text-muted-foreground hover:text-foreground transition-colors">{t('timeline.cancel')}</button>
                              <button onClick={handleUpdate} disabled={saving || !form.title.trim()} className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
                                {saving ? t('timeline.saving') : t('timeline.save')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            key={entry.id}
                            className="rounded-lg border border-border bg-card hover:border-border hover:shadow-sm transition-shadow group"
                          >
                            <div className="flex items-start gap-3 px-4 py-3">
                              <span className={`shrink-0 flex h-7 w-7 items-center justify-center rounded ${s.bg}`}>
                                <CatIcon className={`h-3.5 w-3.5 ${s.text}`} />
                              </span>
                              <div className="flex-1 min-w-0">
                                {/* 第一行：标题 + 星级 */}
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-foreground truncate">{entry.title}</span>
                                  <span className="shrink-0 text-tag-amber-foreground text-[11px]">{importStars(entry.importance)}</span>
                                </div>
                                {/* 第二行：状态徽标 + 地点 / 时间 / 人物 tags / 相关章节 */}
                                <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground flex-wrap">
                                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${s.bg} ${s.text}`}>
                                    {s.label}
                                  </span>
                                  {entry.location && <span>📍 {entry.location}</span>}
                                  {entry.event_time && <span>🕐 {entry.event_time}</span>}
                                  {charTags.length > 0 && (
                                    <span className="flex items-center gap-1">
                                      {charTags.map((ct, i) => (
                                        <span key={i} className="rounded bg-primary/10 px-1 py-px text-[10px] text-primary">{ct}</span>
                                      ))}
                                    </span>
                                  )}
                                  <span>{t('timeline.targetChapterN', { n: entry.target_chapter })}</span>
                                  {entry.related_chapters && <span>· {t('timeline.relatedChapters')}: {entry.related_chapters}</span>}
                                  {entry.source_chapter_id > 0 && <span>· {t('timeline.plantedInChapter', { n: entry.source_chapter_id })}</span>}
                                  {entry.resolved_chapter_id > 0 && <span className="text-tag-green-foreground">· {t('timeline.recoveredInChapter', { n: entry.resolved_chapter_id })}</span>}
                                  <span className="text-muted-foreground">· {entry.source === 'ai' ? t('timeline.ai') : t('timeline.user')}</span>
                                </div>
                              </div>
                              {/* Quick actions */}
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {normStatus(entry.status) !== 'completed' && normStatus(entry.status) !== 'abandoned' && (
                                  <button
                                    onClick={() => handleQuickStatus(entry, 'completed')}
                                    className="p-1 rounded text-muted-foreground hover:text-tag-green-foreground hover:bg-tag-green/20 transition-colors"
                                    title={t('timeline.markRecovered')}
                                  >
                                    <span className="text-[11px]">✓</span>
                                  </button>
                                )}
                                <button
                                  onClick={() => window.dispatchEvent(new CustomEvent('entity:locate-sandbox', { detail: { entityType: 'timeline', entityId: entry.id, name: entry.title } }))}
                                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                                  title={t('timeline.locateSandbox')}
                                >
                                  <MapIcon className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => openEdit(entry)}
                                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                                  title={t('timeline.edit')}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDelete(entry.id)}
                                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                  title={t('timeline.delete')}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                            {entry.content && (
                              <div className="border-t border-border px-4 py-3">
                                <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap line-clamp-3">{entry.content}</p>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}

                {afterCount > 0 && (
                  <button onClick={() => shiftWindow(ENTRY_WINDOW)} className="w-full rounded-lg border border-dashed border-border bg-card/60 px-4 py-2.5 text-xs text-muted-foreground hover:bg-card hover:border-border hover:text-foreground transition-colors">
                    → {t('storyarc.laterChapters', { start: afterChapters[0]?.[0], end: afterChapters[afterChapters.length - 1]?.[0] })} · {afterCount} {t('timeline.countUnit')}
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  )
}

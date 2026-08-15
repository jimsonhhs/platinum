import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, Plus, Pencil, Trash2, Heart, Copy, PenLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toastError } from '@/lib/utils'
import { useApp } from '@/hooks/useApp'
import type { skill } from '@/hooks/useApp'
import SkillContributeDialog from './SkillContributeDialog'

interface Props {
  novelId: number
  activeSkillName: string | null
  onSelectSkill: (path: string, title: string, readOnly: boolean) => void
  onEditSkill: (path: string, title: string, readOnly: boolean) => void
  onNewSkill: (name: string) => void
}

function skillPath(name: string, source: string): string {
  switch (source) {
    case 'novel': return `skills/${name}.md`
    case 'user': return `~/.goink/skills/${name}.md`
    case 'builtin': return `/builtin/skills/${name}.md`
    default: return `skills/${name}.md`
  }
}

function modeTagClass(mode: string): string {
  switch (mode) {
    case 'manual': return 'bg-tag-blue text-tag-blue-foreground'
    case 'always': return 'bg-tag-green text-tag-green-foreground'
    default: return 'bg-tag-amber text-tag-amber-foreground'
  }
}

export default function SkillList({ novelId, activeSkillName, onSelectSkill, onEditSkill, onNewSkill }: Props) {
  const app = useApp()
  const { t } = useTranslation()
  const [skills, setSkills] = useState<skill.SkillMeta[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [showContribute, setShowContribute] = useState(false)

  const load = useCallback(async () => {
    if (!novelId) { setSkills([]); return }
    setLoading(true)
    try {
      const list = await app.ListSkills({ novel_id: novelId })
      setSkills(list ?? [])
    } catch (err) {
      console.error('Failed to load skills:', err)
    } finally {
      setLoading(false)
    }
  }, [app, novelId])

  useEffect(() => { load() }, [load])

  const categories = useMemo(() => {
    const set = new Set<string>()
    skills.forEach(s => { if (s.category && !s.error) set.add(s.category) })
    return Array.from(set).sort()
  }, [skills])

  const filtered = useMemo(() => {
    let list = skills
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(s => s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q))
    }
    if (category) {
      list = list.filter(s => s.category === category)
    }
    return list
  }, [skills, search, category])

  const brokenSkills = filtered.filter(s => s.error)
  const healthy = filtered.filter(s => !s.error)
  const novelSkills = healthy.filter(s => s.source === 'novel')
  const userSkills = healthy.filter(s => s.source === 'user')
  const builtinSkills = healthy.filter(s => s.source === 'builtin')

  const handleDelete = async (s: skill.SkillMeta) => {
    if (!confirm(t('skill.confirmDeleteSkill') + `「${s.name}」？`)) return
    try {
      await app.DeleteSkill({ novel_id: novelId, name: s.name, source: s.source })
      await load()
    } catch (err) {
      toastError(t('skill.deleteFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      console.error(err)
    }
  }

  const handleRename = async (s: skill.SkillMeta) => {
    const newName = prompt(t('skill.renamePrompt'), s.name)
    if (!newName || newName.trim() === s.name) return
    try {
      await app.RenameSkill({ novel_id: novelId, source: s.source, name: s.name, new_name: newName.trim() })
      await load()
    } catch (err) {
      toastError(t('skill.renameFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      console.error(err)
    }
  }

  const handleDuplicate = async (s: skill.SkillMeta) => {
    // 内置 → 用户级；用户级 → 当前小说；小说级 → 用户级
    let targetSource = 'user'
    if (s.source === 'user') targetSource = 'novel'
    try {
      await app.DuplicateSkill({ novel_id: novelId, source: s.source, name: s.name, target_source: targetSource })
      await load()
    } catch (err) {
      toastError(t('skill.duplicateFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      console.error(err)
    }
  }

  const duplicateTitle = (s: skill.SkillMeta) =>
    s.source === 'user' ? t('skill.copyToNovel') : t('skill.copyToUser')

  return (
    <>
      <div className="flex items-center justify-between px-3 py-2.5 border-b gap-1">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t('skill.skills')} ({skills.length})
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowContribute(true)}
            className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-rose-500 transition-colors"
            title={t('skill.contribute')}
          >
            <Heart className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setCreating(true)}
            className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            title={t('skill.newSkill')}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {creating && (
        <div className="px-2 py-1.5 border-b flex gap-1">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newName.trim()) {
                onNewSkill(newName.trim())
                setCreating(false)
                setNewName('')
              }
              if (e.key === 'Escape') {
                setCreating(false)
                setNewName('')
              }
            }}
            onBlur={() => {
              if (!newName.trim()) {
                setCreating(false)
              }
            }}
            placeholder={t('skill.namePlaceholder')}
            autoFocus
            className="flex-1 px-2 py-0.5 text-xs bg-background border rounded outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={() => {
              if (newName.trim()) {
                onNewSkill(newName.trim())
                setCreating(false)
                setNewName('')
              }
            }}
            disabled={!newName.trim()}
            className="px-2 py-0.5 text-xs text-action-save hover:text-action-save/80 disabled:opacity-50"
          >
            {t('skill.confirm')}
          </button>
        </div>
      )}
      <div className="px-2 py-1.5 space-y-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('skill.search')}
            className="w-full pl-7 pr-2 py-1 text-xs bg-muted/40 rounded border-0 outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {categories.length > 0 && (
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="w-full px-2 py-1 text-xs bg-muted/40 rounded border-0 outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">{t('skill.filterAll')}</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">{t('skill.loading')}</div>
        ) : skills.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">{t('skill.noSkills')}</div>
        ) : (
          <>
            {brokenSkills.length > 0 && (
              <SkillGroup
                title={t('skill.brokenGroup')}
                skills={brokenSkills}
                activeSkillName={activeSkillName}
                broken
                onSelect={onSelectSkill}
                onEdit={onEditSkill}
                onDelete={handleDelete}
                onRename={handleRename}
                onDuplicate={handleDuplicate}
                duplicateTitle={duplicateTitle}
              />
            )}
            {novelSkills.length > 0 && (
              <SkillGroup
                title={t('skill.currentNovel')}
                skills={novelSkills}
                activeSkillName={activeSkillName}
                onSelect={onSelectSkill}
                onEdit={onEditSkill}
                onDelete={handleDelete}
                onRename={handleRename}
                onDuplicate={handleDuplicate}
                duplicateTitle={duplicateTitle}
              />
            )}
            {userSkills.length > 0 && (
              <SkillGroup
                title={t('skill.userLevel')}
                skills={userSkills}
                activeSkillName={activeSkillName}
                onSelect={onSelectSkill}
                onEdit={onEditSkill}
                onDelete={handleDelete}
                onRename={handleRename}
                onDuplicate={handleDuplicate}
                duplicateTitle={duplicateTitle}
              />
            )}
            {builtinSkills.length > 0 && (
              <SkillGroup
                title={t('skill.builtin')}
                skills={builtinSkills}
                activeSkillName={activeSkillName}
                onSelect={onSelectSkill}
                onEdit={onEditSkill}
                onDelete={handleDelete}
                onRename={handleRename}
                onDuplicate={handleDuplicate}
                duplicateTitle={duplicateTitle}
              />
            )}
          </>
        )}
      </div>
      <SkillContributeDialog open={showContribute} onClose={() => setShowContribute(false)} />
    </>
  )
}

function SkillGroup({ title, skills, activeSkillName, broken, onSelect, onEdit, onDelete, onRename, onDuplicate, duplicateTitle }: {
  title: string
  skills: skill.SkillMeta[]
  activeSkillName: string | null
  broken?: boolean
  onSelect: (path: string, title: string, readOnly: boolean) => void
  onEdit: (path: string, title: string, readOnly: boolean) => void
  onDelete: (s: skill.SkillMeta) => void
  onRename: (s: skill.SkillMeta) => void
  onDuplicate: (s: skill.SkillMeta) => void
  duplicateTitle: (s: skill.SkillMeta) => string
}) {
  const { t } = useTranslation()
  const isBuiltin = skills[0]?.source === 'builtin'
  return (
    <div>
      <div className="px-3 py-1.5">
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${broken ? 'text-destructive/80' : 'text-muted-foreground/60'}`}>{title}</span>
      </div>
      {skills.map(s => {
        const path = skillPath(s.name, s.source)
        const display = `${t('skill.skillLabel')}${s.name}`
        const readOnly = s.source === 'builtin'
        const active = activeSkillName === display
        return (
          <div key={`${s.source}:${s.name}`} className="group relative">
            <button
              onClick={() => broken ? onEdit(path, display, false) : onSelect(path, display, readOnly)}
              className={`w-full flex flex-col px-3 py-1.5 text-left hover:bg-muted/50 transition-colors ${active ? 'bg-muted' : ''}`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />
              )}
              <span className={`text-sm truncate flex items-center gap-1.5 ${broken ? 'text-destructive' : ''}`}>
                {s.name}
                {!broken && (
                  <span className={`inline-flex items-center px-1.5 py-px rounded text-[9px] font-medium leading-none ${modeTagClass(s.mode)}`}>
                    {s.mode === 'manual' ? t('skill.modeShortManual') : s.mode === 'always' ? t('skill.modeShortAlways') : t('skill.modeShortAuto')}
                  </span>
                )}
              </span>
              {broken ? (
                <span className="text-[11px] text-destructive/70 truncate">{t('skill.brokenHint')}{s.error}</span>
              ) : (
                s.description && (
                  <span className="text-[11px] text-muted-foreground truncate">{s.description}</span>
                )
              )}
            </button>
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {!isBuiltin && (
                <button
                  onClick={e => {
                    e.stopPropagation()
                    onRename(s)
                  }}
                  className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                  title={t('skill.renameSkill')}
                >
                  <PenLine className="w-3 h-3" />
                </button>
              )}
              {!isBuiltin && !broken && (
                <button
                  onClick={e => {
                    e.stopPropagation()
                    onEdit(path, display, readOnly)
                  }}
                  className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                  title={t('skill.editSkill')}
                >
                  <Pencil className="w-3 h-3" />
                </button>
              )}
              {!broken && (
                <button
                  onClick={e => {
                    e.stopPropagation()
                    onDuplicate(s)
                  }}
                  className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                  title={duplicateTitle(s)}
                >
                  <Copy className="w-3 h-3" />
                </button>
              )}
              {!isBuiltin && (
                <button
                  onClick={e => {
                    e.stopPropagation()
                    onDelete(s)
                  }}
                  className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-destructive transition-colors"
                  title={t('skill.deleteSkill')}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { useApp } from '@/hooks/useApp'
import type { setting } from '@/lib/wailsjs/go/models'

interface Props {
  novelId: number
  activeSettingId: number | null
  onSelect: (id: number) => void
}

export default function SettingList({ novelId, activeSettingId, onSelect }: Props) {
  const app = useApp()
  const { t } = useTranslation()
  const [items, setItems] = useState<setting.SettingItem[]>([])
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    if (!novelId) { setItems([]); return }
    try {
      setItems((await app.ListSettings(novelId)) ?? [])
    } catch (err) {
      console.error('load settings failed', err)
    }
  }, [app, novelId])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(it =>
      (it.category || '').toLowerCase().includes(q) || (it.content || '').toLowerCase().includes(q)
    )
  }, [items, search])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-2.5 border-b shrink-0">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t('settingsView.title')} ({items.length})
        </span>
      </div>
      <div className="px-2 py-1.5 border-b shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('settingsView.search')}
            className="w-full pl-7 pr-2 py-1 text-xs bg-muted/40 rounded border-0 outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            {t('settingsView.empty')}
          </div>
        ) : (
          filtered.map(it => {
            const active = activeSettingId === it.id
            return (
              <button
                key={it.id}
                onClick={() => onSelect(it.id)}
                className={`w-full flex flex-col px-3 py-1.5 text-left hover:bg-muted/50 transition-colors relative ${
                  active ? 'bg-muted' : ''
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />
                )}
                <span className="text-xs text-muted-foreground/70 truncate">{it.category || '—'}</span>
                <span className="text-sm truncate">{it.content}</span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

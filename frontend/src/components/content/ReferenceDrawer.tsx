import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Users, MapPin, X, Search, Loader2 } from 'lucide-react'
import { useApp } from '@/hooks/useApp'
import type { character, location } from '@/lib/wailsjs/go/models'

interface Props {
  novelId: number
  onClose: () => void
}

// ReferenceDrawer：写正文时的右侧只读参照区（角色 / 地点），支持搜索。
export default function ReferenceDrawer({ novelId, onClose }: Props) {
  const app = useApp()
  const { t } = useTranslation()
  const [tab, setTab] = useState<'characters' | 'locations'>('characters')
  const [chars, setChars] = useState<character.Character[]>([])
  const [locs, setLocs] = useState<location.Location[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!novelId) return
    setLoading(true)
    try {
      const [c, l] = await Promise.all([app.GetCharacters(novelId), app.GetLocations(novelId)])
      setChars(c ?? [])
      setLocs(l ?? [])
    } catch (err) {
      console.error('reference load failed', err)
    } finally {
      setLoading(false)
    }
  }, [app, novelId])

  useEffect(() => { load() }, [load])

  const q = query.trim().toLowerCase()
  const filteredChars = q
    ? chars.filter(c => (c.name || '').toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q))
    : chars
  const filteredLocs = q
    ? locs.filter(l => (l.name || '').toLowerCase().includes(q) || (l.description || '').toLowerCase().includes(q))
    : locs

  const tabBtn = (active: boolean) =>
    `px-2 py-1 text-xs rounded transition-colors ${active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`

  return (
    <aside className="w-72 shrink-0 border-l bg-sidebar flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <div className="flex items-center gap-1">
          <button className={tabBtn(tab === 'characters')} onClick={() => setTab('characters')}>
            <Users className="w-3.5 h-3.5 inline mr-1 -mt-px" />
            {t('shell.characters')}
          </button>
          <button className={tabBtn(tab === 'locations')} onClick={() => setTab('locations')}>
            <MapPin className="w-3.5 h-3.5 inline mr-1 -mt-px" />
            {t('shell.locations')}
          </button>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title={t('common.close')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="px-2 py-1.5 border-b shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('common.search')}
            className="w-full pl-7 pr-2 py-1 text-xs bg-muted/40 rounded border-0 outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-2 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : tab === 'characters' ? (
          filteredChars.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">{t('common.noData')}</p>
          ) : (
            filteredChars.map(c => (
              <div key={c.id} className="border rounded-md px-2.5 py-2 bg-background">
                <p className="text-sm font-medium truncate">{c.name}</p>
                {c.description && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{c.description}</p>
                )}
              </div>
            ))
          )
        ) : filteredLocs.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">{t('common.noData')}</p>
        ) : (
          filteredLocs.map(l => (
            <div key={l.id} className="border rounded-md px-2.5 py-2 bg-background">
              <p className="text-sm font-medium truncate">{l.name}</p>
              {l.location_type && <p className="text-[10px] text-muted-foreground/70">{l.location_type}</p>}
              {l.description && (
                <p className="text-[11px] text-muted-foreground mt-0.5 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{l.description}</p>
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  )
}

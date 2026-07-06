import { useState, useEffect, useCallback, useRef } from 'react'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '@/hooks/useApp'
import type { style } from '@/lib/wailsjs/go/models'

interface Props {
  onSelectSample: (id: number) => void
  activeId?: number | null
}

export default function StyleSampleList({ onSelectSample, activeId }: Props) {
  const app = useApp()
  const { t } = useTranslation()
  const [samples, setSamples] = useState<style.Sample[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (q: string = search) => {
    setLoading(true)
    try {
      const result = await app.ListStyleSamples({ novel_id: 0, page: 1, size: 100, search: q })
      setSamples(result?.items ?? [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [app])

  useEffect(() => { load() }, [load]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => load(search), 300)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="flex items-center justify-between px-3 py-2.5 border-b">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t('styleSample.samples')} ({samples.length})
        </span>
      </div>
      <div className="px-2 py-1.5 border-b">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('styleSample.searchPlaceholder')}
            className="w-full h-7 rounded-md border bg-background pl-7 pr-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">{t('styleSample.loading')}</div>
        ) : samples.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            {search ? t('styleSample.noMatching') : t('styleSample.noSamples')}
          </div>
        ) : (
          samples.map(s => (
            <button
              key={s.id}
              onClick={() => onSelectSample(s.id)}
              className={`relative w-full flex flex-col px-3 py-1.5 text-left hover:bg-muted/50 transition-colors ${
                activeId === s.id ? 'bg-muted' : ''
              }`}
            >
              {activeId === s.id && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />
              )}
              <span className="text-sm truncate">{s.name}</span>
              <span className="text-[11px] text-muted-foreground truncate">{s.word_count} {t('styleSample.charCount')}</span>
            </button>
          ))
        )}
      </div>
    </>
  )
}

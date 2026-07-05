import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from '@/hooks/useApp'
import type { StyleSampleMeta } from './StyleSampleCard'

interface Props {
  onSelectSample: (id: string) => void
}

export default function StyleSampleList({ onSelectSample }: Props) {
  const app = useApp()
  const { t } = useTranslation()
  const [samples, setSamples] = useState<StyleSampleMeta[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await app.ListStyleSamples()
      setSamples(list ?? [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [app])

  useEffect(() => { load() }, [load])

  return (
    <>
      <div className="flex items-center justify-between px-3 py-2.5 border-b">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t('styleSample.samples')} ({samples.length})
        </span>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">{t('styleSample.loading')}</div>
        ) : samples.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">{t('styleSample.noSamples')}</div>
        ) : (
          samples.map(s => (
            <button
              key={s.id}
              onClick={() => onSelectSample(s.id)}
              className="w-full flex flex-col px-3 py-1.5 text-left hover:bg-muted/50 transition-colors"
            >
              <span className="text-sm truncate">{s.name}</span>
              <span className="text-[11px] text-muted-foreground truncate">{s.word_count} {t('styleSample.charCount')}</span>
            </button>
          ))
        )}
      </div>
    </>
  )
}

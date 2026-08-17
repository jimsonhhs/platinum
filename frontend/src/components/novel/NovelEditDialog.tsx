import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Save } from 'lucide-react'
import type { novel } from '@/hooks/useApp'

interface Props {
  open: boolean
  novel?: novel.Novel | null  // 传了=编辑，不传=创建
  onClose: () => void
  onSave: (input: { title: string; description: string; genre: string }) => Promise<void>
}

export default function NovelEditDialog({ open, novel, onClose, onSave }: Props) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [genre, setGenre] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const GENRE_PRESETS = [
    t('novel.genreFantasy'),
    t('novel.genreSciFi'),
    t('novel.genreUrban'),
    t('novel.genreHistory'),
    t('novel.genreMystery'),
    t('novel.genreWuxia'),
    t('novel.genreRomance'),
    t('novel.genreOther'),
  ]

  useEffect(() => {
    if (!open) return
    setTitle(novel?.title ?? '')
    setDescription(novel?.description ?? '')
    setGenre(novel?.genre ?? '')
    setError('')
  }, [open, novel])

  async function handleSave() {
    if (!title.trim()) {
      setError(t('novel.titleRequiredHint'))
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave({ title: title.trim(), description: description.trim(), genre: genre.trim() })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-background rounded-xl shadow-2xl border w-[560px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h3 className="text-base font-semibold">{novel ? t('novel.edit') : t('novel.newWork')}</h3>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="h-8 px-4 rounded-md text-xs border hover:bg-muted transition-colors">
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          <div className="space-y-3">
            <label className="block text-xs text-muted-foreground">
              {t('novel.bookTitle')} *
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                autoFocus
                className="mt-1 w-full h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </label>

            <label className="block text-xs text-muted-foreground">
              {t('novel.genre')}
              <div className="mt-1 flex flex-wrap gap-1.5">
                {GENRE_PRESETS.map(g => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGenre(g)}
                    className={`h-7 px-2.5 rounded-md text-xs border transition-colors ${
                      genre === g ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </label>

            <label className="block text-xs text-muted-foreground">
              {t('novel.summary')}
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={4}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            </label>
          </div>

          {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
        </div>
      </div>
    </div>
  )
}

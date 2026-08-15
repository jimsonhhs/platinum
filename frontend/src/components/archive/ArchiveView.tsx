import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ArchiveRestore, Plus, ChevronRight, RotateCcw, Inbox, Loader2 } from 'lucide-react'
import { toastError } from '@/lib/utils'
import { useApp } from '@/hooks/useApp'
import type { archive } from '@/lib/wailsjs/go/models'

export default function ArchiveView() {
  const app = useApp()
  const { t } = useTranslation()
  const [snaps, setSnaps] = useState<archive.SnapshotMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [files, setFiles] = useState<string[]>([])
  const [filesLoading, setFilesLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await app.ListSnapshots()
      setSnaps(list ?? [])
    } catch (err) {
      toastError(t('archive.loadFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [app, t])

  useEffect(() => { load() }, [load])

  async function handleCreate() {
    setCreating(true)
    try {
      await app.CreateSnapshot()
      await load()
    } catch (err) {
      toastError(t('archive.createFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      console.error(err)
    } finally {
      setCreating(false)
    }
  }

  async function toggle(sid: string) {
    if (expanded === sid) {
      setExpanded(null)
      setFiles([])
      return
    }
    setExpanded(sid)
    setFilesLoading(true)
    setFiles([])
    try {
      setFiles((await app.ListSnapshotFiles(sid)) ?? [])
    } catch (err) {
      toastError(t('archive.loadFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setFilesLoading(false)
    }
  }

  async function handleRestoreFile(sid: string, path: string) {
    if (!confirm(t('archive.confirmRestoreFile') + `\n${path}`)) return
    try {
      await app.RestoreSnapshotFile({ snapshot_id: sid, path })
      await load()
    } catch (err) {
      toastError(t('archive.restoreFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      console.error(err)
    }
  }

  async function handleRestoreAll(sid: string) {
    if (!confirm(t('archive.confirmRestoreAll'))) return
    try {
      const n = await app.RestoreSnapshotAll(sid)
      window.alert(t('archive.restoredCount', { count: n }))
      await load()
    } catch (err) {
      toastError(t('archive.restoreFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      console.error(err)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      <div className="px-6 py-4 border-b shrink-0 flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <ArchiveRestore className="w-4 h-4 text-muted-foreground" />
            {t('archive.title')}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">{t('archive.hint')}</p>
        </div>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs border hover:bg-muted transition-colors disabled:opacity-50 shrink-0"
        >
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          {creating ? t('archive.creating') : t('archive.createNow')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : snaps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Inbox className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-xs">{t('archive.empty')}</p>
          </div>
        ) : (
          <div className="space-y-2 max-w-3xl">
            {snaps.map(s => (
              <div key={s.id} className="border rounded-md">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button
                    onClick={() => toggle(s.id)}
                    className="flex-1 flex items-center gap-2 text-left min-w-0"
                  >
                    <ChevronRight
                      className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform ${expanded === s.id ? 'rotate-90' : ''}`}
                    />
                    <span className="text-sm truncate">{s.created_at}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {t('archive.filesCount', { count: s.files })}
                    </span>
                    <span className="text-[11px] text-muted-foreground/60 shrink-0">
                      {(s.size / 1024).toFixed(0)} KB
                    </span>
                  </button>
                  <button
                    onClick={() => handleRestoreAll(s.id)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] border hover:bg-muted transition-colors shrink-0"
                    title={t('archive.restoreAll')}
                  >
                    <RotateCcw className="w-3 h-3" />
                    {t('archive.restoreAll')}
                  </button>
                </div>
                {expanded === s.id && (
                  <div className="border-t px-3 py-2 max-h-64 overflow-y-auto">
                    {filesLoading ? (
                      <p className="text-xs text-muted-foreground py-2">{t('archive.loading')}</p>
                    ) : files.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">{t('archive.noFiles')}</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {files.map(f => (
                          <li key={f} className="flex items-center gap-2 text-xs">
                            <span className="flex-1 truncate font-mono text-[11px]">{f}</span>
                            <button
                              onClick={() => handleRestoreFile(s.id, f)}
                              className="px-1.5 py-0.5 rounded border hover:bg-muted transition-colors shrink-0 text-[11px]"
                            >
                              {t('archive.restore')}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

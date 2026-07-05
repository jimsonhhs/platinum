import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { app } from '@/hooks/useApp'
import { EventsOn } from '@/lib/wailsjs/runtime/runtime'

export type ImportProgressStage =
  | 'idle'
  | 'select_file'
  | 'parse'
  | 'create_novel'
  | 'write_chapters'
  | 'commit'
  | 'done'
  | 'error'

export interface ImportProgressState {
  stage: ImportProgressStage
  message: string
  current: number
  total: number
  percent: number
  novel_id?: number
}

const INITIAL_IMPORT_PROGRESS: ImportProgressState = {
  stage: 'idle',
  message: '',
  current: 0,
  total: 0,
  percent: 0,
}

interface UseImportNovelOptions {
  app: {
    ImportNovel: (input: app.ImportNovelInput) => Promise<app.ImportNovelResult>
    PickAndImportNovel: () => Promise<app.ImportNovelResult>
  }
  onImported: (result: app.ImportNovelResult) => Promise<void>
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

export function useImportNovel({ app, onImported }: UseImportNovelOptions) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [progress, setProgress] = useState<ImportProgressState>({ ...INITIAL_IMPORT_PROGRESS, message: t('novel.importPreparing2') })
  const [error, setError] = useState('')
  const [skippedCount, setSkippedCount] = useState(0)
  const [skippedChapters, setSkippedChapters] = useState<{ title: string; reason: string }[]>([])

  useEffect(() => {
    const unsubscribe = EventsOn('import:progress', (data: ImportProgressState) => {
      setProgress({
        stage: data.stage,
        message: data.message,
        current: data.current ?? 0,
        total: data.total ?? 0,
        percent: data.percent ?? 0,
        novel_id: data.novel_id,
      })
      if (data.stage === 'error') {
        setError(data.message)
      }
    })
    return unsubscribe
  }, [])

  const reset = useCallback(() => {
    setOpen(false)
    setError('')
    setSkippedCount(0)
    setSkippedChapters([])
    setProgress({ ...INITIAL_IMPORT_PROGRESS, message: t('novel.importPreparing2') })
  }, [t])

  const startImport = useCallback(async (filePath?: string) => {
    setError('')
    setProgress({
      ...INITIAL_IMPORT_PROGRESS,
      stage: filePath ? 'parse' : 'select_file',
      message: filePath ? t('novel.importParsing2') : t('novel.importSelectFile2'),
    })
    setOpen(true)

    let result: app.ImportNovelResult | null
    try {
      result = filePath
        ? await app.ImportNovel({ file_path: filePath })
        : await app.PickAndImportNovel()
    } catch (err: unknown) {
      setProgress(prev => ({
        ...prev,
        stage: 'error',
        message: t('novel.importRollbackDone'),
        percent: 100,
      }))
      setError(errorMessage(err, t('novel.importFailedRetry')))
      return
    }

    if (!result) {
      reset()
      return
    }

    setSkippedCount(result.skipped_count ?? 0)
    setSkippedChapters(result.skipped_chapters ?? [])

    try {
      await onImported(result)
    } catch (err: unknown) {
      setError(errorMessage(err, t('novel.importFailedRetry')))
    }
  }, [app, onImported, reset, t])

  return {
    startImport,
    dialogProps: {
      open,
      progress,
      error,
      skippedCount,
      skippedChapters,
      onClose: reset,
    },
  }
}

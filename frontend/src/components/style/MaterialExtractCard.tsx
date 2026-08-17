import { useState, useEffect, useRef } from 'react'
import { FileUp, Sparkles, Loader2, CheckCircle2, BookOpen, Brain, ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '@/hooks/useApp'
import { toastError, toastSuccess } from '@/lib/utils'
import { EventsOn } from '@/lib/wailsjs/runtime/runtime'

interface MaterialChapter { index: number; title: string }
interface MaterialMeta { file_path: string; file_name: string; chapters: MaterialChapter[] }

// 推导过程条目（纯实时，不持久化）
interface ProgressItem {
  id: number
  kind: 'stats' | 'thinking' | 'content'
  text: string
}

// 从素材文件提取文风的简洁入口：选素材 → 起止章 → 提取 → 保存技能
export default function MaterialExtractCard() {
  const { t } = useTranslation()
  const app = useApp()
  const [material, setMaterial] = useState<MaterialMeta | null>(null)
  const [startIdx, setStartIdx] = useState(1)
  const [endIdx, setEndIdx] = useState(1)
  const [extracting, setExtracting] = useState(false)
  const [modelKey, setModelKey] = useState('')
  const [result, setResult] = useState<{ name: string; filePath: string; rawContent: string } | null>(null)
  const [savingLib, setSavingLib] = useState(false)
  const [savedLib, setSavedLib] = useState(false)
  // 推导过程（实时流，只读展示，不持久化）
  const [progressItems, setProgressItems] = useState<ProgressItem[]>([])
  const [showProgress, setShowProgress] = useState(false)
  const [thinkingOpen, setThinkingOpen] = useState(true)
  const progressRef = useRef<{ items: ProgressItem[]; nextId: number }>({ items: [], nextId: 1 })

  useEffect(() => {
    let cancelled = false
    app.GetSettings().then(s => {
      if (cancelled) return
      let key = s?.selected_model_key || ''
      app.GetModels().then(list => {
        if (cancelled) return
        if (!list?.find((m: any) => m.Key === key)) key = list?.[0]?.Key || ''
        setModelKey(key)
      })
    })
    return () => { cancelled = true }
  }, [app])

  // 订阅后端 style:extract-progress 事件（按 task_id 过滤）
  useEffect(() => {
    let taskIdRef: string | null = null
    const unsub = EventsOn('style:extract-progress', (data: any) => {
      if (!taskIdRef || data?.task_id !== taskIdRef) return
      const kind = data.kind
      if (kind === 'stats') {
        pushProgress('stats', data.stage_msg || data.data || '')
        if (data.data) pushProgress('stats', data.data)
      } else if (kind === 'thinking' && data.data) {
        pushProgress('thinking', data.data)
      } else if (kind === 'content' && data.data) {
        pushProgress('content', data.data)
      }
    })
    function pushProgress(kind: ProgressItem['kind'], text: string) {
      const r = progressRef.current
      // 相邻同类追加（流式增量合并），思考/内容分块
      const last = r.items[r.items.length - 1]
      if (last && last.kind === kind) {
        last.text += text
      } else {
        r.items.push({ id: r.nextId++, kind, text })
      }
      setProgressItems([...r.items])
    }
    // 暴露给 handleExtract 设置 taskId
    ;(window as any).__styleProgressSetTask = (id: string) => { taskIdRef = id }
    return () => { unsub(); (window as any).__styleProgressSetTask = undefined }
  }, [])

  async function handlePick() {
    try {
      const meta = await app.SelectMaterialFile()
      if (!meta) return
      setMaterial(meta)
      setStartIdx(1)
      setEndIdx(meta.chapters?.length || 1)
      setResult(null)
      } catch (err) {
      toastError(String(err))
    }
  }

  async function handleExtract() {
    if (!material || !modelKey) return
    setExtracting(true)
    setResult(null)
    setSavedLib(false)
    // 重置推导过程并显示面板
    progressRef.current = { items: [], nextId: 1 }
    setProgressItems([])
    setThinkingOpen(true)
    setShowProgress(true)
    try {
      const [providerName, modelID] = modelKey.split('/')
      const taskId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'mat-' + Date.now()
      ;(window as any).__styleProgressSetTask?.(taskId)
      const res = await app.ExtractMaterialStyle({
        task_id: taskId,
        file_path: material.file_path,
        start_index: startIdx,
        end_index: endIdx,
        provider_name: providerName || '',
        model_id: modelID || '',
        reasoning_effort: '',
      })
      setResult(res ? { name: res.name, filePath: res.file_path, rawContent: res.raw_content } : null)
    } catch (err) {
      toastError(t('styleSample.extractFailed') + ': ' + (err instanceof Error ? err.message : String(err)))
      console.error(err)
    } finally {
      setExtracting(false)
      ;(window as any).__styleProgressSetTask?.(null)
    }
  }

  async function handleSaveToLibrary() {
    if (!result) return
    setSavingLib(true)
    setSavedLib(false)
    try {
      const fileName = await app.SaveStyleToLibrary(result.name.replace(/\.md$/, ''), result.rawContent)
      setSavedLib(true)
      window.dispatchEvent(new CustomEvent('platinum:style-library-changed'))
      toastSuccess(t('styleSample.savedLibDone') + `：${fileName}`)
    } catch (err) {
      toastError(String(err))
    } finally {
      setSavingLib(false)
    }
  }

  return (
    <div className="border rounded-lg p-3 space-y-2.5 bg-background">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Sparkles className="w-3.5 h-3.5 text-primary" />
        {t('styleSample.fromFile')}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handlePick}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs border hover:bg-muted transition-colors"
        >
          <FileUp className="w-3.5 h-3.5" />
          {t('styleSample.pickMaterial')}
        </button>
        {material && (
          <span className="text-xs text-muted-foreground truncate flex items-center gap-1 min-w-0">
            <BookOpen className="w-3 h-3 shrink-0" />
            <span className="truncate">{material.file_name}</span>
            <span className="shrink-0">（{material.chapters?.length ?? 0} 章）</span>
          </span>
        )}
      </div>

      {material && (
        <>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-muted-foreground shrink-0">{t('styleSample.fromChapter')}</label>
            <select
              value={startIdx}
              onChange={e => { const v = Number(e.target.value); setStartIdx(v); if (v > endIdx) setEndIdx(v) }}
              className="flex-1 h-7 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {material.chapters.map(c => (
                <option key={c.index} value={c.index}>{c.index}. {c.title}</option>
              ))}
            </select>
            <label className="text-[11px] text-muted-foreground shrink-0">{t('styleSample.toChapter')}</label>
            <select
              value={endIdx}
              onChange={e => { const v = Number(e.target.value); setEndIdx(v); if (v < startIdx) setStartIdx(v) }}
              className="flex-1 h-7 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {material.chapters.map(c => (
                <option key={c.index} value={c.index}>{c.index}. {c.title}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExtract}
              disabled={extracting || !modelKey}
              className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {extracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {extracting ? t('styleSample.extracting') : t('styleSample.extract')}
            </button>
            {!modelKey && <span className="text-[11px] text-muted-foreground">{t('styleSample.needModel')}</span>}
          </div>
        </>
      )}

      {/* AI 推导过程（只读实时流，不持久化） */}
      {showProgress && (
        <div className="border rounded-md bg-muted/20">
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b">
            <span className="text-[11px] font-medium flex items-center gap-1.5">
              <Brain className="w-3.5 h-3.5 text-primary" />
              {t('styleSample.aiTrace')}
              {extracting && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
            </span>
            <button
              onClick={() => setShowProgress(false)}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('common.close')}
            </button>
          </div>
          <div className="p-2.5 space-y-2 max-h-64 overflow-y-auto">
            {progressItems.length === 0 && extracting && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                {t('styleSample.aiTraceWaiting')}
              </p>
            )}
            {progressItems.map(item => (
              <div key={item.id}>
                {item.kind === 'stats' && (
                  <div className="text-[10px] text-muted-foreground border border-border rounded px-2 py-1 bg-background/60 whitespace-pre-wrap">{item.text}</div>
                )}
                {item.kind === 'thinking' && (
                  <div className="border border-dashed border-border rounded">
                    <button
                      onClick={() => setThinkingOpen(v => !v)}
                      className="w-full flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {thinkingOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      {t('styleSample.aiThinking')}
                    </button>
                    {thinkingOpen && (
                      <div className="px-2 pb-1.5 text-[11px] text-muted-foreground whitespace-pre-wrap max-h-40 overflow-y-auto">{item.text}</div>
                    )}
                  </div>
                )}
                {item.kind === 'content' && (
                  <div className="text-[11px] whitespace-pre-wrap border-l-2 border-primary/40 pl-2">{item.text}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {result && (
        <div className="border rounded-md p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium flex items-center gap-1.5 truncate">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
              {result.name}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={handleSaveToLibrary}
                disabled={savingLib || savedLib}
                className="inline-flex items-center gap-1 h-7 px-3 rounded-md text-xs border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {savingLib ? <Loader2 className="w-3 h-3 animate-spin" /> : savedLib ? <CheckCircle2 className="w-3 h-3 text-green-600" /> : null}
                {savedLib ? t('styleSample.savedLib') : t('styleSample.saveToLib')}
              </button>
            </div>
          </div>
          {/* 提取产物预览（md） */}
          <div className="border rounded-md p-2.5 max-h-48 overflow-y-auto">
            <pre className="text-[11px] whitespace-pre-wrap font-serif">{result.rawContent}</pre>
          </div>
          <p className="text-[11px] text-muted-foreground">{t('styleSample.savedHint')}</p>
        </div>
      )}
    </div>
  )
}

import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, Trash2, BookOpen, Camera, Download, Upload } from 'lucide-react'
import BookCover from '@/components/sidebar/BookCover'
import type { novel } from '@/hooks/useApp'

interface Props {
  novels: novel.Novel[]
  activeNovelId: number
  onSelectNovel: (n: novel.Novel) => void
  onEditNovel: (n: novel.Novel) => void
  onDeleteNovel: (n: novel.Novel) => void
  onCreateNovel: () => void
  onSaveCover: (novelID: number, file: File) => Promise<void>
  onExportNovel: (n: novel.Novel) => void
  onImportNovel: () => void
}

export default function BookshelfView({
  novels, activeNovelId,
  onSelectNovel, onEditNovel, onDeleteNovel, onCreateNovel,
  onSaveCover, onExportNovel, onImportNovel,
}: Props) {
  const { t } = useTranslation()
  const [coverKeys, setCoverKeys] = useState<Record<number, number>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadingRef = useRef<number | null>(null)

  function handleCoverClick(novelID: number, e: React.MouseEvent) {
    e.stopPropagation()
    uploadingRef.current = novelID
    fileInputRef.current?.click()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || uploadingRef.current == null) return
    const novelID = uploadingRef.current
    uploadingRef.current = null
    // 清空 input 以便重复选同一文件
    e.target.value = ''
    await onSaveCover(novelID, file)
    setCoverKeys(prev => ({ ...prev, [novelID]: Date.now() })) // 用时间戳强制刷新封面（img 缓存保险）
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      {/* 隐藏文件选择器 */}
      <input
        ref={fileInputRef}
        type="file" accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
        <span className="text-sm text-muted-foreground">
          {t('novel.totalWorks', { count: novels.length })}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onImportNovel}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm border hover:bg-muted transition-colors"
          >
            <Upload className="w-4 h-4" />
            {t('novel.importBook')}
          </button>
          <button
            onClick={onCreateNovel}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            {t('novel.newWork')}
          </button>
        </div>
      </div>

      {/* 空状态 */}
      {novels.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
          <BookOpen className="w-12 h-12 opacity-30" />
          <p className="text-sm">{t('novel.noWorksYet')}</p>
        </div>
      ) : (
        /* 书架网格 */
        <div className="flex-1 overflow-y-auto overscroll-contain p-6">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-5">
            {novels.map(n => (
              <div
                key={n.id}
                className={`group relative flex flex-col rounded-lg border bg-card hover:shadow-md transition-shadow cursor-pointer select-none
                  ${n.id === activeNovelId ? 'ring-2 ring-primary' : ''}`}
              >
                {/* 顶部常驻工具条（独立区域，不与封面重叠，带文字说明） */}
                <div className="flex items-center gap-1 px-2 py-1.5 border-b bg-muted/30 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCoverClick(n.id, e) }}
                    className="inline-flex items-center gap-1 h-6 px-1.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title={t('novel.changeCover')}
                  >
                    <Camera className="w-3 h-3" />
                    {t('novel.changeCover')}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onExportNovel(n) }}
                    className="inline-flex items-center gap-1 h-6 px-1.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title={t('novel.export')}
                  >
                    <Download className="w-3 h-3" />
                    {t('novel.export')}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onEditNovel(n) }}
                    className="inline-flex items-center gap-1 h-6 px-1.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title={t('novel.edit')}
                  >
                    <Pencil className="w-3 h-3" />
                    {t('novel.edit')}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteNovel(n) }}
                    className="inline-flex items-center gap-1 h-6 px-1.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted hover:text-red-500 transition-colors"
                    title={t('novel.delete')}
                  >
                    <Trash2 className="w-3 h-3" />
                    {t('novel.delete')}
                  </button>
                </div>

                {/* 点击卡片主体切换书 */}
                <div
                  className="flex flex-col flex-1 p-3"
                  onClick={() => onSelectNovel(n)}
                >
                  <div className="w-full aspect-[3/4] mb-3 rounded-sm overflow-hidden relative">
                    <BookCover novelId={n.id} refreshKey={coverKeys[n.id]} />
                  </div>
                  <h3 className="text-sm font-medium truncate mb-1">{n.title}</h3>
                  {n.genre ? (
                    <span className="inline-block self-start text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary mb-1.5">
                      {n.genre}
                    </span>
                  ) : (
                    <span className="inline-block self-start text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground mb-1.5">
                      {t('novel.uncategorized')}
                    </span>
                  )}
                  {n.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {n.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from '@/hooks/useApp'
import { useTheme } from '@/hooks/useTheme'
import { Toaster } from 'sonner'
import InitView from '@/views/InitView'
import WorkspaceView from '@/views/WorkspaceView'

// 全局主题救援按钮：文字/背景对比度过低（同色）时，角落常驻黑底白字按钮，保证永远能恢复默认。
function ThemeRescueButton() {
  const { t } = useTranslation()
  const { themeBg, themeFg, setThemeBg, setThemeFg, setThemeBorder } = useTheme()
  const [lowContrast, setLowContrast] = useState(false)

  useEffect(() => {
    if (!themeFg || !themeBg) { setLowContrast(false); return }
    // 计算相对亮度（W3C 近似）
    const lum = (hex: string) => {
      const c = hex.replace('#', '')
      if (c.length < 6) return 0.5
      const r = parseInt(c.slice(0, 2), 16) / 255
      const g = parseInt(c.slice(2, 4), 16) / 255
      const b = parseInt(c.slice(4, 6), 16) / 255
      const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const l1 = lum(themeFg), l2 = lum(themeBg)
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    setLowContrast(ratio < 2)
  }, [themeFg, themeBg])

  if (!lowContrast) return null
  return (
    <button
      onClick={() => { setThemeFg(''); setThemeBg(''); setThemeBorder('') }}
      className="fixed bottom-4 right-4 z-[9999] inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-medium shadow-xl transition-transform hover:scale-105"
      style={{ background: '#111111', color: '#ffffff', border: '1px solid #ffffff' }}
    >
      <RotateCcwIcon />
      {t('settings.restoreDefault')}
    </button>
  )
}

function RotateCcwIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  )
}

type View = 'loading' | 'init' | 'workspace'

export default function App() {
  const { t } = useTranslation()
  const [view, setView] = useState<View>('loading')
  const [initialNovelId, setInitialNovelId] = useState(0)
  const [fromInit, setFromInit] = useState(false)
  const app = useApp()

  useEffect(() => {
    app.IsInitialized().then(async (ok) => {
      if (ok) {
        const settings = await app.GetSettings()
        setInitialNovelId(settings?.last_novel_id ?? 0)
        setView('workspace')
      } else {
        setView('init')
      }
    }).catch((err) => {
      console.error('App initialization failed', err)
      setView('init')
    })
  }, [app])

  if (view === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <p className="text-muted-foreground">{t('app.loading')}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ThemeRescueButton />
      <Toaster position="top-center" richColors toastOptions={{ actionButtonStyle: { backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)', border: 'none', padding: '2px 10px', borderRadius: '4px', fontSize: '12px' } }} />
      {view === 'init' && (
        <InitView onInitialized={async () => {
          const settings = await app.GetSettings()
          setInitialNovelId(settings?.last_novel_id ?? 0)
          setFromInit(true)
          setView('workspace')
        }} />
      )}
      {view === 'workspace' && (
        <WorkspaceView initialNovelId={initialNovelId} initialShowHelp={fromInit} />
      )}
    </div>
  )
}

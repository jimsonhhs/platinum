import { useState, useEffect, useCallback } from 'react'

const ATTR = 'data-theme'

export const THEMES = ['light', 'dark', 'eye-care', 'black-yellow', 'pink-soft', 'warm-gray', 'cool-gray-blue', 'soft-yellow'] as const
export type Theme = (typeof THEMES)[number]

function isTheme(s: string | null): s is Theme {
  return THEMES.includes(s as Theme)
}

// 主界面右上角快速切换：只在浅/深/护眼/黑黄 4 个之间循环（其余 4 个在设置里选）
const NEXT: Record<Theme, Theme> = {
  light: 'dark',
  dark: 'eye-care',
  'eye-care': 'black-yellow',
  'black-yellow': 'light',
  'pink-soft': 'light',
  'warm-gray': 'light',
  'cool-gray-blue': 'light',
  'soft-yellow': 'light',
}

function sysTheme(matches: boolean): Theme {
  if (matches) return 'dark'
  return 'light'
}

function resolveTheme(): Theme {
  const stored = localStorage.getItem('theme')
  if (isTheme(stored)) return stored
  return sysTheme(window.matchMedia('(prefers-color-scheme: dark)').matches)
}

function applyTheme(t: Theme) {
  document.documentElement.setAttribute(ATTR, t)
}

// 主题背景色（用户自定义，覆盖各主题默认 --background；空=用主题默认）
function resolveThemeBg(): string {
  return localStorage.getItem('themeBg') || ''
}

function applyThemeBg(bg: string) {
  if (bg) document.documentElement.style.setProperty('--background', bg)
  else document.documentElement.style.removeProperty('--background')
}

// 主题边框色（覆盖 --border/--input/--ring）
function resolveThemeBorder(): string {
  return localStorage.getItem('themeBorder') || ''
}
function applyThemeBorder(c: string) {
  const set = (k: string) => {
    if (c) document.documentElement.style.setProperty(k, c)
    else document.documentElement.style.removeProperty(k)
  }
  set('--border'); set('--input'); set('--ring')
}

// 系统文字色（覆盖 --foreground/--muted-foreground）
function resolveThemeFg(): string {
  return localStorage.getItem('themeFg') || ''
}
function applyThemeFg(c: string) {
  const set = (k: string) => {
    if (c) document.documentElement.style.setProperty(k, c)
    else document.documentElement.style.removeProperty(k)
  }
  set('--foreground')
  set('--muted-foreground')
}

// 全局字体（body font-family）
function resolveThemeFont(): string {
  return localStorage.getItem('themeFont') || ''
}
function applyThemeFont(f: string) {
  if (f) document.body.style.fontFamily = f
  else document.body.style.removeProperty('font-family')
}

// 全局字号（body font-size，px）
function resolveThemeFontSize(): string {
  return localStorage.getItem('themeFontSize') || ''
}
function applyThemeFontSize(px: string) {
  if (px) document.body.style.fontSize = px + 'px'
  else document.body.style.removeProperty('font-size')
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const t = resolveTheme()
    applyTheme(t)
    return t
  })

  // 跨组件同步：任一组件设置 → DOM 属性变化 → 所有监听者更新
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const v = document.documentElement.getAttribute(ATTR)
      if (isTheme(v)) setThemeState(v)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [ATTR] })
    return () => observer.disconnect()
  }, [])

  const [themeBg, setThemeBgState] = useState<string>(() => {
    const bg = resolveThemeBg()
    applyThemeBg(bg)
    return bg
  })
  const [themeBorder, setThemeBorderState] = useState<string>(() => {
    const c = resolveThemeBorder()
    applyThemeBorder(c)
    return c
  })
  const [themeFg, setThemeFgState] = useState<string>(() => {
    const c = resolveThemeFg()
    applyThemeFg(c)
    return c
  })
  const [themeFont, setThemeFontState] = useState<string>(() => {
    const f = resolveThemeFont()
    applyThemeFont(f)
    return f
  })
  const [themeFontSize, setThemeFontSizeState] = useState<string>(() => {
    const s = resolveThemeFontSize()
    applyThemeFontSize(s)
    return s
  })

  const setThemeBg = useCallback((bg: string) => {
    localStorage.setItem('themeBg', bg)
    applyThemeBg(bg)
    setThemeBgState(bg)
  }, [])
  const setThemeBorder = useCallback((c: string) => {
    localStorage.setItem('themeBorder', c)
    applyThemeBorder(c)
    setThemeBorderState(c)
  }, [])
  const setThemeFg = useCallback((c: string) => {
    localStorage.setItem('themeFg', c)
    applyThemeFg(c)
    setThemeFgState(c)
  }, [])
  const setThemeFont = useCallback((f: string) => {
    localStorage.setItem('themeFont', f)
    applyThemeFont(f)
    setThemeFontState(f)
  }, [])
  const setThemeFontSize = useCallback((s: string) => {
    localStorage.setItem('themeFontSize', s)
    applyThemeFontSize(s)
    setThemeFontSizeState(s)
  }, [])

  // 主题切换时若已自定义，保持覆盖（不重置）
  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem('theme', t)
    applyTheme(t)
    setThemeState(t)
    applyThemeBg(resolveThemeBg())
    applyThemeBorder(resolveThemeBorder())
    applyThemeFg(resolveThemeFg())
    applyThemeFont(resolveThemeFont())
    applyThemeFontSize(resolveThemeFontSize())
  }, [])

  const toggle = useCallback(() => {
    setTheme(NEXT[resolveTheme()])
  }, [setTheme])

  return { theme, themeBg, themeBorder, themeFg, themeFont, themeFontSize, setTheme, setThemeBg, setThemeBorder, setThemeFg, setThemeFont, setThemeFontSize, toggle }
}

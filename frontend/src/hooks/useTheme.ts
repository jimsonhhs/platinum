import { useState, useEffect, useCallback } from 'react'

const ATTR = 'data-theme'

export const THEMES = ['light', 'dark', 'eye-care', 'black-yellow'] as const
export type Theme = (typeof THEMES)[number]

function isTheme(s: string | null): s is Theme {
  return THEMES.includes(s as Theme)
}

// 循环切换顺序
const NEXT: Record<Theme, Theme> = {
  light: 'dark',
  dark: 'eye-care',
  'eye-care': 'black-yellow',
  'black-yellow': 'light',
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

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem('theme', t)
    applyTheme(t)
    setThemeState(t)
  }, [])

  const toggle = useCallback(() => {
    setTheme(NEXT[resolveTheme()])
  }, [setTheme])

  return { theme, setTheme, toggle }
}

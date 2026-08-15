import { useSyncExternalStore } from 'react'
import { getPrefs, subscribePrefs, type EditorPrefs } from '@/lib/editorTheme'

// 响应式读取编辑器偏好（字号/字体/自定义颜色），设置页修改后全局即时生效。
export function useEditorPrefs(): EditorPrefs {
  return useSyncExternalStore(subscribePrefs, getPrefs)
}

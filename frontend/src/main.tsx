import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import './index.css'
import './i18n'
import App from './App.tsx'

// 全局异步失败兜底：任何未捕获的 Promise 拒绝都提示用户，杜绝静默失败。
// 各业务代码仍应自带 try/catch + 具体错误信息；这里兜底漏网之鱼。
window.addEventListener('unhandledrejection', (e) => {
  const err = e.reason
  const msg = err instanceof Error ? err.message : String(err ?? '未知错误')
  // 忽略用户主动取消类的错误（如 AbortError / CanceledError）
  if (/cancel|abort|取消/i.test(msg)) return
  toast.error(`操作失败：${msg}`)
  console.error('[unhandledrejection]', err)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

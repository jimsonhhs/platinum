package agentcfg

import (
	"sync"
)

// ── 当前打开章节（内存态，重启后由前端重新上报）──────────

var (
	curChapterMu sync.RWMutex
	curChapter   = map[int64]int{} // novelID → chapter_number
)

// SetCurrentChapter 记录当前打开的章节号（前端切换章节时调用）。
func SetCurrentChapter(novelID int64, num int) {
	curChapterMu.Lock()
	defer curChapterMu.Unlock()
	if num <= 0 {
		delete(curChapter, novelID)
	} else {
		curChapter[novelID] = num
	}
}

// GetCurrentChapter 返回当前打开的章节号（0=无）。
func GetCurrentChapter(novelID int64) int {
	curChapterMu.RLock()
	defer curChapterMu.RUnlock()
	return curChapter[novelID]
}

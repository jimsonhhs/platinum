package app

import (
	"novel/internal/agentcfg"
)

// ── 当前打开章节（"本章"注入）────────────────────────────

// SetCurrentChapter 记录当前打开的章节号（前端切换章节时调用）。
func (a *App) SetCurrentChapter(novelID int64, chapterNumber int) error {
	agentcfg.SetCurrentChapter(novelID, chapterNumber)
	return nil
}

// GetCurrentChapter 返回当前打开的章节号。
func (a *App) GetCurrentChapter(novelID int64) (int, error) {
	return agentcfg.GetCurrentChapter(novelID), nil
}

package app

import (
	"fmt"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"novel/internal/chapter"
	"novel/internal/draft"
	"novel/internal/git"
	"novel/internal/text"
)

// historyLimit 返回设置中的历史保留上限（0 或非法值回退默认）。
func (a *App) historyLimit() int {
	if a.settings != nil && a.settings.HistoryLimit > 0 {
		return a.settings.HistoryLimit
	}
	return draft.DefaultLimit
}

// CopyToDraft 把正文文件级复制为草稿（初始化工作稿；草稿已有内容自动归档历史）。
func (a *App) CopyToDraft(novelID int64, chapterNumber int) error {
	if novelID <= 0 || chapterNumber <= 0 {
		return fmt.Errorf("参数无效")
	}
	if err := draft.CopyToDraft(novelID, chapterNumber, a.historyLimit()); err != nil {
		return err
	}
	runtime.EventsEmit(a.ctx, "file:changed", map[string]any{
		"novel_id": novelID,
		"path":     git.DraftPath(chapterNumber),
		"draft":    true,
	})
	return nil
}

// ImportDraft 把草稿发布为正文：归档当前正文到历史、草稿覆盖正文、重建索引/字数并提交。
func (a *App) ImportDraft(novelID int64, chapterNumber int) error {
	if novelID <= 0 || chapterNumber <= 0 {
		return fmt.Errorf("参数无效")
	}
	if err := draft.ImportDraft(a.chapter.DB, novelID, chapterNumber, a.historyLimit()); err != nil {
		return err
	}

	content, err := git.ReadFile(novelID, git.ChapterPath(chapterNumber))
	if err != nil {
		return fmt.Errorf("读取正文失败: %w", err)
	}

	// 搜索缓存
	if svc := a.searchService.Load(); svc != nil {
		svc.UpdateCachedChapter(novelID, chapterNumber, content)
	}

	// 写作统计修正
	stats := text.ComputeStats(content)
	var oldWC int
	var chapID int64
	a.chapter.DB.WithContext(a.ctx).
		Model(&chapter.Chapter{}).
		Select("COALESCE(word_count, 0)").
		Where("novel_id = ? AND chapter_number = ?", novelID, chapterNumber).Scan(&oldWC)
	a.chapter.DB.WithContext(a.ctx).
		Model(&chapter.Chapter{}).
		Select("id").
		Where("novel_id = ? AND chapter_number = ?", novelID, chapterNumber).Scan(&chapID)
	if delta := stats.WordCount - oldWC; delta != 0 && a.writing != nil && chapID > 0 {
		a.writing.LogDelta(a.ctx, novelID, chapID, delta)
	}

	// git 提交
	if repo, err := git.New(novelID, a.settings.GitName, a.settings.GitEmail, a.logger); err == nil {
		if err := repo.StageAll(); err == nil {
			if _, err := repo.Commit(fmt.Sprintf("导入草稿到第%d章", chapterNumber)); err != nil {
				a.logger.Warn("导入草稿后 git 提交失败", "err", err)
			}
		}
	}

	runtime.EventsEmit(a.ctx, "file:changed", map[string]any{
		"novel_id": novelID,
		"path":     git.ChapterPath(chapterNumber),
		"imported": true,
	})
	return nil
}

// ArchiveHistory 把 relPath 当前内容归档为历史版本（离开页面时调用；相同内容自动跳过）。
func (a *App) ArchiveHistory(novelID int64, relPath string) error {
	if novelID <= 0 || relPath == "" {
		return fmt.Errorf("参数无效")
	}
	_, err := draft.ArchiveCurrent(novelID, relPath, a.historyLimit())
	return err
}

// ListHistory 返回某文件的历史版本（时间倒序，含字数/时间）。
func (a *App) ListHistory(novelID int64, relPath string) ([]draft.HistoryEntry, error) {
	if novelID <= 0 || relPath == "" {
		return nil, fmt.Errorf("参数无效")
	}
	return draft.ListHistory(novelID, relPath)
}

// RestoreHistory 把指定历史版本恢复到目标文件（当前内容自动归档）。
func (a *App) RestoreHistory(novelID int64, relPath, fileName string) error {
	if novelID <= 0 || relPath == "" || fileName == "" {
		return fmt.Errorf("参数无效")
	}
	if err := draft.RestoreHistory(novelID, relPath, fileName, a.historyLimit()); err != nil {
		return err
	}
	runtime.EventsEmit(a.ctx, "file:changed", map[string]any{
		"novel_id": novelID,
		"path":     relPath,
	})
	return nil
}

package app

import (
	"fmt"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	imp "novel/internal/import"
)

// ImportNovelInput 是导入小说的入参。
type ImportNovelInput struct {
	FilePath string `json:"file_path"`
}

// ImportNovelResult 是导入小说的返回结果。
type ImportNovelResult struct {
	NovelID         int64                 `json:"novel_id"`
	Title           string                `json:"title"`
	ChapterCount    int                   `json:"chapter_count"`
	SkippedCount    int                   `json:"skipped_count"`
	SkippedChapters []imp.SkippedChapter  `json:"skipped_chapters"`
}

// ImportProgress 是导入过程的前端进度事件。
type ImportProgress struct {
	Stage   string `json:"stage"`
	Message string `json:"message"`
	Current int    `json:"current"`
	Total   int    `json:"total"`
	Percent int    `json:"percent"`
	NovelID int64  `json:"novel_id,omitempty"`
}

// ImportNovel 从文件导入一部小说：解析文件 → 创建 Novel → 写入章节文件 → Git 提交。
//
// 事务策略（参考 RollbackBeforeTurn 三步模式）：
//  1. 创建 Novel + 写文件 + git add（可逆操作，不 commit）
//  2. DB 事务写入 Chapters（原子操作）
//  3. git commit（不可逆但极低失败率，放在 DB 成功之后）
func (a *App) ImportNovel(input ImportNovelInput) (*ImportNovelResult, error) {
	res, err := imp.Import(a.ctx, a.logger, a.novel.DB, input.FilePath, a.settings.GitName, a.settings.GitEmail, a.emitImportProgress)
	if err != nil {
		return nil, err
	}
	return &ImportNovelResult{
		NovelID:         res.NovelID,
		Title:           res.Title,
		ChapterCount:    res.ChapterCount,
		SkippedCount:    res.SkippedCount,
		SkippedChapters: res.SkippedChapters,
	}, nil
}

func (a *App) emitImportProgress(stage, message string, current, total, percent int, novelID int64) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "import:progress", ImportProgress{
		Stage:   stage,
		Message: message,
		Current: current,
		Total:   total,
		Percent: percent,
		NovelID: novelID,
	})
}

// PickAndImportNovel 打开文件选择对话框，然后导入选中的小说文件。
func (a *App) PickAndImportNovel() (*ImportNovelResult, error) {
	filePath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "导入小说",
		Filters: []runtime.FileFilter{
			{DisplayName: "电子书 (*.epub, *.txt, *.md)", Pattern: "*.epub;*.txt;*.md;*.markdown"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("选择文件失败: %w", err)
	}
	if filePath == "" {
		return nil, nil // 用户取消
	}

	return a.ImportNovel(ImportNovelInput{FilePath: filePath})
}

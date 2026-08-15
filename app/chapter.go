package app

import (
	"fmt"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"gorm.io/gorm"

	"novel/internal/chapter"
	"novel/internal/git"
	"novel/internal/novel"
	"novel/internal/rag"
	"novel/internal/trash"
)

// CreateChapterInput 是创建章节的入参。
type CreateChapterInput struct {
	NovelID int64  `json:"novel_id"`
	Title   string `json:"title"`
	Volume  int    `json:"volume"` // >0 在指定卷新建；0=最新卷
}

// ── 章节 ──────────────────────────────────────────────────

// GetChapters 返回指定小说的章节列表，含文件路径。
func (a *App) GetChapters(novelID int64) ([]chapter.Chapter, error) {
	chapters, err := a.chapter.ListAllByNovel(a.ctx, novelID)
	if err != nil {
		return nil, err
	}
	return chapters, nil
}

// DeleteChapterInput 是删除章节的入参。
// 章节号保留空洞不重排：重排会破坏弧线节点、时间线等对章节号的引用。
type DeleteChapterInput struct {
	NovelID       int64 `json:"novel_id"`
	ChapterNumber int   `json:"chapter_number"`
}

// DeleteChapter 删除章节：先移入回收站（可恢复），再清理 DB 记录 + 向量索引 + 搜索缓存 + 字数统计 + git 提交。
func (a *App) DeleteChapter(input DeleteChapterInput) error {
	if input.NovelID <= 0 || input.ChapterNumber <= 0 {
		return fmt.Errorf("删除章节参数无效")
	}

	// 1. 校验章节存在并取字数（用于修正写作统计）
	ch, err := a.chapter.GetByNovelAndNumber(a.ctx, input.NovelID, input.ChapterNumber)
	if err != nil {
		return fmt.Errorf("删除章节失败: %w", err)
	}

	// 1.5 读取正文并移入回收站（移入失败则中止，不删任何东西）
	content, err := git.ReadFile(input.NovelID, git.ChapterPath(input.ChapterNumber))
	if err == nil {
		if _, err := trash.MoveChapter(input.NovelID, input.ChapterNumber, ch.Title, ch.WordCount, content); err != nil {
			return fmt.Errorf("移入回收站失败: %w", err)
		}
	} else {
		a.logger.Warn("删除章节：正文文件不存在，跳过回收站", "novel_id", input.NovelID, "chapter", input.ChapterNumber, "err", err)
	}

	// 2. 删除 DB 记录
	if err := a.chapter.Delete(a.ctx, input.NovelID, input.ChapterNumber); err != nil {
		return fmt.Errorf("删除章节失败: %w", err)
	}

	// 3. 删除正文文件（已随移入回收站删除；若文件本就缺失则无操作）
	if err := git.DeleteFile(input.NovelID, git.ChapterPath(input.ChapterNumber)); err != nil {
		a.logger.Warn("删除章节文件失败", "novel_id", input.NovelID, "chapter", input.ChapterNumber, "err", err)
	}

	// 4. 清理向量索引
	if vs := rag.GetVectorStore(); vs != nil {
		if err := vs.DeleteChapterChunks(a.ctx, input.NovelID, input.ChapterNumber); err != nil {
			a.logger.Warn("删除章节向量失败", "novel_id", input.NovelID, "chapter", input.ChapterNumber, "err", err)
		}
	}

	// 5. 清理搜索缓存
	if svc := a.searchService.Load(); svc != nil {
		svc.RemoveCachedChapter(input.NovelID, input.ChapterNumber)
	}

	// 6. 修正字数统计（负增量会被 GetDailyActivity 过滤，不影响历史活跃度）
	if a.writing != nil && ch.WordCount > 0 {
		a.writing.LogDelta(a.ctx, input.NovelID, ch.ID, -ch.WordCount)
	}

	// 7. git 提交删除
	repo, err := git.New(input.NovelID, a.settings.GitName, a.settings.GitEmail, a.logger)
	if err != nil {
		a.logger.Warn("删除章节后 git 提交失败（打开仓库失败）", "err", err)
	} else if err := repo.StageAll(); err != nil {
		a.logger.Warn("删除章节后 git 提交失败（stage）", "err", err)
	} else if _, err := repo.Commit(fmt.Sprintf("删除第%d章", input.ChapterNumber)); err != nil {
		a.logger.Warn("删除章节后 git 提交失败（commit）", "err", err)
	}

	// 8. 通知前端刷新
	runtime.EventsEmit(a.ctx, "file:changed", map[string]any{
		"novel_id": input.NovelID,
		"path":     git.ChapterPath(input.ChapterNumber),
		"deleted":  true,
	})

	return nil
}

// GetMaxChapterNumber 返回该小说当前最大章节号，无章节时返回 0。前端确定写作进度用。
func (a *App) GetMaxChapterNumber(novelID int64) (int, error) {
	return a.chapter.GetLatestNumber(a.ctx, novelID)
}

// UpdateChapterTitle 更新章节标题。
func (a *App) UpdateChapterTitle(novelID int64, chapterNumber int, title string) error {
	return a.chapter.UpdateTitle(a.ctx, novelID, chapterNumber, title)
}

// CreateChapter 创建新章节，章节号由单调计数器分配（删除不回退，编号永不复用）。
// 同时创建空正文文件；卷默认第一卷，顺序追加到末尾。
func (a *App) CreateChapter(input CreateChapterInput) (*chapter.Chapter, error) {
	// 单调计数器：chapter_seq+1，删除不回退
	var n novel.Novel
	if err := a.novel.DB.WithContext(a.ctx).First(&n, input.NovelID).Error; err != nil {
		return nil, fmt.Errorf("create chapter: %w", err)
	}
	next := n.ChapterSeq + 1
	if next < 1 {
		next = 1
	}
	if err := a.novel.DB.WithContext(a.ctx).Model(&novel.Novel{}).
		Where("id = ?", input.NovelID).Update("chapter_seq", next).Error; err != nil {
		return nil, fmt.Errorf("create chapter: update seq: %w", err)
	}

	// 叙事顺序 = 当前最大 sort_order + 1（追加到末尾）
	var maxOrder float64
	_ = a.chapter.DB.WithContext(a.ctx).
		Model(&chapter.Chapter{}).
		Where("novel_id = ?", input.NovelID).
		Select("COALESCE(MAX(sort_order), 0)").Scan(&maxOrder).Error

	// 新章节创建在指定卷（input.Volume>0）或最新卷（最下方卷）；标题为空时默认文件号
	volCount := len(novel.ParseVolumes(n.Volumes))
	if volCount < 1 {
		volCount = 1
	}
	vol := input.Volume
	if vol < 1 {
		vol = volCount
	}
	title := input.Title
	if title == "" {
		title = fmt.Sprintf("%03d", next)
	}

	ch := chapter.Chapter{
		NovelID:           input.NovelID,
		ChapterNumber:     next,
		Title:             title,
		SortOrder:         maxOrder + 1,
		Volume:            vol,
		PrevChapterNumber: prevChapterByOrder(a.chapter.DB, input.NovelID, maxOrder+1),
	}

	if err := a.chapter.DB.WithContext(a.ctx).Create(&ch).Error; err != nil {
		return nil, fmt.Errorf("failed to create chapter: %w", err)
	}

	if err := git.WriteFile(input.NovelID, git.ChapterPath(ch.ChapterNumber), ""); err != nil {
		return nil, fmt.Errorf("failed to create chapter: %w", err)
	}

	ch.FilePath = git.ChapterPath(ch.ChapterNumber)

	return &ch, nil
}

// prevChapterByOrder 计算叙事顺序（sort_order）中小于当前 order 的最后一章的章号。
func prevChapterByOrder(db *gorm.DB, novelID int64, order float64) int {
	var ch chapter.Chapter
	if err := db.Where("novel_id = ? AND sort_order < ?", novelID, order).
		Order("sort_order DESC").First(&ch).Error; err == nil {
		return ch.ChapterNumber
	}
	return 0
}

package app

import (
	"fmt"
	"strconv"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"gorm.io/gorm"

	"novel/internal/chapter"
	"novel/internal/config"
	"novel/internal/git"
	"novel/internal/novel"
	"novel/internal/rag"
	"novel/internal/trash"
)

// TrashItemInput 定位回收站条目的入参（类型 + ID）。
type TrashItemInput struct {
	Type string `json:"type"` // "chapter" | "skill"
	ID   string `json:"id"`   // 条目 ID（文件名基准，含时间戳）
}

// ListTrashItems 返回指定小说的回收站条目（章节 + 小说级技能按 novelID 过滤；全局用户级技能一并显示）。
func (a *App) ListTrashItems(novelID int64) ([]trash.Item, error) {
	items, err := trash.List()
	if err != nil {
		return nil, err
	}
	filtered := items[:0]
	for _, it := range items {
		switch it.Type {
		case "chapter":
			if it.NovelID == novelID {
				filtered = append(filtered, it)
			}
		case "skill":
			if it.Source == "novel" {
				if it.NovelID == novelID {
					filtered = append(filtered, it)
				}
			} else {
				// 全局用户级技能：任何小说视图都可见，标注 source=user
				filtered = append(filtered, it)
			}
		}
	}
	return filtered, nil
}

// GetTrashItemContent 返回回收站条目的 md 内容（预览用）。
func (a *App) GetTrashItemContent(input TrashItemInput) (string, error) {
	item, err := findTrashItem(input)
	if err != nil {
		return "", err
	}
	return item.Content()
}

// RestoreTrashItem 把条目从回收站恢复到原始位置（章节会重建 DB 记录、向量索引并提交 git）。
func (a *App) RestoreTrashItem(input TrashItemInput) error {
	item, err := findTrashItem(input)
	if err != nil {
		return err
	}

	switch item.Type {
	case "chapter":
		return a.restoreChapter(item)
	case "skill":
		return a.restoreSkill(item)
	default:
		return fmt.Errorf("未知回收站条目类型: %s", item.Type)
	}
}

func (a *App) restoreChapter(item *trash.Item) error {
	chapNum, err := strconv.Atoi(item.Name)
	if err != nil || chapNum <= 0 {
		return fmt.Errorf("回收站章节号非法: %s", item.Name)
	}
	// 章节号被占用则拒绝恢复（避免覆盖）
	if _, err := a.chapter.GetByNovelAndNumber(a.ctx, item.NovelID, chapNum); err == nil {
		return fmt.Errorf("恢复失败：第%d章已存在", chapNum)
	}
	content, err := item.Content()
	if err != nil {
		return fmt.Errorf("读取回收站内容失败: %w", err)
	}
	rel, err := item.RestoreFiles(item.NovelID)
	if err != nil {
		return err
	}
	_ = rel

	// 重建 DB 记录
	var maxOrder float64
	_ = a.chapter.DB.WithContext(a.ctx).
		Model(&chapter.Chapter{}).
		Where("novel_id = ?", item.NovelID).
		Select("COALESCE(MAX(sort_order), 0)").Scan(&maxOrder).Error
	ch := chapter.Chapter{
		NovelID:       item.NovelID,
		ChapterNumber: chapNum,
		Title:         item.Title,
		WordCount:     item.WordCount,
		Volume:        1,              // 恢复到第一卷（原卷可能已删）
		SortOrder:     maxOrder + 1,   // 追加到末尾，不插队
	}
	if err := a.chapter.DB.WithContext(a.ctx).Create(&ch).Error; err != nil {
		return fmt.Errorf("恢复章节记录失败: %w", err)
	}

	// 同步单调计数器，避免后续新建章号冲突（删除不回退）
	_ = a.novel.DB.WithContext(a.ctx).Model(&novel.Novel{}).
		Where("id = ?", item.NovelID).
		Update("chapter_seq", gorm.Expr("GREATEST(chapter_seq, ?)", chapNum))

	// 重建向量索引 + 搜索缓存
	rag.SubmitRefresh(item.NovelID, chapNum, content)
	if svc := a.searchService.Load(); svc != nil {
		svc.UpdateCachedChapter(item.NovelID, chapNum, content)
	}

	// git 提交
	if repo, err := git.New(item.NovelID, a.settings.GitName, a.settings.GitEmail, a.logger); err == nil {
		if err := repo.StageAll(); err == nil {
			if _, err := repo.Commit(fmt.Sprintf("恢复第%d章", chapNum)); err != nil {
				a.logger.Warn("恢复章节后 git 提交失败", "err", err)
			}
		}
	}

	runtime.EventsEmit(a.ctx, "file:changed", map[string]any{
		"novel_id": item.NovelID,
		"path":     git.ChapterPath(chapNum),
		"restored": true,
	})
	return nil
}

func (a *App) restoreSkill(item *trash.Item) error {
	if _, err := item.RestoreFiles(0); err != nil {
		return err
	}
	if item.Source == "novel" {
		if err := a.skill.ReloadNovel(item.NovelID, config.NovelSkillsDir(item.NovelID)); err != nil {
			a.logger.Warn("恢复技能后重新加载小说级技能失败", "err", err)
		}
	} else {
		if err := a.skill.ReloadUser(config.UserSkillsDir()); err != nil {
			a.logger.Warn("恢复技能后重新加载用户级技能失败", "err", err)
		}
	}
	return nil
}

// PurgeTrashItem 彻底删除回收站条目（二次删除，不可恢复）。
func (a *App) PurgeTrashItem(input TrashItemInput) error {
	item, err := findTrashItem(input)
	if err != nil {
		return err
	}
	return item.Purge()
}

func findTrashItem(input TrashItemInput) (*trash.Item, error) {
	items, err := trash.List()
	if err != nil {
		return nil, fmt.Errorf("读取回收站失败: %w", err)
	}
	for i := range items {
		if items[i].Type == input.Type && items[i].ID == input.ID {
			return &items[i], nil
		}
	}
	return nil, fmt.Errorf("回收站中未找到该条目")
}

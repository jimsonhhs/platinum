package app

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gorm.io/gorm"

	"novel/internal/chapter"
	"novel/internal/config"
	"novel/internal/novel"
)

// ── 卷管理（虚拟分组，不改文件路径）──────────────────────

// GetVolumes 返回卷定义列表。
func (a *App) GetVolumes(novelID int64) ([]novel.Volume, error) {
	var n novel.Novel
	if err := a.novel.DB.WithContext(a.ctx).First(&n, novelID).Error; err != nil {
		return nil, fmt.Errorf("get volumes: %w", err)
	}
	return novel.ParseVolumes(n.Volumes), nil
}

// SaveVolumes 保存卷定义（完整替换）。
func (a *App) SaveVolumes(novelID int64, vols []novel.Volume) error {
	if len(vols) == 0 {
		vols = novel.DefaultVolumes()
	}
	return a.novel.DB.WithContext(a.ctx).
		Model(&novel.Novel{}).Where("id = ?", novelID).
		Update("volumes", novel.VolumesJSON(vols)).Error
}

// RenameVolume 重命名卷（index 从 1 开始）。
func (a *App) RenameVolume(novelID int64, index int, name string) error {
	var n novel.Novel
	if err := a.novel.DB.WithContext(a.ctx).First(&n, novelID).Error; err != nil {
		return err
	}
	if index < 1 || index > len(novel.ParseVolumes(n.Volumes)) {
		return fmt.Errorf("卷不存在")
	}
	return a.novel.DB.WithContext(a.ctx).
		Model(&novel.Novel{}).Where("id = ?", novelID).
		Update("volumes", novel.RenameVolume(n.Volumes, index, name)).Error
}

// DeleteVolume 删除卷（index 从 1 开始）；卷内章节自动归入第一卷。
func (a *App) DeleteVolume(novelID int64, index int) error {
	var n novel.Novel
	if err := a.novel.DB.WithContext(a.ctx).First(&n, novelID).Error; err != nil {
		return err
	}
	next, ok := novel.DeleteVolume(n.Volumes, index)
	if !ok {
		return fmt.Errorf("卷不存在")
	}
	return a.novel.DB.WithContext(a.ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&novel.Novel{}).Where("id = ?", novelID).Update("volumes", next).Error; err != nil {
			return err
		}
		// 卷内章节归入第一卷（若删除的是第一卷则归入新的第一卷）
		return tx.Model(&chapter.Chapter{}).
			Where("novel_id = ? AND volume = ?", novelID, index).
			Update("volume", 1).Error
	})
}

// ── 顺序与移动 ───────────────────────────────────────────

// ReorderChapter 移动单章：只写入目标卷 + 分数序号（不重排其他章节），随后惰性规整。
// targetOrder 由前端计算（目标间隙中间值，如 5 与 6 之间 = 5.5）。
func (a *App) ReorderChapter(novelID int64, chapterID int64, targetVolume int, targetOrder float64) error {
	logDrag(novelID, "ReorderChapter", chapterID, targetVolume, targetOrder)
	var ch chapter.Chapter
	if err := a.chapter.DB.WithContext(a.ctx).First(&ch, chapterID).Error; err != nil {
		return fmt.Errorf("章节不存在")
	}
	if ch.NovelID != novelID {
		return fmt.Errorf("章节不属于该书")
	}
	if err := a.chapter.DB.WithContext(a.ctx).Model(&chapter.Chapter{}).
		Where("id = ?", chapterID).
		Updates(map[string]any{"volume": targetVolume, "sort_order": targetOrder}).Error; err != nil {
		return err
	}
	// 惰性规整：若该卷相邻序号间距过小，重排回连续整数
	if err := a.normalizeVolumeIfTight(novelID, targetVolume); err != nil {
		return err
	}
	return a.logVolumeSnapshot(novelID, targetVolume)
}

// logVolumeSnapshot 记录某卷操作后的完整排序快照到 runtime/dnd.log（调试验证用）。
func (a *App) logVolumeSnapshot(novelID int64, volume int) error {
	var list []chapter.Chapter
	if err := a.chapter.DB.WithContext(a.ctx).
		Where("novel_id = ? AND volume = ?", novelID, volume).
		Order("sort_order ASC").Find(&list).Error; err != nil {
		return err
	}
	parts := make([]string, 0, len(list))
	for _, c := range list {
		parts = append(parts, fmt.Sprintf("%03d@%.6f", c.ChapterNumber, c.SortOrder))
	}
	logDrag(novelID, "SNAPSHOT vol="+fmt.Sprint(volume), 0, volume, 0)
	dir := filepath.Join(config.DataDirPath(), "runtime")
	f, err := os.OpenFile(filepath.Join(dir, "dnd.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, _ = f.WriteString("  order: " + strings.Join(parts, " ") + "\n")
	return nil
}

// normalizeVolumeIfTight 若某卷内相邻序号最小间距 < 阈值，则整卷重排回连续整数。
func (a *App) normalizeVolumeIfTight(novelID int64, volume int) error {
	const minGap = 1e-4
	var list []chapter.Chapter
	if err := a.chapter.DB.WithContext(a.ctx).
		Where("novel_id = ? AND volume = ?", novelID, volume).
		Order("sort_order ASC").Find(&list).Error; err != nil {
		return err
	}
	if len(list) < 2 {
		return nil
	}
	for i := 1; i < len(list); i++ {
		prev := list[i-1].SortOrder
		cur := list[i].SortOrder
		if cur <= 0 && prev <= 0 {
			continue
		}
		if cur-prev < minGap {
			return a.normalizeVolume(novelID, volume)
		}
	}
	return nil
}

// NormalizeVolumeOrders 把某卷（0=全部卷）的 sort_order 规整回连续整数（1..n）。
func (a *App) NormalizeVolumeOrders(novelID int64, volume int) error {
	if volume > 0 {
		return a.normalizeVolume(novelID, volume)
	}
	// 全部卷
	var vols []int
	if err := a.chapter.DB.WithContext(a.ctx).Model(&chapter.Chapter{}).
		Where("novel_id = ?", novelID).Distinct().Pluck("volume", &vols).Error; err != nil {
		return err
	}
	for _, v := range vols {
		if err := a.normalizeVolume(novelID, v); err != nil {
			return err
		}
	}
	return nil
}

// normalizeVolume 把某卷 sort_order 规整回连续整数（1..n）。
func (a *App) normalizeVolume(novelID int64, volume int) error {
	var list []chapter.Chapter
	if err := a.chapter.DB.WithContext(a.ctx).
		Where("novel_id = ? AND volume = ?", novelID, volume).
		Order("sort_order ASC").Find(&list).Error; err != nil {
		return err
	}
	for i, c := range list {
		if err := a.chapter.DB.WithContext(a.ctx).Model(&chapter.Chapter{}).
			Where("id = ?", c.ID).Update("sort_order", float64(i+1)).Error; err != nil {
			return err
		}
	}
	return nil
}

// ReorderVolumes 重排卷顺序（newOrder 为新顺序的旧卷序号列表，如 [3,1,2]）。
// 卷顺序由 volumes 数组位置表达，章节 volume 字段存序号——重排后统一重新编号（两阶段防互相污染）。
func (a *App) ReorderVolumes(novelID int64, newOrder []int) error {
	var n novel.Novel
	if err := a.novel.DB.WithContext(a.ctx).First(&n, novelID).Error; err != nil {
		return err
	}
	vols := novel.ParseVolumes(n.Volumes)
	if len(newOrder) != len(vols) {
		return fmt.Errorf("卷数量不匹配")
	}
	seen := map[int]bool{}
	for _, v := range newOrder {
		if v < 1 || v > len(vols) || seen[v] {
			return fmt.Errorf("无效的卷顺序")
		}
		seen[v] = true
	}
	newVols := make([]novel.Volume, 0, len(vols))
	mapping := map[int]int{} // 旧序号 → 新序号
	for i, oldIdx := range newOrder {
		newVols = append(newVols, vols[oldIdx-1])
		mapping[oldIdx] = i + 1
	}
	return a.novel.DB.WithContext(a.ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&novel.Novel{}).Where("id = ?", novelID).Update("volumes", novel.VolumesJSON(newVols)).Error; err != nil {
			return err
		}
		// 两阶段：先置临时负值隔离，再写正式值，避免交换时互相污染
		for old, newIdx := range mapping {
			if old == newIdx {
				continue
			}
			if err := tx.Model(&chapter.Chapter{}).
				Where("novel_id = ? AND volume = ?", novelID, old).
				Update("volume", -old).Error; err != nil {
				return err
			}
		}
		for old, newIdx := range mapping {
			if old == newIdx {
				continue
			}
			if err := tx.Model(&chapter.Chapter{}).
				Where("novel_id = ? AND volume = ?", novelID, -old).
				Update("volume", newIdx).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// ReorderChaptersBatch 批量移动一组章节：按基准分数 + 0.001×i 写入目标卷（组内顺序保持），不重排其他章节；随后惰性规整。
// ReorderChaptersBatch 批量移动一组章节：在目标卷插入间隙内均匀分布（组不被现有章节劈开），不重排其他章节；随后惰性规整。
func (a *App) ReorderChaptersBatch(novelID int64, ids []int64, targetVolume int, baseOrder float64) error {
	logDrag(novelID, "ReorderChaptersBatch", ids[0], targetVolume, baseOrder)
	if len(ids) == 0 {
		return nil
	}
	var group []chapter.Chapter
	if err := a.chapter.DB.WithContext(a.ctx).
		Where("novel_id = ? AND id IN ?", novelID, ids).
		Order("sort_order ASC").Find(&group).Error; err != nil {
		return err
	}
	seen := map[int64]bool{}
	ordered := make([]int64, 0, len(group))
	for _, c := range group {
		if !seen[c.ID] {
			seen[c.ID] = true
			ordered = append(ordered, c.ID)
		}
	}
	// 找插入间隙 (prev, next)：prev < base 的最大者、next > base 的最小者（排除组内）
	var prev, next float64
	hasPrev, hasNext := false, false
	var all []chapter.Chapter
	if err := a.chapter.DB.WithContext(a.ctx).
		Where("novel_id = ? AND volume = ?", novelID, targetVolume).
		Order("sort_order ASC").Find(&all).Error; err != nil {
		return err
	}
	for _, c := range all {
		if seen[c.ID] {
			continue
		}
		if c.SortOrder < baseOrder && (!hasPrev || c.SortOrder > prev) {
			prev = c.SortOrder
			hasPrev = true
		}
		if c.SortOrder > baseOrder && (!hasNext || c.SortOrder < next) {
			next = c.SortOrder
			hasNext = true
		}
	}
	// 组内均匀分布：从 prev 之后开始，step = 间隙宽 / (n+1)
	n := float64(len(ordered))
	var start, step float64
	if !hasPrev && !hasNext {
		start = 1
		step = 1
	} else if !hasPrev {
		start = next / (n + 1)
		step = next / (n + 1)
	} else if !hasNext {
		start = prev + 1
		step = 1
	} else {
		gap := next - prev
		step = gap / (n + 1)
		start = prev + step
	}
	for i, id := range ordered {
		order := start + float64(i)*step
		if err := a.chapter.DB.WithContext(a.ctx).Model(&chapter.Chapter{}).
			Where("id = ?", id).
			Updates(map[string]any{"volume": targetVolume, "sort_order": order}).Error; err != nil {
			return err
		}
	}
	if err := a.normalizeVolumeIfTight(novelID, targetVolume); err != nil {
		return err
	}
	return a.logVolumeSnapshot(novelID, targetVolume)
}

// RecomputePrevChapters 全量重算 prev_chapter_number（按卷顺序 → 卷内 sort_order）。
// 拖拽调序后调用，保证"上一章"跟随新顺序；跨卷按卷顺序衔接，不交错。
func (a *App) RecomputePrevChapters(novelID int64) error {
	var n novel.Novel
	if err := a.novel.DB.WithContext(a.ctx).First(&n, novelID).Error; err != nil {
		return err
	}
	volCount := len(novel.ParseVolumes(n.Volumes))
	if volCount < 1 {
		volCount = 1
	}
	var list []chapter.Chapter
	if err := a.chapter.DB.WithContext(a.ctx).
		Where("novel_id = ?", novelID).
		Find(&list).Error; err != nil {
		return err
	}
	sort.SliceStable(list, func(i, j int) bool {
		vi, vj := list[i].Volume, list[j].Volume
		if vi < 1 || vi > volCount {
			vi = volCount + 1 // 未归属卷的章节排最后
		}
		if vj < 1 || vj > volCount {
			vj = volCount + 1
		}
		if vi != vj {
			return vi < vj
		}
		return list[i].SortOrder < list[j].SortOrder
	})
	prev := 0
	for _, c := range list {
		if err := a.chapter.DB.WithContext(a.ctx).Model(&chapter.Chapter{}).
			Where("id = ?", c.ID).Update("prev_chapter_number", prev).Error; err != nil {
			return err
		}
		prev = c.ChapterNumber
	}
	return nil
}


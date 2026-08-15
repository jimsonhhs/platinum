// Package draft 提供草稿工作区与版本历史核心逻辑。
// 原则：任何覆盖操作（复制/导入/恢复）都先把被覆盖方自动归档到 <目录>_history/，
// 永不拒绝、永不丢失；草稿始终是"当前工作稿"，正文始终是"已发布"。
// 历史机制泛化支持：草稿 drafts/、正文 chapters/、用户大纲 user_outlines/ 三类文件。
package draft

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"

	"novel/internal/chapter"
	"novel/internal/novel"
	"novel/internal/git"
	"novel/internal/rag"
	"novel/internal/text"
)

// DefaultLimit 是历史保留数量的默认上限。
const DefaultLimit = 50

func timestamp() string { return time.Now().Format("20060102-150405") }

// HistoryDir 返回 relPath 对应文件的历史目录：<所在目录>/_history/。
func HistoryDir(novelID int64, relPath string) string {
	dir := filepath.Dir(relPath)
	if dir == "." {
		dir = ""
	}
	return filepath.Join(git.NovelDir(novelID), dir, "_history")
}

// HistoryEntry 是历史版本条目。
type HistoryEntry struct {
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	Mtime string `json:"mtime"` // 格式 2006-01-02 15:04:05
	Words int    `json:"words"` // 字数（中文字符+英文单词）
}

func baseName(relPath string) string {
	b := filepath.Base(relPath)
	return strings.TrimSuffix(b, ".md")
}

// ArchiveCurrent 把 relPath 当前内容归档为历史版本（若与最新历史相同则跳过），并裁剪超限旧版本。
func ArchiveCurrent(novelID int64, relPath string, limit int) (string, error) {
	if limit <= 0 {
		limit = DefaultLimit
	}
	content, err := git.ReadFile(novelID, relPath)
	if err != nil {
		return "", nil // 文件不存在/不可读 → 不归档（不报错）
	}
	if strings.TrimSpace(content) == "" {
		return "", nil
	}
	dir := HistoryDir(novelID, relPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("draft: mkdir history: %w", err)
	}
	prefix := baseName(relPath) + "_"
	// 与最新历史相同 → 跳过（去重）
	if latest, err := latestHistory(dir, prefix); err == nil && latest != "" {
		if data, rerr := os.ReadFile(filepath.Join(dir, latest)); rerr == nil && string(data) == content {
			return "", nil
		}
	}
	// 归档到正文历史时用 _body，草稿/用户大纲用 _draft
	label := "draft"
	if strings.HasPrefix(relPath, "chapters/") {
		label = "body"
	}
	dst := filepath.Join(dir, fmt.Sprintf("%s%s_%s.md", prefix, label, timestamp()))
	if err := os.WriteFile(dst, []byte(content), 0644); err != nil {
		return "", fmt.Errorf("draft: archive: %w", err)
	}
	enforceLimit(dir, prefix, limit)
	return dst, nil
}

func latestHistory(dir, prefix string) (string, error) {
	names, err := historyNames(dir, prefix)
	if err != nil || len(names) == 0 {
		return "", err
	}
	return names[len(names)-1], nil
}

func historyNames(dir, prefix string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("draft: list history: %w", err)
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), prefix) && strings.HasSuffix(e.Name(), ".md") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

// enforceLimit 删除超过 limit 的旧版本（保留最新的 limit 个）。
func enforceLimit(dir, prefix string, limit int) {
	if limit <= 0 {
		return
	}
	names, err := historyNames(dir, prefix)
	if err != nil || len(names) <= limit {
		return
	}
	excess := len(names) - limit
	for _, n := range names[:excess] {
		_ = os.Remove(filepath.Join(dir, n))
	}
}

// CopyToDraft 把正文复制为草稿（初始化/重建工作稿）。
// 草稿已有内容时自动归档到历史，然后正文覆盖草稿。总是允许，不拒绝。
func CopyToDraft(novelID int64, chapterNumber int, limit int) error {
	body, err := git.ReadFile(novelID, git.ChapterPath(chapterNumber))
	if err != nil || strings.TrimSpace(body) == "" {
		body = "" // 正文不存在/为空：仍创建草稿文件（空），让编辑/创作可直接开始
	}
	if _, err := ArchiveCurrent(novelID, git.DraftPath(chapterNumber), limit); err != nil {
		return err
	}
	if err := git.WriteFile(novelID, git.DraftPath(chapterNumber), body); err != nil {
		return fmt.Errorf("写入草稿失败: %w", err)
	}
	return nil
}

// ImportDraft 把草稿发布为正文（导入）。
// 当前正文自动归档到历史；草稿保留在工作区（可继续编辑）；章节不存在时自动创建。
// 草稿为空时自动用当前正文初始化草稿（不报错卡死），返回说明性错误。
func ImportDraft(db *gorm.DB, novelID int64, chapterNumber int, limit int) error {
	content, err := git.ReadFile(novelID, git.DraftPath(chapterNumber))
	if err != nil || strings.TrimSpace(content) == "" {
		body, berr := git.ReadFile(novelID, git.ChapterPath(chapterNumber))
		if berr != nil || strings.TrimSpace(body) == "" {
			return fmt.Errorf("草稿与正文均为空，无法导入")
		}
		if werr := git.WriteFile(novelID, git.DraftPath(chapterNumber), body); werr != nil {
			return fmt.Errorf("自动初始化草稿失败: %w", werr)
		}
		return fmt.Errorf("草稿为空：已自动用当前正文初始化草稿 drafts/%03d.md，请先编辑草稿内容后再导入", chapterNumber)
	}
	// 归档当前正文（如有）
	if _, err := ArchiveCurrent(novelID, git.ChapterPath(chapterNumber), limit); err != nil {
		return err
	}
	// 草稿 → 正文（草稿文件保留）
	if err := git.WriteFile(novelID, git.ChapterPath(chapterNumber), content); err != nil {
		return fmt.Errorf("写入正文失败: %w", err)
	}

	ctx := context.Background()
	stats := text.ComputeStats(content)

	// 章节行不存在则自动创建（title 默认"第N章"）——章号用单调计数器（删除不回退）
	var ch chapter.Chapter
	if err := db.WithContext(ctx).
		Where("novel_id = ? AND chapter_number = ?", novelID, chapterNumber).
		First(&ch).Error; err != nil {
		// 分配新章号：单调计数器
		var n novel.Novel
		if err := db.WithContext(ctx).First(&n, novelID).Error; err != nil {
			return fmt.Errorf("读取小说失败: %w", err)
		}
		next := n.ChapterSeq + 1
		if next < 1 {
			next = 1
		}
		var maxOrder float64
		_ = db.WithContext(ctx).Model(&chapter.Chapter{}).
			Where("novel_id = ?", novelID).
			Select("COALESCE(MAX(sort_order), 0)").Scan(&maxOrder).Error
		ch = chapter.Chapter{
			NovelID:           novelID,
			ChapterNumber:     next,
			Title:             fmt.Sprintf("第%d章", next),
			WordCount:         stats.WordCount,
			SortOrder:         maxOrder + 1,
			Volume:            1,
			PrevChapterNumber: prevChapterByOrder(db, novelID, maxOrder+1),
		}
		if err := db.WithContext(ctx).Create(&ch).Error; err != nil {
			return fmt.Errorf("创建章节记录失败: %w", err)
		}
		_ = db.WithContext(ctx).Model(&novel.Novel{}).
			Where("id = ?", novelID).Update("chapter_seq", next).Error
	} else {
		if err := db.WithContext(ctx).Model(&chapter.Chapter{}).
			Where("novel_id = ? AND chapter_number = ?", novelID, chapterNumber).
			Update("word_count", stats.WordCount).Error; err != nil {
			return fmt.Errorf("更新字数失败: %w", err)
		}
	}

	// 向量索引
	rag.SubmitRefresh(novelID, chapterNumber, content)
	return nil
}

// prevChapterByOrder 计算叙事顺序（sort_order）中小于指定 order 的最后一章的章号。
func prevChapterByOrder(db *gorm.DB, novelID int64, order float64) int {
	var ch chapter.Chapter
	if err := db.Where("novel_id = ? AND sort_order < ?", novelID, order).
		Order("sort_order DESC").First(&ch).Error; err == nil {
		return ch.ChapterNumber
	}
	return 0
}

// ListHistory 返回某文件的历史版本（时间倒序，含字数/时间）。
func ListHistory(novelID int64, relPath string) ([]HistoryEntry, error) {
	dir := HistoryDir(novelID, relPath)
	names, err := historyNames(dir, baseName(relPath)+"_")
	if err != nil || len(names) == 0 {
		return nil, err
	}
	out := make([]HistoryEntry, 0, len(names))
	for i := len(names) - 1; i >= 0; i-- { // 时间倒序：最新在前
		n := names[i]
		full := filepath.Join(dir, n)
		fi, ferr := os.Stat(full)
		if ferr != nil {
			continue
		}
		e := HistoryEntry{Name: n, Size: fi.Size(), Mtime: fi.ModTime().Format("2006-01-02 15:04:05")}
		if data, rerr := os.ReadFile(full); rerr == nil {
			e.Words = text.ComputeStats(string(data)).WordCount
		}
		out = append(out, e)
	}
	return out, nil
}

// RestoreHistory 把某历史版本恢复到目标文件（当前内容自动归档）。
func RestoreHistory(novelID int64, relPath, fileName string, limit int) error {
	if fileName == "" || strings.ContainsAny(fileName, `/\`) {
		return fmt.Errorf("历史版本无效")
	}
	dir := HistoryDir(novelID, relPath)
	src := filepath.Join(dir, fileName)
	data, err := os.ReadFile(src)
	if err != nil {
		return fmt.Errorf("读取历史版本失败: %w", err)
	}
	if _, err := ArchiveCurrent(novelID, relPath, limit); err != nil {
		return err
	}
	if err := git.WriteFile(novelID, relPath, string(data)); err != nil {
		return fmt.Errorf("恢复历史失败: %w", err)
	}
	return nil
}

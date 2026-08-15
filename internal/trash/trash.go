// Package trash 提供删除内容的回收站：删除先移入回收站，二次删除才彻底清除。
// 回收站位于数据目录 trash/ 下，独立于各小说的 git 仓库，因此不会污染版本历史。
// 每个条目由内容文件（.md）和元数据文件（.json 同名）组成。
package trash

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"novel/internal/config"
	"novel/internal/git"
)

// Item 是回收站中的一条记录。
type Item struct {
	ID           string `json:"id"`            // 文件名基准（不含扩展名），如 "3_20260812-230500"
	Type         string `json:"type"`          // "chapter" | "skill"
	Source       string `json:"source"`        // chapter: "novel"；skill: "novel" | "user"
	NovelID      int64  `json:"novel_id"`      // 所属小说（skill 用户级可为 0）
	OriginalPath string `json:"original_path"` // 原始相对路径（chapters/003.md / skills/x.md）
	Name         string `json:"name"`          // 原名（章节号或技能名）
	Title        string `json:"title"`         // 章节标题（仅 chapter）
	WordCount    int    `json:"word_count"`    // 章节字数（仅 chapter）
	Size         int64  `json:"size"`          // 内容字节数
	TrashedAt    string `json:"trashed_at"`    // 移入回收站时间（2006-01-02 15:04:05）
}

type meta struct {
	Type         string `json:"type"`
	Source       string `json:"source"`
	NovelID      int64  `json:"novel_id"`
	OriginalPath string `json:"original_path"`
	Name         string `json:"name"`
	Title        string `json:"title"`
	WordCount    int    `json:"word_count"`
	TrashedAt    string `json:"trashed_at"`
}

func ts() string { return time.Now().Format("20060102-150405.000") }

func tsHuman() string { return time.Now().Format("2006-01-02 15:04:05") }

// uniqueBase 生成带时间戳的唯一文件名基准；同秒同号重复删除时追加 _2、_3… 防止覆盖。
func uniqueBase(dir, prefix string) string {
	stamp := ts()
	base := fmt.Sprintf("%s_%s", prefix, stamp)
	for i := 2; ; i++ {
		if _, err := os.Stat(filepath.Join(dir, base+".md")); os.IsNotExist(err) {
			return base
		}
		base = fmt.Sprintf("%s_%s_%d", prefix, stamp, i)
	}
}

// MoveChapter 把章节正文移入回收站（写入内容 + 元数据，并删除原文件）。
func MoveChapter(novelID int64, chapterNumber int, title string, wordCount int, content string) (*Item, error) {
	dir := filepath.Join(config.TrashDir(), "chapters", fmt.Sprintf("%d", novelID))
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("trash: mkdir: %w", err)
	}
	base := uniqueBase(dir, fmt.Sprintf("%d", chapterNumber))
	mdPath := filepath.Join(dir, base+".md")
	if err := os.WriteFile(mdPath, []byte(content), 0644); err != nil {
		return nil, fmt.Errorf("trash: write: %w", err)
	}
	it := &Item{
		ID:           base,
		Type:         "chapter",
		Source:       "novel",
		NovelID:      novelID,
		OriginalPath: git.ChapterPath(chapterNumber),
		Name:         fmt.Sprintf("%d", chapterNumber),
		Title:        title,
		WordCount:    wordCount,
		Size:         int64(len(content)),
		TrashedAt:    tsHuman(),
	}
	if err := writeMeta(mdPath, it); err != nil {
		_ = os.Remove(mdPath)
		return nil, err
	}
	return it, nil
}

// MoveSkill 把技能文件移入回收站（写入内容 + 元数据，并删除原文件）。
// source: "user" | "novel"；dir 为原技能目录。
func MoveSkill(source string, novelID int64, dir, name string) (*Item, error) {
	srcPath := filepath.Join(dir, name+".md")
	data, err := os.ReadFile(srcPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("技能文件不存在: %s", name)
		}
		return nil, fmt.Errorf("trash: read skill: %w", err)
	}
	sub := "user"
	if source == "novel" {
		sub = "novel"
	}
	tdir := filepath.Join(config.TrashDir(), "skills", sub)
	if err := os.MkdirAll(tdir, 0755); err != nil {
		return nil, fmt.Errorf("trash: mkdir: %w", err)
	}
	base := uniqueBase(tdir, name)
	mdPath := filepath.Join(tdir, base+".md")
	if err := os.WriteFile(mdPath, data, 0644); err != nil {
		return nil, fmt.Errorf("trash: write: %w", err)
	}
	orig := name + ".md"
	if source == "novel" {
		orig = "skills/" + name + ".md"
	}
	it := &Item{
		ID:           base,
		Type:         "skill",
		Source:       source,
		NovelID:      novelID,
		OriginalPath: orig,
		Name:         name,
		Size:         int64(len(data)),
		TrashedAt:    tsHuman(),
	}
	if err := writeMeta(mdPath, it); err != nil {
		_ = os.Remove(mdPath)
		return nil, err
	}
	if err := os.Remove(srcPath); err != nil {
		return nil, fmt.Errorf("trash: remove original: %w", err)
	}
	return it, nil
}

func writeMeta(mdPath string, it *Item) error {
	m := meta{
		Type:         it.Type,
		Source:       it.Source,
		NovelID:      it.NovelID,
		OriginalPath: it.OriginalPath,
		Name:         it.Name,
		Title:        it.Title,
		WordCount:    it.WordCount,
		TrashedAt:    it.TrashedAt,
	}
	data, err := json.Marshal(m)
	if err != nil {
		return fmt.Errorf("trash: marshal meta: %w", err)
	}
	return os.WriteFile(strings.TrimSuffix(mdPath, ".md")+".json", data, 0644)
}

// List 扫描回收站，返回全部条目（按移入时间倒序）。
func List() ([]Item, error) {
	root := config.TrashDir()
	var items []Item
	// chapters/{novelID}/*.json
	chDir := filepath.Join(root, "chapters")
	if entries, err := os.ReadDir(chDir); err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			files, _ := os.ReadDir(filepath.Join(chDir, e.Name()))
			for _, f := range files {
				if !strings.HasSuffix(f.Name(), ".json") {
					continue
				}
				it, err := parseMeta(filepath.Join(chDir, e.Name(), f.Name()))
				if err != nil {
					continue
				}
				items = append(items, *it)
			}
		}
	}
	// skills/{user|novel}/*.json
	skDir := filepath.Join(root, "skills")
	if entries, err := os.ReadDir(skDir); err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			files, _ := os.ReadDir(filepath.Join(skDir, e.Name()))
			for _, f := range files {
				if !strings.HasSuffix(f.Name(), ".json") {
					continue
				}
				it, err := parseMeta(filepath.Join(skDir, e.Name(), f.Name()))
				if err != nil {
					continue
				}
				items = append(items, *it)
			}
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].TrashedAt > items[j].TrashedAt })
	return items, nil
}

func parseMeta(jsonPath string) (*Item, error) {
	data, err := os.ReadFile(jsonPath)
	if err != nil {
		return nil, err
	}
	var m meta
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	base := strings.TrimSuffix(filepath.Base(jsonPath), ".json")
	return &Item{
		ID:           base,
		Type:         m.Type,
		Source:       m.Source,
		NovelID:      m.NovelID,
		OriginalPath: m.OriginalPath,
		Name:         m.Name,
		Title:        m.Title,
		WordCount:    m.WordCount,
		TrashedAt:    m.TrashedAt,
	}, nil
}

// Paths 返回条目在回收站中的完整文件路径。
func (it *Item) Paths() (mdPath, jsonPath string, err error) {
	root := config.TrashDir()
	var dir string
	switch it.Type {
	case "chapter":
		dir = filepath.Join(root, "chapters", fmt.Sprintf("%d", it.NovelID))
	case "skill":
		sub := "user"
		if it.Source == "novel" {
			sub = "novel"
		}
		dir = filepath.Join(root, "skills", sub)
	default:
		return "", "", fmt.Errorf("trash: 未知条目类型: %s", it.Type)
	}
	mdPath = filepath.Join(dir, it.ID+".md")
	jsonPath = filepath.Join(dir, it.ID+".json")
	return mdPath, jsonPath, nil
}

// Content 返回条目内容文本。
func (it *Item) Content() (string, error) {
	mdPath, _, err := it.Paths()
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(mdPath)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// RestoreFiles 把条目移回原始位置（文件级别），返回原始相对路径。
// 数据库记录、向量索引等由调用方（app 层）负责重建。
func (it *Item) RestoreFiles(novelID int64) (string, error) {
	mdPath, jsonPath, err := it.Paths()
	if err != nil {
		return "", err
	}
	var base string
	switch {
	case it.Type == "skill" && it.Source == "user":
		base = config.UserSkillsDir()
	case it.Type == "skill" && it.Source == "novel":
		base = config.NovelDirPath(it.NovelID)
	default:
		base = config.NovelDirPath(novelID)
	}
	full, err := git.SafePath(base, it.OriginalPath)
	if err != nil {
		return "", fmt.Errorf("trash: 恢复路径非法: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
		return "", fmt.Errorf("trash: mkdir: %w", err)
	}
	if _, err := os.Stat(full); err == nil {
		return "", fmt.Errorf("恢复失败：目标位置已存在同名文件 %s", it.OriginalPath)
	}
	if err := os.Rename(mdPath, full); err != nil {
		return "", fmt.Errorf("trash: restore: %w", err)
	}
	_ = os.Remove(jsonPath)
	return it.OriginalPath, nil
}

// Purge 彻底删除条目（二次删除）。
func (it *Item) Purge() error {
	mdPath, jsonPath, err := it.Paths()
	if err != nil {
		return err
	}
	_ = os.Remove(mdPath)
	_ = os.Remove(jsonPath)
	return nil
}

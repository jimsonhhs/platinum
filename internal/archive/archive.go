// Package archive 提供定时存档：把 chapters/outlines/user_outlines/skills/rules 等
// 快照到数据目录的 archive/ 下。archive/ 位于数据目录根，AI 的路径解析（小说目录内 /
// ~/.goink/ 前缀）均无法到达，因此对 AI 是只读禁区，用户可随时回档。
package archive

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"novel/internal/config"
)

// SnapshotMeta 描述一个存档快照。
type SnapshotMeta struct {
	ID        string `json:"id"`         // 目录名（时间戳）
	CreatedAt string `json:"created_at"` // 人类可读时间
	Size      int64  `json:"size"`       // 总字节数
	Files     int    `json:"files"`      // 文件数
	Path      string `json:"path"`       // 快照目录绝对路径
}

const defaultKeep = 20

func rootDir() string { return filepath.Join(config.DataDirPath(), "archive") }

// Create 立即创建一次全量快照，并清理旧快照（保留 keep 份，keep<=0 用默认 20）。
// 返回快照 ID。
func Create(keep int) (string, error) {
	if keep <= 0 {
		keep = defaultKeep
	}
	ts := time.Now().Format("20060102-150405")
	snapDir := filepath.Join(rootDir(), ts)
	if err := os.MkdirAll(snapDir, 0755); err != nil {
		return "", fmt.Errorf("archive: mkdir: %w", err)
	}

	// 1. 各小说：chapters/outlines/user_outlines/skills/plans + platinum.md
	novelsDir := filepath.Join(config.DataDirPath(), "novels")
	if entries, err := os.ReadDir(novelsDir); err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			src := filepath.Join(novelsDir, e.Name())
			dst := filepath.Join(snapDir, "novels", e.Name())
			copyDir(src, dst, nil)
		}
	}

	// 2. 全局技能（~/.goink/skills）与规则（~/.goink/rules）
	if err := copyDir(config.UserSkillsDir(), filepath.Join(snapDir, "skills"), nil); err != nil {
		return "", fmt.Errorf("archive: copy skills: %w", err)
	}
	if err := copyDir(config.RulesDir(), filepath.Join(snapDir, "rules"), nil); err != nil {
		return "", fmt.Errorf("archive: copy rules: %w", err)
	}

	// 3. 清理旧快照
	prune(keep)
	return ts, nil
}

// List 返回全部快照（按时间倒序）。
func List() ([]SnapshotMeta, error) {
	root := rootDir()
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("archive: list: %w", err)
	}
	var snaps []SnapshotMeta
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		dir := filepath.Join(root, e.Name())
		var size int64
		files := 0
		_ = filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if !info.IsDir() {
				size += info.Size()
				files++
			}
			return nil
		})
		snaps = append(snaps, SnapshotMeta{
			ID:        e.Name(),
			CreatedAt: humanTime(e.Name()),
			Size:      size,
			Files:     files,
			Path:      dir,
		})
	}
	sort.Slice(snaps, func(i, j int) bool { return snaps[i].ID > snaps[j].ID })
	return snaps, nil
}

// ListFiles 返回快照内的文件（相对快照根的路径，含所属领域前缀）。
func ListFiles(snapshotID string) ([]string, error) {
	dir := filepath.Join(rootDir(), snapshotID)
	var files []string
	err := filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			rel, _ := filepath.Rel(dir, p)
			files = append(files, filepath.ToSlash(rel))
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("archive: list files: %w", err)
	}
	sort.Strings(files)
	return files, nil
}

// RestoreFile 把快照中的单个文件恢复到其原始位置。
// relPath 形如 novels/1/chapters/003.md、skills/分段写作.md、rules/通用守则.md。
func RestoreFile(snapshotID, relPath string) error {
	src := filepath.Join(rootDir(), snapshotID, filepath.FromSlash(relPath))
	if _, err := os.Stat(src); err != nil {
		return fmt.Errorf("存档中不存在该文件: %s", relPath)
	}
	dst, err := resolveTarget(relPath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return fmt.Errorf("archive: mkdir: %w", err)
	}
	if err := copyFile(src, dst); err != nil {
		return fmt.Errorf("archive: restore: %w", err)
	}
	return nil
}

// RestoreAll 把整个快照恢复到原始位置（覆盖同名文件）。返回恢复的文件数。
func RestoreAll(snapshotID string) (int, error) {
	files, err := ListFiles(snapshotID)
	if err != nil {
		return 0, err
	}
	restored := 0
	for _, f := range files {
		if err := RestoreFile(snapshotID, f); err != nil {
			return restored, fmt.Errorf("恢复 %s 失败: %w", f, err)
		}
		restored++
	}
	return restored, nil
}

// resolveTarget 把快照内相对路径映射回原始位置。
func resolveTarget(rel string) (string, error) {
	parts := strings.Split(filepath.ToSlash(rel), "/")
	if len(parts) < 2 {
		return "", fmt.Errorf("存档路径无效: %s", rel)
	}
	switch parts[0] {
	case "novels":
		// novels/{id}/...
		if len(parts) < 3 {
			return "", fmt.Errorf("存档路径无效: %s", rel)
		}
		base := config.NovelDirPath(atoiSafe(parts[1]))
		return filepath.Join(base, filepath.Join(parts[2:]...)), nil
	case "skills":
		return filepath.Join(config.UserSkillsDir(), filepath.Join(parts[1:]...)), nil
	case "rules":
		return filepath.Join(config.RulesDir(), filepath.Join(parts[1:]...)), nil
	default:
		return "", fmt.Errorf("未知存档领域: %s", parts[0])
	}
}

func prune(keep int) {
	snaps, err := List()
	if err != nil {
		return
	}
	for i := keep; i < len(snaps); i++ {
		_ = os.RemoveAll(filepath.Join(rootDir(), snaps[i].ID))
	}
}

func atoiSafe(s string) int64 {
	var n int64
	for _, c := range s {
		if c < '0' || c > '9' {
			break
		}
		n = n*10 + int64(c-'0')
	}
	return n
}

func humanTime(id string) string {
	t, err := time.Parse("20060102-150405", id)
	if err != nil {
		return id
	}
	return t.Format("2006-01-02 15:04:05")
}

// copyDir 递归复制目录；skipGit 为 true 时跳过 .git。
func copyDir(src, dst string, skipGit []string) error {
	entries, err := os.ReadDir(src)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, e := range entries {
		if e.Name() == ".git" {
			continue
		}
		s := filepath.Join(src, e.Name())
		d := filepath.Join(dst, e.Name())
		if e.IsDir() {
			if err := os.MkdirAll(d, 0755); err != nil {
				return err
			}
			if err := copyDir(s, d, skipGit); err != nil {
				return err
			}
		} else {
			if err := os.MkdirAll(filepath.Dir(d), 0755); err != nil {
				return err
			}
			if err := copyFile(s, d); err != nil {
				return err
			}
		}
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

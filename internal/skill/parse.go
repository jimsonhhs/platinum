package skill

import (
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// ParseFile 读取并解析一个 skill markdown 文件。
func ParseFile(path string) (*Skill, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("skill: 读取文件失败 %s: %w", path, err)
	}
	sk, err := ParseBytes(data, "user")
	if err != nil {
		return nil, fmt.Errorf("skill: 解析 %s 失败: %w", path, err)
	}
	return sk, nil
}

// ParseFS 从 fs.FS 中读取并解析一个 skill markdown 文件。
func ParseFS(fsys fs.FS, name string) (*Skill, error) {
	data, err := fs.ReadFile(fsys, name)
	if err != nil {
		return nil, fmt.Errorf("skill: 读取 %s 失败: %w", name, err)
	}
	sk, err := ParseBytes(data, "builtin")
	if err != nil {
		return nil, fmt.Errorf("skill: 解析 %s 失败: %w", name, err)
	}
	return sk, nil
}

// ParseBytes 将一段 markdown 字节解析为 Skill。
// 可用于校验原始内容格式是否合法。
func ParseBytes(data []byte, defaultAuthor string) (*Skill, error) {
	fm, body, err := splitFrontmatter(strings.TrimSpace(string(data)))
	if err != nil {
		return nil, err
	}

	sk, err := parseFrontmatter(fm)
	if err != nil {
		return nil, fmt.Errorf("YAML frontmatter 解析失败: %w", err)
	}

	if sk.Name == "" {
		return nil, fmt.Errorf("缺少 name 字段")
	}
	if sk.Author == "" {
		sk.Author = defaultAuthor
	}
	sk.Mode = normalizeMode(sk.Mode)
	sk.Content = body
	sk.RawContent = string(data)
	return sk, nil
}

// splitFrontmatter 从 markdown 原文中分离 frontmatter 和正文。
// frontmatter 由开头的 --- 开始，下一个 --- 结束。
func splitFrontmatter(raw string) (frontmatter, body string, err error) {
	if !strings.HasPrefix(raw, "---") {
		return "", raw, nil
	}

	raw = raw[3:]
	frontmatter, body, found := strings.Cut(raw, "\n---")
	if !found {
		return "", "", fmt.Errorf("未闭合的 frontmatter：缺少结束标记 ---")
	}
	body = strings.TrimSpace(body)
	return frontmatter, body, nil
}

// parseFrontmatter 将 YAML frontmatter 字符串解析为 Skill（不含 Content）。
func parseFrontmatter(raw string) (*Skill, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return &Skill{}, nil
	}

	var sk Skill
	if err := yaml.Unmarshal([]byte(raw), &sk); err != nil {
		return nil, fmt.Errorf("YAML 解析失败: %w", err)
	}
	return &sk, nil
}

// scanFS 扫描 fs.FS 指定目录下的所有 .md 文件并解析为 Skill 切片。
func scanFS(logger *slog.Logger, fsys fs.FS, dir string) ([]Skill, error) {
	entries, err := fs.ReadDir(fsys, dir)
	if err != nil {
		return nil, fmt.Errorf("skill: 读取目录 %s 失败: %w", dir, err)
	}

	var skills []Skill
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".md" {
			continue
		}
		sk, err := ParseFS(fsys, dir+"/"+entry.Name())
		if err != nil {
			logger.Warn("skill: 解析内置 skill 失败，已跳过", "file", entry.Name(), "err", err)
			continue
		}
		skills = append(skills, *sk)
	}
	return skills, nil
}

// scanDir 扫描目录下所有 .md 文件并解析为 Skill 切片。
// YAML name 与文件名不一致时以 YAML name 为准重命名文件。
// 目录不存在时返回空切片（不报错）。
func scanDir(logger *slog.Logger, dir string) ([]Skill, error) {
	skills, _, err := scanDirWithIssues(logger, dir)
	return skills, err
}

// scanDirWithIssues 同 scanDir，但额外返回解析失败的文件列表（不静默丢弃，便于前端展示修复）。
func scanDirWithIssues(logger *slog.Logger, dir string) ([]Skill, []ScanIssue, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil, nil
		}
		return nil, nil, fmt.Errorf("读取目录 %s 失败: %w", dir, err)
	}

	var skills []Skill
	var issues []ScanIssue
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".md" {
			continue
		}
		sk, perr := ParseFile(filepath.Join(dir, entry.Name()))
		if perr != nil {
			logger.Warn("skill: 解析 skill 文件失败，已跳过", "file", entry.Name(), "err", perr)
			issues = append(issues, ScanIssue{
				File: entry.Name(),
				Name: strings.TrimSuffix(entry.Name(), ".md"),
				Err:  perr.Error(),
			})
			continue
		}
		fileBase := strings.TrimSuffix(entry.Name(), ".md")
		if sk.Name != "" && sk.Name != fileBase {
			oldPath := filepath.Join(dir, entry.Name())
			newPath := filepath.Join(dir, sk.Name+".md")
			if err := os.Rename(oldPath, newPath); err != nil {
				return nil, nil, fmt.Errorf("重命名 skill 文件失败 %s -> %s: %w", oldPath, newPath, err)
			}
		}
		skills = append(skills, *sk)
	}
	return skills, issues, nil
}

// RenameFile 把 dir 下的 oldName.md 重命名为 newName.md，并同步 frontmatter 的 name 字段。
// 校验重命名后的内容可正常解析且 name 与文件名一致。
func RenameFile(dir, oldName, newName string) error {
	oldPath := filepath.Join(dir, oldName+".md")
	newPath := filepath.Join(dir, newName+".md")
	data, err := os.ReadFile(oldPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("技能文件不存在: %s", oldName)
		}
		return fmt.Errorf("读取技能文件失败: %w", err)
	}
	if _, err := os.Stat(newPath); err == nil {
		return fmt.Errorf("同名技能已存在: %s", newName)
	}
	updated, err := replaceFrontmatterName(string(data), newName)
	if err != nil {
		return err
	}
	if err := os.WriteFile(newPath, []byte(updated), 0644); err != nil {
		return fmt.Errorf("写入技能文件失败: %w", err)
	}
	if err := os.Remove(oldPath); err != nil {
		_ = os.Remove(newPath) // 回滚新文件
		return fmt.Errorf("删除旧技能文件失败: %w", err)
	}
	return nil
}

// CopyFile 把 srcDir/name.md 复制为 dstDir/name.md。目标已存在同名文件时报错。
func CopyFile(srcDir, dstDir, name string) error {
	srcPath := filepath.Join(srcDir, name+".md")
	data, err := os.ReadFile(srcPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("技能文件不存在: %s", name)
		}
		return fmt.Errorf("读取技能文件失败: %w", err)
	}
	dstPath := filepath.Join(dstDir, name+".md")
	if _, err := os.Stat(dstPath); err == nil {
		return fmt.Errorf("目标位置已存在同名技能: %s", name)
	}
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return fmt.Errorf("创建目录失败: %w", err)
	}
	if err := os.WriteFile(dstPath, data, 0644); err != nil {
		return fmt.Errorf("写入技能文件失败: %w", err)
	}
	return nil
}

// replaceFrontmatterName 替换 frontmatter 中的 name 字段，并校验结果可解析。
func replaceFrontmatterName(raw, newName string) (string, error) {
	trimmed := strings.TrimSpace(string(raw))
	fm, body, err := splitFrontmatter(trimmed)
	if err != nil {
		return "", err
	}
	if fm == "" {
		return "", fmt.Errorf("技能文件缺少 YAML frontmatter")
	}
	lines := strings.Split(fm, "\n")
	found := false
	for i, ln := range lines {
		if strings.HasPrefix(strings.TrimSpace(ln), "name:") {
			lines[i] = "name: " + newName
			found = true
			break
		}
	}
	if !found {
		return "", fmt.Errorf("技能文件缺少 name 字段")
	}
	updated := "---\n" + strings.Join(lines, "\n") + "\n---\n\n" + body
	if _, err := ParseBytes([]byte(updated), ""); err != nil {
		return "", fmt.Errorf("重命名后技能格式非法: %w", err)
	}
	return updated, nil
}

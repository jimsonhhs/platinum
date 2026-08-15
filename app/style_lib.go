package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"novel/internal/agentcfg"
	"novel/internal/novel"
)

// StyleEntry 是文风库条目。
type StyleEntry struct {
	Name string `json:"name"` // 文件名（xxx.md）
	Size int64  `json:"size"`
}

// ListStyles 列出全局文风库（styles/ 目录）全部文风。
func (a *App) ListStyles() ([]StyleEntry, error) {
	dir := agentcfg.StylesDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("文风库目录创建失败: %w", err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("读取文风库失败: %w", err)
	}
	var out []StyleEntry
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		info, _ := e.Info()
		size := int64(0)
		if info != nil {
			size = info.Size()
		}
		out = append(out, StyleEntry{Name: e.Name(), Size: size})
	}
	return out, nil
}

// GetStyleContent 返回某文风的 md 内容（预览用）。
func (a *App) GetStyleContent(name string) (string, error) {
	if name == "" || strings.ContainsAny(name, `/\`) || filepath.Ext(name) != ".md" {
		return "", fmt.Errorf("无效的文风名称")
	}
	data, err := os.ReadFile(filepath.Join(agentcfg.StylesDir(), name))
	if err != nil {
		return "", fmt.Errorf("读取文风失败: %w", err)
	}
	return string(data), nil
}

// SaveStyleToLibrary 把提取产物保存为全局文风（styles/ 目录）。
func (a *App) SaveStyleToLibrary(name string, content string) (string, error) {
	fileName := agentcfg.StyleFileName(name)
	dir := agentcfg.StylesDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(dir, fileName), []byte(content), 0644); err != nil {
		return "", err
	}
	return fileName, nil
}

// DeleteStyle 删除文风库中的某个文风。
func (a *App) DeleteStyle(name string) error {
	if name == "" || strings.ContainsAny(name, `/\`) || filepath.Ext(name) != ".md" {
		return fmt.Errorf("无效的文风名称")
	}
	// 若某书正在启用它，先清空
	_ = a.novel.DB.WithContext(a.ctx).
		Model(&novel.Novel{}).Where("enabled_style = ?", name).
		Update("enabled_style", "").Error
	if err := os.Remove(filepath.Join(agentcfg.StylesDir(), name)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// SetEnabledStyle 启用/停用某书的文风（name 为空=停用）。注入在下一轮对话生效。
func (a *App) SetEnabledStyle(novelID int64, name string) error {
	if name != "" && (strings.ContainsAny(name, `/\`) || filepath.Ext(name) != ".md") {
		return fmt.Errorf("无效的文风名称")
	}
	if name != "" {
		if _, err := os.Stat(filepath.Join(agentcfg.StylesDir(), name)); err != nil {
			return fmt.Errorf("文风不存在: %s", name)
		}
	}
	return a.novel.DB.WithContext(a.ctx).
		Model(&novel.Novel{}).Where("id = ?", novelID).
		Update("enabled_style", name).Error
}

// GetEnabledStyle 返回某书当前启用的文风文件名（空=未启用）。
func (a *App) GetEnabledStyle(novelID int64) (string, error) {
	var n novel.Novel
	if err := a.novel.DB.WithContext(a.ctx).First(&n, novelID).Error; err != nil {
		return "", err
	}
	return n.EnabledStyle, nil
}

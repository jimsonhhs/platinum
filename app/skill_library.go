package app

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"novel/internal/config"
	"novel/internal/skill"
)

// ── 共享技能库（GitHub raw 拉取，按需下载安装）─────────────

const (
	skillLibraryIndexURL = "https://raw.githubusercontent.com/jimsonhhs/platinum-skills/master/index.json"
	skillLibraryRawBase  = "https://raw.githubusercontent.com/jimsonhhs/platinum-skills/master/"
	skillLibHTTPTimeout  = 15 * time.Second
)

// SkillLibraryEntry 是技能库清单里的一项。
type SkillLibraryEntry struct {
	Name        string `json:"name"`
	File        string `json:"file"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Mode        string `json:"mode"`
}

// ListSkillLibrary 拉取共享技能库清单（GitHub raw index.json）。
// 网络失败返回错误，前端提示"无法连接技能库"。
func (a *App) ListSkillLibrary() ([]SkillLibraryEntry, error) {
	client := &http.Client{Timeout: skillLibHTTPTimeout}
	resp, err := client.Get(skillLibraryIndexURL)
	if err != nil {
		return nil, fmt.Errorf("无法连接技能库: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("技能库响应异常: %d", resp.StatusCode)
	}

	var lib struct {
		Version int                  `json:"version"`
		Skills  []SkillLibraryEntry `json:"skills"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&lib); err != nil {
		return nil, fmt.Errorf("技能库数据解析失败: %w", err)
	}
	if lib.Skills == nil {
		lib.Skills = []SkillLibraryEntry{}
	}
	return lib.Skills, nil
}

// InstallSkill 从技能库下载指定技能并安装到用户技能目录（~/.goink/skills/）。
// 返回安装后的文件名；同名已存在时覆盖（重新安装=更新）。
func (a *App) InstallSkill(name string) (string, error) {
	// 先拉清单，找到对应文件
	entries, err := a.ListSkillLibrary()
	if err != nil {
		return "", err
	}
	var target *SkillLibraryEntry
	for i := range entries {
		if entries[i].Name == name {
			target = &entries[i]
			break
		}
	}
	if target == nil {
		return "", fmt.Errorf("技能库中未找到「%s」", name)
	}
	if target.File == "" || target.File == "." || target.File == ".." {
		return "", fmt.Errorf("技能文件无效")
	}

	// 下载 raw 文件
	rawURL := skillLibraryRawBase + url.PathEscape(target.File)
	client := &http.Client{Timeout: skillLibHTTPTimeout}
	resp, err := client.Get(rawURL)
	if err != nil {
		return "", fmt.Errorf("下载技能失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("下载技能响应异常: %d", resp.StatusCode)
	}
	content, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("读取技能内容失败: %w", err)
	}

	// 写入用户技能目录（~/.goink/skills/）
	dir := config.UserSkillsDir()
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", fmt.Errorf("创建技能目录失败: %w", err)
	}
	fileName := skill.SanitizeFileName(target.Name) + ".md"
	path := filepath.Join(dir, fileName)
	if err := os.WriteFile(path, content, 0600); err != nil {
		return "", fmt.Errorf("写入技能失败: %w", err)
	}

	// 重载技能库（让 AI 立即可用）
	if a.skill != nil {
		a.skill.ReloadUser(dir)
	}
	a.logger.Info("技能已安装", "name", name, "file", fileName)
	return fileName, nil
}

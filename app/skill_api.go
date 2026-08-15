package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"novel/internal/config"
	"novel/internal/git"
	"novel/internal/skill"
	"novel/internal/trash"
)

// ListSkillsInput 是 ListSkills 的入参。
type ListSkillsInput struct {
	NovelID int64 `json:"novel_id"`
}

// ListSkills 返回所有可用 skill 的元数据（同名覆盖：novel > user > builtin）。
func (a *App) ListSkills(input ListSkillsInput) []skill.SkillMeta {
	if a.skill == nil {
		return nil
	}
	return a.skill.ListMeta(input.NovelID)
}

// DeleteSkillInput 是 DeleteSkill 的入参。
type DeleteSkillInput struct {
	NovelID int64  `json:"novel_id"`
	Name    string `json:"name"`
	Source  string `json:"source"` // "novel" | "user"
}

// RenameSkillInput 是 RenameSkill 的入参。
type RenameSkillInput struct {
	NovelID int64  `json:"novel_id"`
	Source  string `json:"source"` // "novel" | "user"
	Name    string `json:"name"`
	NewName string `json:"new_name"`
}

// RenameSkill 重命名用户级或小说级技能：文件 + YAML name 同步修改。内置技能不可重命名。
func (a *App) RenameSkill(input RenameSkillInput) error {
	if a.skill == nil {
		return fmt.Errorf("skill store 未初始化")
	}
	if err := validateSkillName(input.Name); err != nil {
		return err
	}
	if err := validateSkillName(input.NewName); err != nil {
		return err
	}
	if input.NewName == input.Name {
		return nil
	}

	var dir string
	switch input.Source {
	case "novel":
		if input.NovelID <= 0 {
			return fmt.Errorf("小说 ID 无效")
		}
		dir = config.NovelSkillsDir(input.NovelID)
	case "user":
		dir = config.UserSkillsDir()
	default:
		return fmt.Errorf("只能重命名用户级或小说级技能")
	}

	if err := skill.RenameFile(dir, input.Name, input.NewName); err != nil {
		return fmt.Errorf("重命名技能失败: %w", err)
	}

	switch input.Source {
	case "novel":
		if err := a.skill.ReloadNovel(input.NovelID, dir); err != nil {
			a.logger.Warn("重命名技能后重新加载小说级技能失败", "err", err)
		}
	case "user":
		if err := a.skill.ReloadUser(dir); err != nil {
			a.logger.Warn("重命名技能后重新加载用户级技能失败", "err", err)
		}
	}
	return nil
}

// DuplicateSkillInput 是 DuplicateSkill 的入参。
type DuplicateSkillInput struct {
	NovelID      int64  `json:"novel_id"`
	Source       string `json:"source"`        // "builtin" | "user" | "novel"
	Name         string `json:"name"`
	TargetSource string `json:"target_source"` // "user" | "novel"
}

// DuplicateSkill 把技能复制到用户级或小说级（常用于把内置技能复制出来自定义）。
func (a *App) DuplicateSkill(input DuplicateSkillInput) error {
	if a.skill == nil {
		return fmt.Errorf("skill store 未初始化")
	}
	if err := validateSkillName(input.Name); err != nil {
		return err
	}
	target := input.TargetSource
	if target != "novel" && target != "user" {
		return fmt.Errorf("只能复制到用户级或小说级")
	}

	dstDir := config.UserSkillsDir()
	if target == "novel" {
		if input.NovelID <= 0 {
			return fmt.Errorf("小说 ID 无效")
		}
		dstDir = config.NovelSkillsDir(input.NovelID)
	}

	switch input.Source {
	case "builtin":
		sk, ok := a.skill.GetBuiltin(input.Name)
		if !ok {
			return fmt.Errorf("内置技能不存在: %s", input.Name)
		}
		dstPath := filepath.Join(dstDir, input.Name+".md")
		if _, err := os.Stat(dstPath); err == nil {
			return fmt.Errorf("目标位置已存在同名技能: %s", input.Name)
		}
		if err := os.MkdirAll(dstDir, 0755); err != nil {
			return fmt.Errorf("创建目录失败: %w", err)
		}
		if err := os.WriteFile(dstPath, []byte(sk.RawContent), 0644); err != nil {
			return fmt.Errorf("复制技能失败: %w", err)
		}
	case "user":
		if err := skill.CopyFile(config.UserSkillsDir(), dstDir, input.Name); err != nil {
			return fmt.Errorf("复制技能失败: %w", err)
		}
	case "novel":
		if input.NovelID <= 0 {
			return fmt.Errorf("小说 ID 无效")
		}
		if err := skill.CopyFile(config.NovelSkillsDir(input.NovelID), dstDir, input.Name); err != nil {
			return fmt.Errorf("复制技能失败: %w", err)
		}
	default:
		return fmt.Errorf("未知技能来源: %s", input.Source)
	}

	if input.NovelID > 0 {
		if err := a.skill.ReloadNovel(input.NovelID, config.NovelSkillsDir(input.NovelID)); err != nil {
			a.logger.Warn("复制技能后重新加载小说级技能失败", "err", err)
		}
	}
	if err := a.skill.ReloadUser(config.UserSkillsDir()); err != nil {
		a.logger.Warn("复制技能后重新加载用户级技能失败", "err", err)
	}
	return nil
}

// validateSkillName 校验技能名只能是不含路径分隔符、不含 .md 后缀的合法文件名。
func validateSkillName(name string) error {
	if name == "" {
		return fmt.Errorf("技能名称不能为空")
	}
	base := filepath.Base(name)
	if base != name || strings.Contains(name, ".md") || strings.ContainsAny(name, `\/`) {
		return fmt.Errorf("技能名称非法")
	}
	return nil
}
func (a *App) DeleteSkill(input DeleteSkillInput) error {
	if a.skill == nil {
		return fmt.Errorf("skill store 未初始化")
	}
	if input.Name == "" {
		return fmt.Errorf("技能名称不能为空")
	}
	name := strings.TrimSuffix(filepath.Base(input.Name), ".md")
	if name == "" || name != input.Name {
		return fmt.Errorf("技能名称非法")
	}

	source := input.Source
	if source != "novel" && source != "user" {
		return fmt.Errorf("只能删除用户级或小说级技能")
	}

	var filePath string
	switch source {
	case "novel":
		if input.NovelID <= 0 {
			return fmt.Errorf("小说 ID 无效")
		}
		var err error
		filePath, err = git.SafePath(config.NovelSkillsDir(input.NovelID), name+".md")
		if err != nil {
			return fmt.Errorf("技能名称非法: %w", err)
		}
	case "user":
		var err error
		filePath, err = git.SafePath(config.UserSkillsDir(), name+".md")
		if err != nil {
			return fmt.Errorf("技能名称非法: %w", err)
		}
	}

	// 移入回收站（可恢复），文件不存在才报错
	if _, err := os.Stat(filePath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("技能文件不存在: %s", name)
		}
		return fmt.Errorf("检查技能文件失败: %w", err)
	}
	if _, err := trash.MoveSkill(source, input.NovelID, filepath.Dir(filePath), name); err != nil {
		return fmt.Errorf("移入回收站失败: %w", err)
	}

	// 重新加载对应层级
	switch source {
	case "novel":
		if err := a.skill.ReloadNovel(input.NovelID, config.NovelSkillsDir(input.NovelID)); err != nil {
			a.logger.Warn("删除技能后重新加载小说级技能失败", "name", name, "err", err)
		}
	case "user":
		if err := a.skill.ReloadUser(config.UserSkillsDir()); err != nil {
			a.logger.Warn("删除技能后重新加载用户级技能失败", "name", name, "err", err)
		}
	}

	return nil
}

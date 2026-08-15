package agentcfg

import (
	"context"
	"fmt"
	"log/slog"

	"gorm.io/gorm"

	"novel/internal/git"
	"novel/internal/novel"
	"novel/internal/setting"
)

// NovelState 构建小说上下文快照（原 System3），每轮对话开头注入。
// 基本信息 + 故事状态 + 世界设定（全量）。具体数据（角色、时间线等）由 MCP 工具按需提供。
func NovelState(db *gorm.DB, novelID int64) (string, error) {
	logger := slog.Default()
	var n novel.Novel
	if err := db.First(&n, novelID).Error; err != nil {
		return "", fmt.Errorf("agentcfg: load novel %d: %w", novelID, err)
	}

	var b []byte
	b = append(b, "【小说基础信息】\n"...)
	b = append(b, fmt.Sprintf("书名：%s\n", n.Title)...)
	if n.Genre != "" {
		b = append(b, fmt.Sprintf("类型：%s\n", n.Genre)...)
	}
	if n.Description != "" {
		b = append(b, fmt.Sprintf("简介：%s\n", n.Description)...)
	}

	state, err := git.ReadFile(novelID, git.PlatinumPath())
	aiCfg := novel.ParseAIConfig(n.AIConfig)

	if aiCfg.InjectGoink && err == nil && state != "" {
		b = append(b, "\n【故事状态文档】\n"...)
		b = append(b, state...)
	}

	// 世界设定（设定管理）：按配置决定是否全量注入；每条带 [setting_id:N | 分类] 前缀
	if aiCfg.InjectWorld {
		var settings []setting.SettingItem
		if err := db.WithContext(context.Background()).
			Where("novel_id = ?", novelID).
			Order("category ASC, id ASC").
			Find(&settings).Error; err == nil && len(settings) > 0 {
			b = append(b, "\n【世界设定】\n"...)
			cur := ""
			for _, s := range settings {
				if s.Category != cur {
					cur = s.Category
					b = append(b, fmt.Sprintf("\n### %s\n", cur)...)
				}
				b = append(b, fmt.Sprintf("- [setting_id:%d | %s] %s\n", s.ID, s.Category, s.Content)...)
			}
		} else if err != nil {
			logger.Warn("读取世界设定失败", "novel_id", novelID, "err", err)
		}
	}

	// AI 功能配置声明（维护/读取范围，省 token）
	b = append(b, "\n"+aiCfg.String()+"\n"...)

	// 当前打开章节（用户说"本章"时指它）
	if cur := GetCurrentChapter(novelID); cur > 0 {
		b = append(b, fmt.Sprintf("\n【当前打开章节】第 %d 章（chapters/%03d.md，用户说\"本章\"时指这一章）\n", cur, cur)...)
	}

	return string(b), nil
}

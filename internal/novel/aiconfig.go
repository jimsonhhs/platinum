package novel

import (
	"encoding/json"
)

// AIConfig 是书籍级 AI 功能配置（省 token 用）。
// 空配置（全字段 false/空）视为"全开"（向后兼容）。
type AIConfig struct {
	InjectWorld bool     `json:"inject_world"` // 每轮注入世界设定（全量）
	InjectGoink bool     `json:"inject_goink"` // 每轮注入故事状态文档 platinum.md
	Maint       []string `json:"maint"`        // 维护模块：outline/character/timeline/reader/arc/goink；未列出不维护不读取
}

// AllModules 是所有可维护模块。
var AllModules = []string{"outline", "character", "timeline", "reader", "arc", "platinum"}

// ParseAIConfig 解析 ai_config JSON；空/非法返回全开配置。
func ParseAIConfig(raw string) AIConfig {
	if raw == "" {
		return AIConfig{InjectWorld: true, InjectGoink: true, Maint: AllModules}
	}
	var c AIConfig
	if err := json.Unmarshal([]byte(raw), &c); err != nil {
		return AIConfig{InjectWorld: true, InjectGoink: true, Maint: AllModules}
	}
	// 默认全开：字段缺失时（JSON 零值）视为开
	if len(c.Maint) == 0 {
		c.Maint = AllModules
	}
	return c
}

// HasMaint 判断某模块是否参与维护/读取。
func (c AIConfig) HasMaint(mod string) bool {
	for _, m := range c.Maint {
		// 兼容旧配置里的 "goink"（模块更名 platinum 前写入的数据）
		if m == mod || (mod == "platinum" && m == "goink") {
			return true
		}
	}
	return false
}

// String 返回可读的配置描述（注入 system prompt 用）。
func (c AIConfig) String() string {
	parts := []string{}
	if c.InjectWorld {
		parts = append(parts, "世界设定注入：开")
	} else {
		parts = append(parts, "世界设定注入：关")
	}
	if c.InjectGoink {
		parts = append(parts, "故事状态文档注入：开")
	} else {
		parts = append(parts, "故事状态文档注入：关")
	}
	parts = append(parts, "维护模块："+joinOrNone(c.Maint))
	return "【本书 AI 功能配置】" + join(parts, "；") + "。未列入维护模块的领域不要主动读取或维护（省 token）。"
}

func joinOrNone(list []string) string {
	if len(list) == 0 {
		return "无"
	}
	return join(list, "、")
}

func join(list []string, sep string) string {
	out := ""
	for i, s := range list {
		if i > 0 {
			out += sep
		}
		out += s
	}
	return out
}

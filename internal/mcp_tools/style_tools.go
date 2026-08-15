package mcp_tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"novel/internal/agentcfg"
	"novel/internal/novel"
)

// SetEnabledStyleArgs 是 set_enabled_style 的参数。
type SetEnabledStyleArgs struct {
	StyleName string `json:"style_name" jsonschema:"required,description=文风文件名（如 xxx.md，从 list_styles 获取）；传空字符串表示停用"`
}

// SetEnabledStyleTool 启用/停用当前书的文风（核心注入，下一轮对话生效）。
type SetEnabledStyleTool struct{}

func (t *SetEnabledStyleTool) Name() string           { return "set_enabled_style" }
func (t *SetEnabledStyleTool) Description() string    { return setEnabledStyleDescription }
func (t *SetEnabledStyleTool) Category() ToolCategory { return CategoryNovelManagement }

func (t *SetEnabledStyleTool) JSONSchema() json.RawMessage { return SchemaOf(SetEnabledStyleArgs{}) }
func (t *SetEnabledStyleTool) ExposeToLLM() bool           { return true }
func (t *SetEnabledStyleTool) NewArgs() any                { return &SetEnabledStyleArgs{} }

const setEnabledStyleDescription = `启用或停用当前小说的文风（用户说"启用《xxx》文风"/"使用xx文风"时调用）。style_name 传文风文件名（list_styles 可查），传空字符串停用。启用后该文风作为核心注入加入 AI 上下文（下一轮对话生效）。调用前先 list_styles 确认文风存在。`

func (t *SetEnabledStyleTool) Execute(ctx context.Context, args any, tc ToolContext) (*ToolResult, error) {
	a := args.(*SetEnabledStyleArgs)
	if tc.NovelID <= 0 {
		return &ToolResult{Success: false, Error: "set_enabled_style: 需要先选择小说"}, nil
	}
	name := strings.TrimSpace(a.StyleName)
	if name != "" && (strings.ContainsAny(name, `/\`) || filepath.Ext(name) != ".md") {
		return &ToolResult{Success: false, Error: "set_enabled_style: 无效的文风文件名"}, nil
	}
	if name != "" {
		if _, err := os.Stat(filepath.Join(agentcfg.StylesDir(), name)); err != nil {
			return &ToolResult{Success: false, Error: fmt.Sprintf("set_enabled_style: 文风不存在: %s（可先 list_styles 查看可用文风）", name)}, nil
		}
	}
	if err := tc.DB.WithContext(ctx).Model(&novel.Novel{}).
		Where("id = ?", tc.NovelID).Update("enabled_style", name).Error; err != nil {
		return nil, fmt.Errorf("set_enabled_style: %w", err)
	}
	note := "已停用文风"
	if name != "" {
		note = fmt.Sprintf("已启用文风 %s（下一轮对话作为核心注入生效，写作时必须遵守该文风）", name)
	}
	return &ToolResult{Success: true, Data: map[string]any{"enabled_style": name, "note": note}}, nil
}

// ListStylesTool 列出全局文风库（AI 查可用文风用）。
type ListStylesTool struct{}

func (t *ListStylesTool) Name() string           { return "list_styles" }
func (t *ListStylesTool) Description() string    { return "列出全局文风库中全部文风（文件名）。配合 set_enabled_style 使用。" }
func (t *ListStylesTool) Category() ToolCategory { return CategoryNovelManagement }

func (t *ListStylesTool) JSONSchema() json.RawMessage { return SchemaOf(struct{}{}) }
func (t *ListStylesTool) ExposeToLLM() bool           { return true }
func (t *ListStylesTool) NewArgs() any                { return &struct{}{} }

func (t *ListStylesTool) Execute(ctx context.Context, args any, tc ToolContext) (*ToolResult, error) {
	dir := agentcfg.StylesDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return &ToolResult{Success: true, Data: map[string]any{"styles": []string{}, "note": "文风库为空"}}, nil
		}
		return nil, fmt.Errorf("list_styles: %w", err)
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".md") {
			names = append(names, e.Name())
		}
	}
	return &ToolResult{Success: true, Data: map[string]any{"styles": names, "note": "用 set_enabled_style 启用其中一个"}}, nil
}

package mcp_tools

import (
	"context"
	"encoding/json"
	"fmt"

	"novel/internal/setting"
)

// ── upsert_setting ────────────────────────────────────────

// UpsertSettingArgs 是 upsert_setting 的参数。
type UpsertSettingArgs struct {
	SettingID int64  `json:"setting_id" jsonschema:"description=设定 ID。传入=更新该条（PATCH 语义，只改传入字段）；不传=新建（同分类同主题自动合并更新）"`
	Category  string `json:"category" jsonschema:"required,description=分类标签：世界观 / 力量体系 / 角色 / 地理 / 势力 / 社会 / 物品 / 设定 等"`
	Content   string `json:"content" jsonschema:"required,description=设定内容"`
}

// UpsertSettingTool 新建或更新一条世界设定。
type UpsertSettingTool struct{}

func (t *UpsertSettingTool) Name() string           { return "upsert_setting" }
func (t *UpsertSettingTool) Description() string    { return upsertSettingDescription }
func (t *UpsertSettingTool) Category() ToolCategory { return CategoryWritingAssistant }

func (t *UpsertSettingTool) JSONSchema() json.RawMessage { return SchemaOf(UpsertSettingArgs{}) }
func (t *UpsertSettingTool) ExposeToLLM() bool           { return true }
func (t *UpsertSettingTool) NewArgs() any                { return &UpsertSettingArgs{} }

const upsertSettingDescription = `新建或更新一条世界设定（小说设定的结构化存储，数据库 setting_items 表）。会话开头所有设定会全量注入上下文，每条带 [setting_id:N | 分类] 前缀。修改或新增设定用本工具：
- 传 setting_id：PATCH 语义，只更新传入的字段（分类/内容），其余保持不变。
- 不传 setting_id：新建；若同分类存在主题相同的条目（内容开头一致）则自动合并更新，避免重复。
- 删除设定用 delete_record（table=setting）。
工具返回值即该设定的最新状态（真值）。`

func (t *UpsertSettingTool) Execute(ctx context.Context, args any, tc ToolContext) (*ToolResult, error) {
	a := args.(*UpsertSettingArgs)
	if tc.NovelID <= 0 {
		return &ToolResult{Success: false, Error: "upsert_setting: 未在小说上下文中"}, nil
	}
	store := setting.NewStore(tc.DB)
	item, err := store.Upsert(ctx, tc.NovelID, a.SettingID, a.Category, a.Content)
	if err != nil {
		return nil, fmt.Errorf("upsert_setting: %w", err)
	}
	return &ToolResult{
		Success: true,
		Data: map[string]any{
			"setting_id": item.ID,
			"category":   item.Category,
			"content":    item.Content,
			"updated_at": item.UpdatedAt,
		},
	}, nil
}

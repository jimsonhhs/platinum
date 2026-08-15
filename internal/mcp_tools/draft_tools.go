package mcp_tools

import (
	"context"
	"encoding/json"
	"fmt"

	"novel/internal/draft"
)

// ── copy_to_draft ─────────────────────────────────────────

// CopyToDraftArgs 是 copy_to_draft 的参数。
type CopyToDraftArgs struct {
	ChapterNumber int `json:"chapter_number" jsonschema:"required,description=章节号（正文文件 chapters/NNN.md 对应的数字）"`
}

// CopyToDraftTool 把正文文件级复制为草稿（零生成 token 的本地操作）。
type CopyToDraftTool struct{}

func (t *CopyToDraftTool) Name() string           { return "copy_to_draft" }
func (t *CopyToDraftTool) Description() string    { return copyToDraftDescription }
func (t *CopyToDraftTool) Category() ToolCategory { return CategoryWritingAssistant }

func (t *CopyToDraftTool) JSONSchema() json.RawMessage { return SchemaOf(CopyToDraftArgs{}) }
func (t *CopyToDraftTool) ExposeToLLM() bool           { return true }
func (t *CopyToDraftTool) NewArgs() any                { return &CopyToDraftArgs{} }

const copyToDraftDescription = `把指定章节的正文文件级复制为草稿（drafts/NNN.md），用于开始润色前初始化草稿。纯本地文件操作，不消耗生成 token。若草稿已有内容会自动归档到历史（不丢失）。润色/改写内容请写入草稿（edit drafts/NNN.md），禁止直接修改正文 chapters/。`

func (t *CopyToDraftTool) Execute(ctx context.Context, args any, tc ToolContext) (*ToolResult, error) {
	a := args.(*CopyToDraftArgs)
	if tc.NovelID <= 0 || a.ChapterNumber <= 0 {
		return &ToolResult{Success: false, Error: "copy_to_draft: 参数无效"}, nil
	}
	if err := draft.CopyToDraft(tc.NovelID, a.ChapterNumber, draft.DefaultLimit); err != nil {
		return nil, fmt.Errorf("copy_to_draft: %w", err)
	}
	return &ToolResult{
		Success: true,
		Data:    map[string]any{"draft": fmt.Sprintf("drafts/%03d.md", a.ChapterNumber)},
	}, nil
}

// ── import_draft ──────────────────────────────────────────

// ImportDraftArgs 是 import_draft 的参数。
type ImportDraftArgs struct {
	ChapterNumber int `json:"chapter_number" jsonschema:"required,description=章节号"`
}

// ImportDraftTool 把草稿发布为正文（文件级替换，零生成 token）。
type ImportDraftTool struct{}

func (t *ImportDraftTool) Name() string           { return "import_draft" }
func (t *ImportDraftTool) Description() string    { return importDraftDescription }
func (t *ImportDraftTool) Category() ToolCategory { return CategoryWritingAssistant }

func (t *ImportDraftTool) JSONSchema() json.RawMessage { return SchemaOf(ImportDraftArgs{}) }
func (t *ImportDraftTool) ExposeToLLM() bool           { return true }
func (t *ImportDraftTool) NewArgs() any                { return &ImportDraftArgs{} }

const importDraftDescription = `把草稿（drafts/NNN.md）发布为正文（chapters/NNN.md）。文件级替换，不消耗生成 token；当前正文自动归档到草稿历史（不丢失），草稿保留在工作区。章节不存在时自动创建。调用前必须获得用户明确确认（用户说"导入"或"发布到正文"）。`

func (t *ImportDraftTool) Execute(ctx context.Context, args any, tc ToolContext) (*ToolResult, error) {
	a := args.(*ImportDraftArgs)
	if tc.NovelID <= 0 || a.ChapterNumber <= 0 {
		return &ToolResult{Success: false, Error: "import_draft: 参数无效"}, nil
	}
	if err := draft.ImportDraft(tc.DB, tc.NovelID, a.ChapterNumber, draft.DefaultLimit); err != nil {
		return nil, fmt.Errorf("import_draft: %w", err)
	}
	return &ToolResult{
		Success: true,
		Data: map[string]any{
			"chapter": fmt.Sprintf("chapters/%03d.md", a.ChapterNumber),
			"note":    "已发布；当前正文已归档到草稿历史",
		},
	}, nil
}

package mcp_tools

import (
	"context"
	"encoding/json"
	"fmt"

	"novel/internal/chapter"
)

// ── update_prev_chapter ──────────────────────────────────

// UpdatePrevChapterArgs 是 update_prev_chapter 的参数。
type UpdatePrevChapterArgs struct {
	NovelID          int64 `json:"novel_id" jsonschema:"required,description=小说 ID"`
	ChapterNumber    int   `json:"chapter_number" jsonschema:"required,description=要更新的章节号"`
	PrevChapterNumber int  `json:"prev_chapter_number" jsonschema:"required,description=真实的上一章章节号（跨空洞），0 表示无上一章"`
}

// UpdatePrevChapterTool 更新章节的"上一章"记录（故事链指针）。
type UpdatePrevChapterTool struct{}

func (t *UpdatePrevChapterTool) Name() string           { return "update_prev_chapter" }
func (t *UpdatePrevChapterTool) Description() string    { return updatePrevChapterDescription }
func (t *UpdatePrevChapterTool) Category() ToolCategory { return CategoryWritingAssistant }

func (t *UpdatePrevChapterTool) JSONSchema() json.RawMessage { return SchemaOf(UpdatePrevChapterArgs{}) }
func (t *UpdatePrevChapterTool) ExposeToLLM() bool           { return true }
func (t *UpdatePrevChapterTool) NewArgs() any                { return &UpdatePrevChapterArgs{} }

const updatePrevChapterDescription = `更新章节的"上一章"记录（prev_chapter_number），用于修正故事链指针。新建章节时系统会自动记录上一章；当章节关系变化（删除/恢复/重排）导致默认记录不准确时，用此工具修正。读取上一章直接用 get_chapter_list（返回 prev_chapter_number），无需推导。`

func (t *UpdatePrevChapterTool) Execute(ctx context.Context, args any, tc ToolContext) (*ToolResult, error) {
	a := args.(*UpdatePrevChapterArgs)
	if a.NovelID <= 0 || a.ChapterNumber <= 0 || a.PrevChapterNumber < 0 || a.PrevChapterNumber == a.ChapterNumber {
		return &ToolResult{Success: false, Error: "update_prev_chapter: 参数无效"}, nil
	}
	res := tc.DB.WithContext(ctx).Model(&chapter.Chapter{}).
		Where("novel_id = ? AND chapter_number = ?", a.NovelID, a.ChapterNumber).
		Update("prev_chapter_number", a.PrevChapterNumber)
	if res.Error != nil {
		return nil, fmt.Errorf("update_prev_chapter: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return &ToolResult{Success: false, Error: "update_prev_chapter: 章节不存在"}, nil
	}
	return &ToolResult{Success: true, Data: map[string]any{"updated": true}}, nil
}

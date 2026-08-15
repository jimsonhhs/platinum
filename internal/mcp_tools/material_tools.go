package mcp_tools

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	imp "novel/internal/import"
)

// AnalyzeMaterialArgs 是 analyze_material 的参数。
type AnalyzeMaterialArgs struct {
	FilePath string `json:"file_path" jsonschema:"required,description=本地素材文件绝对路径（txt/md），例如 C:\\books\\xxx.txt"`
}

// AnalyzeMaterialTool 解析本地素材文件的章节结构（纯本地，零 token 或极省），供 AI 定位提取范围。
type AnalyzeMaterialTool struct{}

func (t *AnalyzeMaterialTool) Name() string           { return "analyze_material" }
func (t *AnalyzeMaterialTool) Description() string    { return analyzeMaterialDescription }
func (t *AnalyzeMaterialTool) Category() ToolCategory { return CategoryNovelManagement }

func (t *AnalyzeMaterialTool) JSONSchema() json.RawMessage { return SchemaOf(AnalyzeMaterialArgs{}) }
func (t *AnalyzeMaterialTool) ExposeToLLM() bool           { return true }
func (t *AnalyzeMaterialTool) NewArgs() any                { return &AnalyzeMaterialArgs{} }

const analyzeMaterialDescription = `解析本地素材文件（txt/md）的章节结构，返回章节列表（序号+标题）。用于"提取某本书的文风/从第几章到第几章"这类需求——先调用本工具拿到章节序号，再让用户在素材面板选择范围提取。纯本地文件解析，不消耗生成 token。`

func (t *AnalyzeMaterialTool) Execute(ctx context.Context, args any, tc ToolContext) (*ToolResult, error) {
	a := args.(*AnalyzeMaterialArgs)
	if a.FilePath == "" {
		return &ToolResult{Success: false, Error: "analyze_material: 缺少文件路径"}, nil
	}
	ext := strings.ToLower(filepath.Ext(a.FilePath))
	if ext != ".txt" && ext != ".md" && ext != ".markdown" {
		return &ToolResult{Success: false, Error: "analyze_material: 仅支持 txt/md 文件"}, nil
	}
	if _, err := os.Stat(a.FilePath); err != nil {
		return &ToolResult{Success: false, Error: fmt.Sprintf("analyze_material: 文件不存在: %v", err)}, nil
	}
	result, err := imp.Parse(a.FilePath, slog.Default())
	if err != nil {
		return &ToolResult{Success: false, Error: fmt.Sprintf("analyze_material: 解析失败: %v", err)}, nil
	}
	type entry struct {
		Index int    `json:"index"`
		Title string `json:"title"`
	}
	list := make([]entry, 0, len(result.Chapters))
	for i, ch := range result.Chapters {
		list = append(list, entry{Index: i + 1, Title: ch.Title})
	}
	note := "提取时请在素材面板选择对应序号范围（起始章/结束章），或让用户确认。"
	if len(list) == 0 {
		note = "未解析出章节标记（可能全书无分章）。可将整本作为一段样本，或让用户在素材面板手动添加片段。"
	}
	return &ToolResult{
		Success: true,
		Data: map[string]any{
			"file_name": filepath.Base(a.FilePath),
			"chapters":  list,
			"note":      note,
		},
	}, nil
}

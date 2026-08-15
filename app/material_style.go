package app

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	imp "novel/internal/import"
	"novel/internal/agent"
	"novel/internal/style"
)

// MaterialChapter 是素材文件解析出的章节条目（不含正文，轻量展示）。
type MaterialChapter struct {
	Index int    `json:"index"` // 1-based
	Title string `json:"title"`
}

// MaterialMeta 是选中素材文件的元信息。
type MaterialMeta struct {
	FilePath string            `json:"file_path"`
	FileName string            `json:"file_name"`
	Chapters []MaterialChapter `json:"chapters"`
}

// SelectMaterialFile 打开文件对话框选择素材（txt/md），解析出章节目录。
func (a *App) SelectMaterialFile() (*MaterialMeta, error) {
	filePath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择素材文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "文本素材 (*.txt, *.md)", Pattern: "*.txt;*.md;*.markdown"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("选择文件失败: %w", err)
	}
	if filePath == "" {
		return nil, nil // 取消
	}
	return a.parseMaterial(filePath)
}

func (a *App) parseMaterial(filePath string) (*MaterialMeta, error) {
	result, err := imp.Parse(filePath, a.logger)
	if err != nil {
		return nil, fmt.Errorf("解析素材失败: %w", err)
	}
	meta := &MaterialMeta{
		FilePath: filePath,
		FileName: filepath.Base(filePath),
		Chapters: make([]MaterialChapter, 0, len(result.Chapters)),
	}
	for i, ch := range result.Chapters {
		meta.Chapters = append(meta.Chapters, MaterialChapter{Index: i + 1, Title: ch.Title})
	}
	if len(meta.Chapters) == 0 {
		meta.Chapters = append(meta.Chapters, MaterialChapter{Index: 1, Title: "全文"})
	}
	return meta, nil
}

// ExtractMaterialStyleInput 是从素材文件提取文风的入参。
type ExtractMaterialStyleInput struct {
	TaskID          string `json:"task_id"`
	FilePath        string `json:"file_path"`
	StartIndex      int    `json:"start_index"` // 1-based，对应解析出的章节序号
	EndIndex        int    `json:"end_index"`
	ProviderName    string `json:"provider_name"`
	ModelID         string `json:"model_id"`
	ReasoningEffort string `json:"reasoning_effort"`
}

// ExtractMaterialStyle 从素材文件的指定章节范围提取写作风格，生成仿写 skill。
func (a *App) ExtractMaterialStyle(input ExtractMaterialStyleInput) (*style.ExtractResult, error) {
	if a.llmClient == nil {
		return nil, fmt.Errorf("LLM 客户端未初始化")
	}
	if input.FilePath == "" {
		return nil, fmt.Errorf("请先选择素材文件")
	}
	ext := strings.ToLower(filepath.Ext(input.FilePath))
	if ext != ".txt" && ext != ".md" && ext != ".markdown" {
		return nil, fmt.Errorf("仅支持 txt/md 素材文件")
	}
	result, err := imp.Parse(input.FilePath, a.logger)
	if err != nil {
		return nil, fmt.Errorf("解析素材失败: %w", err)
	}
	start, end := input.StartIndex, input.EndIndex
	if start < 1 {
		start = 1
	}
	if end < start || end > len(result.Chapters) {
		end = len(result.Chapters)
	}
	if len(result.Chapters) == 0 {
		return nil, fmt.Errorf("素材中没有解析出章节")
	}
	var samples []style.Sample
	for i := start - 1; i < end; i++ {
		ch := result.Chapters[i]
		samples = append(samples, style.Sample{
			Name:    ch.Title,
			Content: ch.Content,
		})
	}

	key := agent.CancelPrefixStyle + input.TaskID
	ctx, cancel := context.WithCancel(a.ctx)
	a.cancelMgr.Cancel(key)
	a.cancelMgr.Register(key, cancel)
	defer func() {
		if ctx.Err() == nil {
			a.cancelMgr.Unregister(key)
		}
	}()

	return style.Extract(ctx, a.llmClient, samples,
		input.ProviderName, input.ModelID, input.ReasoningEffort,
		a.emitStyleExtractProgress(input.TaskID))
}

// emitStyleExtractProgress 把文风提取推导过程实时推送给前端（style:extract-progress 事件）。
// 纯实时展示，不持久化。
func (a *App) emitStyleExtractProgress(taskID string) func(style.ExtractProgress) {
	return func(p style.ExtractProgress) {
		if a.ctx == nil {
			return
		}
		runtime.EventsEmit(a.ctx, "style:extract-progress", map[string]any{
			"task_id":   taskID,
			"kind":      p.Kind,
			"data":      p.Data,
			"stage_msg": p.StageMsg,
		})
	}
}

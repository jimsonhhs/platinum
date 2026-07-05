package app

import (
	"context"
	"fmt"

	"novel/internal/style"
)

// StyleSampleMeta 是前端需要的素材摘要（不含全文）。
type StyleSampleMeta struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Preview   string   `json:"preview"` // 前 120 字预览
	Tags      []string `json:"tags"`
	WordCount int      `json:"word_count"`
	CreatedAt string   `json:"created_at"`
}

// ListStyleSamples 返回所有风格素材。
func (a *App) ListStyleSamples() ([]StyleSampleMeta, error) {
	samples, err := a.style.List()
	if err != nil {
		return nil, fmt.Errorf("list style samples: %w", err)
	}
	result := make([]StyleSampleMeta, len(samples))
	for i, s := range samples {
		preview := s.Content
		runes := []rune(preview)
		if len(runes) > 120 {
			preview = string(runes[:120]) + "…"
		}
		result[i] = StyleSampleMeta{
			ID:        s.ID,
			Name:      s.Name,
			Preview:   preview,
			Tags:      s.Tags,
			WordCount: s.WordCount,
			CreatedAt: s.CreatedAt.Format("2006-01-02 15:04"),
		}
	}
	return result, nil
}

// CreateStyleSampleInput 是创建风格素材的入参。
type CreateStyleSampleInput struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

// CreateStyleSample 创建一条风格素材。
func (a *App) CreateStyleSample(input CreateStyleSampleInput) (*StyleSampleMeta, error) {
	s, err := a.style.Create(input.Name, input.Content)
	if err != nil {
		return nil, fmt.Errorf("create style sample: %w", err)
	}
	preview := s.Content
	runes := []rune(preview)
	if len(runes) > 120 {
		preview = string(runes[:120]) + "…"
	}
	return &StyleSampleMeta{
		ID:        s.ID,
		Name:      s.Name,
		Preview:   preview,
		Tags:      s.Tags,
		WordCount: s.WordCount,
		CreatedAt: s.CreatedAt.Format("2006-01-02 15:04"),
	}, nil
}

// UpdateStyleSampleInput 是更新风格素材的入参。
//nolint:omitempty — 走文件 I/O，不用 PatchAndSave，无需 omitempty
type UpdateStyleSampleInput struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Content string   `json:"content"`
	Tags    []string `json:"tags"`
}

// UpdateStyleSample 更新一条风格素材。
func (a *App) UpdateStyleSample(input UpdateStyleSampleInput) error {
	if err := a.style.Update(input.ID, input.Name, input.Content, input.Tags); err != nil {
		return fmt.Errorf("update style sample: %w", err)
	}
	return nil
}

// GetStyleSample 获取单条风格素材的完整内容。
func (a *App) GetStyleSample(id string) (*style.Sample, error) {
	return a.style.Load(id)
}

// DeleteStyleSampleInput 是删除风格素材的入参。
type DeleteStyleSampleInput struct {
	ID string `json:"id"`
}

// DeleteStyleSample 删除一条风格素材。
func (a *App) DeleteStyleSample(input DeleteStyleSampleInput) error {
	return a.style.Delete(input.ID)
}

// ComputeStyleStatsInput 是计算风格统计的入参。
type ComputeStyleStatsInput struct {
	SampleIDs []string `json:"sample_ids"`
}

// ComputeStyleStats 对指定的风格素材进行确定性文本统计。
func (a *App) ComputeStyleStats(input ComputeStyleStatsInput) (*style.Stats, error) {
	all, err := a.style.List()
	if err != nil {
		return nil, fmt.Errorf("compute style stats: %w", err)
	}
	idSet := make(map[string]bool)
	for _, id := range input.SampleIDs {
		idSet[id] = true
	}
	var selected []style.Sample
	for _, s := range all {
		if idSet[s.ID] {
			selected = append(selected, s)
		}
	}
	if len(selected) == 0 {
		return nil, fmt.Errorf("没有选中的素材")
	}
	stats := a.style.ComputeStats(selected)
	return &stats, nil
}

// ExtractStyleInput 是风格提取的入参。
type ExtractStyleInput struct {
	TaskID          string   `json:"task_id"`
	SampleIDs       []string `json:"sample_ids"`
	ProviderName    string   `json:"provider_name"`
	ModelID         string   `json:"model_id"`
	ReasoningEffort string   `json:"reasoning_effort"`
}

// ExtractStyle 从选中的素材中提取写作风格，生成仿写 skill。
func (a *App) ExtractStyle(input ExtractStyleInput) (*style.ExtractResult, error) {
	if a.llmClient == nil {
		return nil, fmt.Errorf("LLM 客户端未初始化")
	}
	if len(input.SampleIDs) == 0 {
		return nil, fmt.Errorf("请选择至少一段素材")
	}

	// 加载选中素材
	var samples []style.Sample
	for _, id := range input.SampleIDs {
		s, err := a.style.Load(id)
		if err != nil {
			return nil, fmt.Errorf("加载素材 %s 失败: %w", id, err)
		}
		samples = append(samples, *s)
	}

	// 取消逻辑由 app 层管理
	ctx, cancel := context.WithCancel(a.ctx)
	a.cancelMgr.Cancel(input.TaskID)
	a.cancelMgr.Register(input.TaskID, cancel)
	defer func() {
		if ctx.Err() == nil {
			a.cancelMgr.Unregister(input.TaskID)
		}
	}()

	return a.style.Extract(ctx, a.llmClient, samples,
		input.ProviderName, input.ModelID, input.ReasoningEffort)
}

// CancelExtract 取消指定 taskID 的风格提取任务。
func (a *App) CancelExtract(taskID string) {
	a.cancelMgr.Cancel(taskID)
}

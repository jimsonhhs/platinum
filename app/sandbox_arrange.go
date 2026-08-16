package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"novel/internal/character"
	"novel/internal/llm"
	"novel/internal/location"
	"novel/internal/timeline"
)

// ── 沙盘 AI 布局：根据故事设定自动生成/增量摆放形状 ──────────

// ArrangeSandboxInput 是 AI 布局入参。
type ArrangeSandboxInput struct {
	NovelID  int64  `json:"novel_id"`
	SandboxID string `json:"sandbox_id"`
	Prompt   string `json:"prompt"` // 可选：布局指令/增量指令，如"在王国东边新建临海城"
	ProviderName string `json:"provider_name"`
	ModelID      string `json:"model_id"`
}

// arrangeSystemPrompt 指导 LLM 输出沙盘布局 JSON。
const arrangeSystemPrompt = `你是小说沙盘布局师。根据给定的小说设定（地点/角色/事件），为沙盘生成布局。

规则：
1. 输出严格的 JSON 数组（不要 markdown 代码块），每个元素：
   {"kind":"location|character|event","id":数字,"name":"名字","x":0-1000,"y":0-1000,"w":数字,"h":数字,"fill":"#RRGGBB","shape":"drop|person|event|rect|triangle|wave|circle","textPos":"top|middle|bottom","star":0-5}
2. x/y 是形状中心坐标（0-1000 空间），按空间关系摆放：相邻/包含/距离远近要符合设定描述。
3. 地点形状按刻板印象模板：森林→rect(绿#2e7d32)、河流/海→wave(蓝#1565c0)、山→triangle(灰#616161)、城堡/城市→rect(灰白#9e9e9e)、火山→triangle(红#d32f2f)、冰原→rect(白#eceff1)、深渊→circle(紫#7b1fa2)、血池→circle(红#b71c1c)、洞穴→arc(棕#795548)、沙漠→circle(黄#f9a825)；描述里有区域大小就按比例给 w/h。
4. 角色→person 形状，颜色用 #ff6b6b 系；事件→event 形状（镂空问号），star 用重要性。
5. 增量模式：提示词是"在XXX旁边新建YYY"时，只输出新增项，并参照已给出的现有形状坐标合理放置（相邻/方向）。
6. 不要输出任何解释文字，只要 JSON 数组。`

// CancelArrange 取消正在进行的沙盘 AI 布局（若存在）。
// 布局中调用后：LLM 流被中止，ArrangeSandbox 返回错误，前端据此提示已取消。
func (a *App) CancelArrange() {
	if a.arrangeCancel != nil {
		a.arrangeCancel()
	}
}

// ArrangeSandbox 调用 LLM 生成沙盘布局并保存。
// prompt 为空=全量布局；非空=增量布局（按指令新增，保留现有形状）。
// 使用请求级可取消 ctx：用户可随时调用 CancelArrange 中止本次布局。
func (a *App) ArrangeSandbox(input ArrangeSandboxInput) (*SandboxData, error) {
	if a.llmClient == nil {
		return nil, fmt.Errorf("LLM 客户端未初始化")
	}
	if input.ProviderName == "" || input.ModelID == "" {
		return nil, fmt.Errorf("请先在设置中选择模型")
	}

	// 请求级可取消上下文
	ctx, cancel := context.WithCancel(a.ctx)
	a.arrangeCancel = cancel
	defer func() { a.arrangeCancel = nil; cancel() }()

	// 1. 收集设定数据
	locsRes, err := a.location.ListByNovel(ctx, input.NovelID, location.ListByNovelOptions{})
	if err != nil {
		return nil, fmt.Errorf("读取地点失败: %w", err)
	}
	locs := locsRes.Items
	charsRes, err := a.character.ListByNovel(ctx, input.NovelID, character.ListByNovelOptions{})
	if err != nil {
		return nil, fmt.Errorf("读取角色失败: %w", err)
	}
	chars := charsRes.Items
	tlsRes, err := a.timeline.ListByNovel(ctx, input.NovelID, timeline.ListByNovelOptions{})
	if err != nil {
		return nil, fmt.Errorf("读取事件失败: %w", err)
	}
	tls := tlsRes.Items

	// 2. 现有沙盘形状（增量模式需要参照坐标）
	existing, err := a.GetSandbox(input.NovelID, input.SandboxID)
	if err != nil {
		return nil, err
	}
	existingJSON := "无"
	if len(existing.Shapes) > 0 {
		b, _ := json.Marshal(existing.Shapes)
		existingJSON = string(b)
	}

	// 3. 组装 prompt
	sb := &strings.Builder{}
	sb.WriteString("【现有沙盘形状】\n")
	sb.WriteString(existingJSON)
	sb.WriteString("\n\n【地点设定】\n")
	for _, l := range locs {
		sb.WriteString(fmt.Sprintf("- %s（类型:%s）描述:%s 标签:%s\n", l.Name, l.LocationType, l.Description, l.Tags))
	}
	sb.WriteString("\n【角色设定】\n")
	for _, c := range chars {
		sb.WriteString(fmt.Sprintf("- %s 描述:%s\n", c.Name, c.Description))
	}
	sb.WriteString("\n【事件设定】\n")
	for _, t := range tls {
		sb.WriteString(fmt.Sprintf("- %s（重要度%d，类型:%s）内容:%s\n", t.Title, t.Importance, t.Category, t.Content))
	}
	sb.WriteString("\n【用户指令】\n")
	if strings.TrimSpace(input.Prompt) == "" {
		sb.WriteString("请根据以上设定，为全部地点/角色/事件生成完整布局。")
	} else {
		sb.WriteString(input.Prompt)
	}

	// 4. 调 LLM
	msgs := []map[string]any{
		{"role": "system", "content": arrangeSystemPrompt},
		{"role": "user", "content": sb.String()},
	}
	opts := &llm.CallOptions{}
	var raw strings.Builder
	for evt := range a.llmClient.ChatStream(ctx, input.ProviderName, msgs, nil, input.ModelID, opts) {
		if evt.Type == llm.EventError {
			return nil, fmt.Errorf("LLM 调用失败: %w", evt.Error)
		}
		if evt.Type == llm.EventContent {
			raw.WriteString(evt.Data)
		}
	}
	text := strings.TrimSpace(raw.String())
	text = strings.TrimPrefix(text, "```json")
	text = strings.TrimPrefix(text, "```")
	text = strings.TrimSuffix(text, "```")

	// 5. 解析 LLM 输出
	var items []struct {
		Kind     string  `json:"kind"`
		ID       int64   `json:"id"`
		Name     string  `json:"name"`
		X        float64 `json:"x"`
		Y        float64 `json:"y"`
		W        float64 `json:"w"`
		H        float64 `json:"h"`
		Fill     string  `json:"fill"`
		Shape    string  `json:"shape"`
		TextPos  string  `json:"textPos"`
		Star     int     `json:"star"`
	}
	if err := json.Unmarshal([]byte(text), &items); err != nil {
		// 容错：尝试找第一个 [ 到最后一个 ]
		si, ei := strings.Index(text, "["), strings.LastIndex(text, "]")
		if si >= 0 && ei > si {
			if err2 := json.Unmarshal([]byte(text[si:ei+1]), &items); err2 != nil {
				return nil, fmt.Errorf("解析布局失败: %w", err2)
			}
		} else {
			return nil, fmt.Errorf("解析布局失败: %w", err)
		}
	}

	// 6. 生成形状（映射到 1200x800 画布）
	newShapes := []SandboxShape{}
	idCounter := 0
	genID := func() string { idCounter++; return fmt.Sprintf("ai_%d_%d", input.NovelID, idCounter) }
	for _, it := range items {
		shapeType := it.Shape
		if shapeType == "" {
			switch it.Kind {
			case "location":
				shapeType = "rect"
			case "character":
				shapeType = "person"
			case "event":
				shapeType = "event"
			default:
				shapeType = "rect"
			}
		}
		// 校验形状类型合法
		valid := map[string]bool{"rect": true, "circle": true, "wave": true, "arc": true, "diamond": true, "triangle": true, "drop": true, "person": true, "event": true}
		if !valid[shapeType] {
			shapeType = "rect"
		}
		w, h := it.W, it.H
		if w <= 0 || h <= 0 {
			w, h = 120, 90
		}
		fill := it.Fill
		if fill == "" {
			fill = "#6bcb77"
		}
		textPos := it.TextPos
		if textPos != "top" && textPos != "middle" && textPos != "bottom" {
			textPos = "top"
		}
		entityType := ""
		entityID := int64(0)
		switch it.Kind {
		case "location":
			entityType = "location"
		case "character":
			entityType = "character"
		case "event":
			entityType = "timeline"
		}
		entityID = it.ID
		// 中心坐标 → 左上角
		newShapes = append(newShapes, SandboxShape{
			ID: genID(), Type: shapeType,
			X: it.X - w/2, Y: it.Y - h/2,
			W: w, H: h, Rotation: 0,
			Fill: fill, FillOpacity: 0.35,
			Stroke: fill, StrokeWidth: 2,
			Label: it.Name, TextPos: textPos,
			EntityType: entityType, EntityID: entityID,
			Star: it.Star,
		})
	}

	// 7. 合并：增量模式保留现有形状（按 id 去重新增实体）
	finalShapes := existing.Shapes
	if len(finalShapes) == 0 {
		finalShapes = []SandboxShape{}
	}
	if strings.TrimSpace(input.Prompt) == "" {
		// 全量：替换
		finalShapes = newShapes
	} else {
		// 增量：去掉同实体已有形状，追加新的
		keep := []SandboxShape{}
		for _, s := range existing.Shapes {
			dup := false
			for _, ns := range newShapes {
				if s.EntityType == ns.EntityType && s.EntityID == ns.EntityID && s.EntityID > 0 {
					dup = true
					break
				}
			}
			if !dup {
				keep = append(keep, s)
			}
		}
		finalShapes = append(keep, newShapes...)
	}

	// 8. 保存
	sd := &SandboxData{
		Name:        existing.Name,
		Description: existing.Description,
		Shapes:      finalShapes,
		ViewX:       existing.ViewX,
		ViewY:       existing.ViewY,
		Scale:       existing.Scale,
	}
	if err := a.SaveSandbox(input.NovelID, input.SandboxID, sd); err != nil {
		return nil, err
	}
	return sd, nil
}

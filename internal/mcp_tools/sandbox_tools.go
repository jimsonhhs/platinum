package mcp_tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"novel/internal/character"
	"novel/internal/git"
	"novel/internal/location"
	"novel/internal/timeline"
	"gorm.io/gorm"
)

// ── arrange_sandbox：根据设定（含空间关系）布局沙盘 ──────────

// SandboxOp 是一条结构化布局操作（AI 从用户自然语言解析后填入）。
type SandboxOp struct {
	Op      string `json:"op"`                // "move" | "delete" | "add"
	Target  string `json:"target"`            // 操作对象名（move/delete 的目标；add 的新名称）
	Anchor  string `json:"anchor,omitempty"`  // 参照对象名（move/add 时）
	Dir     string `json:"dir,omitempty"`     // 方位：north/south/east/west/ne/nw/se/sw/beside/center
	Nearby  bool   `json:"nearby,omitempty"`  // delete 时：true=连同附近人物事件一起删
	OnConflict string `json:"on_conflict,omitempty"` // "ask"=歧义时反问用户（默认），"push"=自动让位
}

type ArrangeSandboxArgs struct {
	Prompt string      `json:"prompt,omitempty"` // 兼容：自由文本指令（无 ops 时按文本解析）
	Ops    []SandboxOp `json:"ops,omitempty"`    // 结构化操作（优先）
}

type ArrangeSandboxTool struct{}

func (t *ArrangeSandboxTool) Name() string           { return "arrange_sandbox" }
func (t *ArrangeSandboxTool) Description() string    { return arrangeSandboxDescription }
func (t *ArrangeSandboxTool) Category() ToolCategory { return CategoryNovelManagement }
func (t *ArrangeSandboxTool) JSONSchema() json.RawMessage {
	return SchemaOf(ArrangeSandboxArgs{})
}
func (t *ArrangeSandboxTool) ExposeToLLM() bool { return true }
func (t *ArrangeSandboxTool) NewArgs() any      { return &ArrangeSandboxArgs{} }

const arrangeSandboxDescription = `在沙盘上布局地点/角色/事件。**触发前提：用户明确提到沙盘/地图/布局/摆位（如"在沙盘上…""摆一下""地图上…"），或上一轮已在处理沙盘布局**。若用户说的是剧情/设定层面的操作（如"删除血沼"指从设定删除该地点、"莫甘我不想要了"指剧情层面），**不要调用本工具**（应使用 delete_record 等设定工具）。触发后把意图解析为 ops 结构化操作：
- 移动："把X放到Y的北边/南边/东边/西边/东北…""X往上挪挪"→ {op:move, target:X, anchor:Y, dir:方位}；"X往Y方向靠近一点/靠近Y/向Y靠"→ {op:move, target:X, anchor:Y, dir:"toward"}；"把X放到Y上/以Y为中心/放到Y里面/放到Y中"→ {op:move, target:X, anchor:Y, dir:"center"}（工具自动把 X **塞进 Y 图形内部**网格散布，多个目标不重叠、不超出边界）；**批量**："把A、B、C都放到Y的北边"→ 生成 3 个 move op（或一个 op 的 target 写"A、B、C"，工具自动拆分），多个目标放到同一方位会沿方向自动排开不重叠
- 删除："删除X""X我不想要了""X就算了吧""X我不喜欢""X不要了""X消失"→ {op:delete, target:X}；"删除X区域和该区域所有人物事件"→ {op:delete, target:X, nearby:true}
- 新增："在Y的Z方新建X"→ {op:add, target:X, anchor:Y, dir:方位}
- 全量：用户要"把设定摆到沙盘上""重新布局"且无具体对象 → ops 留空（全量重建，读取设定+空间关系按方位排布）
语义映射（额外）：
- "平齐/对齐/同一水平线/和Y一样高" → 保持 X 与 Y 的左右相对位置不变，仅把 Y（南北）坐标对齐到与 X 相同；若不清楚 X 目前在 Y 的东侧还是西侧，**先问用户**再调用（不要猜）。
- "X往Y方向靠近一点/靠近Y" → {op:move, target:X, anchor:Y, dir:根据 X 当前相对 Y 的方位定}；若不确定 X 当前方位，先问。
歧义处理（**必须遵守**）：只要 op 的任何一个参数无法唯一确定（方向不明、左右侧不明、目标名称有多个匹配、位置冲突），**不要擅自决定，先用文字问用户**（如"血沼泽平齐后应在银月湖东边还是西边？"），等用户回答后再调用。宁可多问一次，不可猜错布局。
方向 dir 取值：north/south/east/west/ne/nw/se/sw/beside/center。调用后沙盘更新。`

// 地点模板：按类型关键词 → (形状, 颜色)
var arrangeTemplates = []struct {
	kw    string
	shape string
	fill  string
}{
	{"森林", "rect", "#2e7d32"}, {"林", "rect", "#2e7d32"},
	{"河", "wave", "#1565c0"}, {"海", "wave", "#1565c0"}, {"湖", "wave", "#0288d1"}, {"水", "wave", "#1565c0"},
	{"山", "triangle", "#616161"}, {"峰", "triangle", "#616161"},
	{"火山", "triangle", "#d32f2f"},
	{"冰", "rect", "#eceff1"}, {"雪", "rect", "#eceff1"},
	{"深渊", "circle", "#7b1fa2"}, {"地狱", "circle", "#7b1fa2"},
	{"血池", "circle", "#b71c1c"}, {"血", "circle", "#b71c1c"},
	{"洞穴", "arc", "#795548"}, {"洞", "arc", "#795548"},
	{"沙漠", "circle", "#f9a825"}, {"沙", "circle", "#f9a825"},
	{"城", "rect", "#9e9e9e"}, {"堡", "rect", "#9e9e9e"}, {"王都", "rect", "#9e9e9e"}, {"镇", "rect", "#a1887f"},
}

// 方位词 → 单位向量（相对距离 300）
var arrangeDirs = []struct {
	kw string
	dx float64
	dy float64
}{
	{"东北", 212, -212}, {"西北", -212, -212}, {"东南", 212, 212}, {"西南", -212, 212},
	{"北方", 0, -300}, {"南方", 0, 300}, {"东方", 300, 0}, {"西方", -300, 0},
	{"东边", 300, 0}, {"西边", -300, 0}, {"北边", 0, -300}, {"南边", 0, 300},
	{"北", 0, -300}, {"南", 0, 300}, {"东", 300, 0}, {"西", -300, 0},
	{"中央", 0, 0}, {"中心", 0, 0}, {"旁边", 160, 0}, {"附近", 160, 0}, {"地下", 0, 120},
}

type arrangeShape struct {
	ID          string  `json:"id"`
	Type        string  `json:"type"`
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	W           float64 `json:"w"`
	H           float64 `json:"h"`
	Rotation    float64 `json:"rotation"`
	Fill        string  `json:"fill"`
	FillOpacity float64 `json:"fillOpacity"`
	Stroke      string  `json:"stroke"`
	StrokeWidth float64 `json:"strokeWidth"`
	Label       string  `json:"label"`
	TextPos     string  `json:"textPos"`
	EntityType  string  `json:"entityType"`
	EntityID    int64   `json:"entityId"`
	Star        int     `json:"star"`
}

// locRelation 地点空间关系
type locRelation struct {
	LocationA    int64
	LocationB    int64
	RelationType string
	Description  string
}

func (t *ArrangeSandboxTool) Execute(ctx context.Context, args any, tc ToolContext) (*ToolResult, error) {
	a := args.(*ArrangeSandboxArgs)
	if tc.NovelID <= 0 {
		return &ToolResult{Success: false, Error: "arrange_sandbox: 需要先选择小说"}, nil
	}

	// 1. 收集设定
	var locs []location.Location
	if err := tc.DB.Where("novel_id = ?", tc.NovelID).Find(&locs).Error; err != nil {
		return nil, fmt.Errorf("arrange_sandbox: 读地点失败: %w", err)
	}
	var chars []character.Character
	if err := tc.DB.Where("novel_id = ?", tc.NovelID).Find(&chars).Error; err != nil {
		return nil, fmt.Errorf("arrange_sandbox: 读角色失败: %w", err)
	}
	var tls []timeline.TimelineEntry
	if err := tc.DB.Where("novel_id = ?", tc.NovelID).Find(&tls).Error; err != nil {
		return nil, fmt.Errorf("arrange_sandbox: 读事件失败: %w", err)
	}
	// 地点关系
	var rels []locRelation
	rows, err := tc.DB.Table("location_relations").
		Select("location_a, location_b, relation_type, description").
		Where("novel_id = ?", tc.NovelID).Rows()
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var r locRelation
			_ = rows.Scan(&r.LocationA, &r.LocationB, &r.RelationType, &r.Description)
			rels = append(rels, r)
		}
	}

	// 2. 读当前沙盘
	sandboxID := sandboxIDForNovel(tc.DB, tc.NovelID)
	existing := loadSandboxShapes(tc.NovelID, sandboxID)
	prompt := strings.TrimSpace(a.Prompt)

	var shapes []arrangeShape
	if len(a.Ops) > 0 {
		// 结构化操作优先：从现有形状开始，逐个执行
		shapes = existing
		for _, op := range a.Ops {
			// target 含分隔符（、/，/和/与/及）→ 拆成多个目标逐个执行（批量操作保险）
			targets := splitTargets(op.Target)
			for _, tg := range targets {
				sub := op
				sub.Target = tg
				switch sub.Op {
				case "move":
					shapes = opMove(sub, shapes, locs, chars)
				case "delete":
					shapes = opDelete(sub, shapes)
				case "add":
					shapes = opAdd(sub, shapes, locs, chars)
				}
			}
		}
	} else if prompt != "" {
		// 增量：文本解析
		shapes = existing
		shapes = applyIncremental(prompt, shapes, locs, chars, tls)
	} else {
		// 全量布局：中心起点 → 按关系/方位摆
		shapes = buildFullLayout(locs, chars, tls, rels)
	}

	// 4. 保存
	if err := saveSandboxShapes(tc.NovelID, sandboxID, shapes); err != nil {
		return nil, fmt.Errorf("arrange_sandbox: 保存失败: %w", err)
	}

	mode := "全量"
	if len(a.Ops) > 0 {
		mode = "结构化操作"
	} else if prompt != "" {
		mode = "增量"
	}
	return &ToolResult{
		Success: true,
		Data: map[string]any{
			"note":      "沙盘已更新，前端刷新可见",
			"mode":      mode,
			"shapes":    len(shapes),
			"locations": len(locs),
			"relations": len(rels),
		},
	}, nil
}

// opMove 移动：target 放到 anchor 的 dir 方位（冲突 push 让位）
func opMove(op SandboxOp, shapes []arrangeShape, locs []location.Location, chars []character.Character) []arrangeShape {
	if op.Target == "" || op.Anchor == "" {
		return shapes
	}
	ti := findShapeIdx(shapes, op.Target)
	anchorIdx := findShapeIdx(shapes, op.Anchor)
	if ti < 0 {
		// 目标不在沙盘：若在设定里则创建
		shapes = appendShapeFor(shapes, op.Target, locs, chars)
		ti = findShapeIdx(shapes, op.Target)
	}
	if ti < 0 || anchorIdx < 0 {
		return shapes
	}
	dx, dy := dirVec(op.Dir)
	anchor := shapes[anchorIdx]
	acx := anchor.X + anchor.W/2
	acy := anchor.Y + anchor.H/2
	t := shapes[ti]
	tcx := t.X + t.W/2
	tcy := t.Y + t.H/2
	// dir=toward：朝 anchor 当前位置移动（不猜方位，永远靠近）
	if op.Dir == "toward" {
		vx, vy := acx - tcx, acy - tcy
		if vx == 0 && vy == 0 {
			return shapes
		}
		// 向 anchor 方向移动 35%（靠近但仍保留间隙）
		t.X = tcx + vx*0.35 - t.W/2
		t.Y = tcy + vy*0.35 - t.H/2
		shapes[ti] = t
		return shapes
	}
	// dir=center（放到X上/以X为中心/放到X里面）：塞进 anchor 图形内部散布（网格，不超出边界，不堆叠）
	if op.Dir == "center" || op.Dir == "onto" || op.Dir == "上" || op.Dir == "里面" || op.Dir == "中" || op.Dir == "中央" {
		// 内部可用区域（四周留 25% 边距）
		innerX0 := anchor.X + anchor.W*0.15
		innerY0 := anchor.Y + anchor.H*0.15
		innerW := anchor.W * 0.7
		innerH := anchor.H * 0.7
		if innerW < 40 {
			innerW = 40
		}
		if innerH < 40 {
			innerH = 40
		}
		// 数 anchor 内部已有的形状数量 → 决定网格位置
		near := 0
		for i, s := range shapes {
			if i == ti {
				continue
			}
			sx := s.X + s.W/2
			sy := s.Y + s.H/2
			if sx >= innerX0 && sx <= innerX0+innerW && sy >= innerY0 && sy <= innerY0+innerH {
				near++
			}
		}
		// 网格：每行 3 个，从左上到右下
		col := near % 3
		row := near / 3
		cellW := innerW / 3
		cellH := innerH / 3
		t.X = innerX0 + (float64(col)+0.5)*cellW - t.W/2
		t.Y = innerY0 + (float64(row)+0.5)*cellH - t.H/2
		shapes[ti] = t
		return shapes
	}
	// 冲突检测：目标方位附近已有其他形状 → push 让位
	occupied := 0
	for i, s := range shapes {
		if i == ti {
			continue
		}
		sx := s.X + s.W/2
		sy := s.Y + s.H/2
		if abs(sx-acx-dx) < 140 && abs(sy-acy-dy) < 120 {
			occupied++
		}
	}
	push := float64(1 + occupied)
	t.X = acx + dx*push - t.W/2
	t.Y = acy + dy*push - t.H/2
	shapes[ti] = t
	return shapes
}

// opDelete 删除：target 形状；nearby=true 时连带附近人物/事件
func opDelete(op SandboxOp, shapes []arrangeShape) []arrangeShape {
	if op.Target == "" {
		return shapes
	}
	var kept []arrangeShape
	var cx, cy float64
	removed := false
	for _, s := range shapes {
		if s.Label == op.Target {
			cx = s.X + s.W/2
			cy = s.Y + s.H/2
			removed = true
			continue
		}
		kept = append(kept, s)
	}
	if removed && op.Nearby {
		var kept2 []arrangeShape
		for _, s := range kept {
			if s.Type == "person" || s.Type == "event" {
				sx := s.X + s.W/2
				sy := s.Y + s.H/2
				if abs(sx-cx) < 260 && abs(sy-cy) < 240 {
					continue
				}
			}
			kept2 = append(kept2, s)
		}
		kept = kept2
	}
	return kept
}

// opAdd 新增：在 anchor 的 dir 方位创建 target 形状
func opAdd(op SandboxOp, shapes []arrangeShape, locs []location.Location, chars []character.Character) []arrangeShape {
	if op.Target == "" {
		return shapes
	}
	if findShapeIdx(shapes, op.Target) >= 0 {
		return shapes // 已存在
	}
	anchorIdx := findShapeIdx(shapes, op.Anchor)
	if anchorIdx < 0 {
		return shapes
	}
	dx, dy := dirVec(op.Dir)
	anchor := shapes[anchorIdx]
	acx := anchor.X + anchor.W/2
	acy := anchor.Y + anchor.H/2
	w, h := 120.0, 90.0
	var shape, fill string
	shape, fill = templateFor(op.Target)
	// 若设定里有同名实体则关联
	entityType, entityID := "", int64(0)
	for _, l := range locs {
		if l.Name == op.Target {
			entityType, entityID = "location", l.ID
			shape, fill = templateFor(l.LocationType + l.Name + l.Description)
			break
		}
	}
	if entityID == 0 {
		for _, c := range chars {
			if c.Name == op.Target {
				entityType, entityID = "character", c.ID
				shape, fill = "person", "#ff6b6b"
				w, h = 90.0, 110.0
				break
			}
		}
	}
	return append(shapes, arrangeShape{
		ID: fmt.Sprintf("new_%d", len(shapes)), Type: shape,
		X: acx + dx - w/2, Y: acy + dy - h/2, W: w, H: h,
		Fill: fill, FillOpacity: 0.35, Stroke: fill, StrokeWidth: 2,
		Label: op.Target, TextPos: "top",
		EntityType: entityType, EntityID: entityID,
	})
}

// splitTargets 拆分批量目标："A、B、C""A和B""A,B" → [A B C]
func splitTargets(s string) []string {
	if s == "" {
		return nil
	}
	parts := regexp.MustCompile(`[、，,和与及]`).Split(s, -1)
	var out []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		out = []string{s}
	}
	return out
}

// findShapeIdx 按名称找形状下标；找不到返回 -1
func findShapeIdx(shapes []arrangeShape, name string) int {
	for i, s := range shapes {
		if s.Label == name {
			return i
		}
	}
	return -1
}

// appendShapeFor 把设定里存在的实体加入沙盘（未在沙盘时）
func appendShapeFor(shapes []arrangeShape, name string, locs []location.Location, chars []character.Character) []arrangeShape {
	for _, l := range locs {
		if l.Name == name {
			shape, fill := templateFor(l.LocationType + l.Name + l.Description)
			w, h := 130.0, 100.0
			return append(shapes, arrangeShape{
				ID: fmt.Sprintf("loc_%d", l.ID), Type: shape,
				X: 600 - w/2, Y: 400 - h/2, W: w, H: h,
				Fill: fill, FillOpacity: 0.35, Stroke: fill, StrokeWidth: 2,
				Label: l.Name, TextPos: "top",
				EntityType: "location", EntityID: l.ID,
			})
		}
	}
	for _, c := range chars {
		if c.Name == name {
			w, h := 90.0, 110.0
			return append(shapes, arrangeShape{
				ID: fmt.Sprintf("char_%d", c.ID), Type: "person",
				X: 600 - w/2, Y: 400 - h/2, W: w, H: h,
				Fill: "#ff6b6b", FillOpacity: 0.35, Stroke: "#ff6b6b", StrokeWidth: 2,
				Label: c.Name, TextPos: "top",
				EntityType: "character", EntityID: c.ID,
			})
		}
	}
	return shapes
}

// dirVec 方位 → 单位向量
func dirVec(dir string) (dx, dy float64) {
	switch dir {
	case "north", "北":
		return 0, -300
	case "south", "南":
		return 0, 300
	case "east", "东":
		return 300, 0
	case "west", "西":
		return -300, 0
	case "ne", "东北":
		return 212, -212
	case "nw", "西北":
		return -212, -212
	case "se", "东南":
		return 212, 212
	case "sw", "西南":
		return -212, 212
	case "beside", "旁边", "附近":
		return 160, 0
	case "toward", "靠近", "方向":
		return 0, 0 // 特殊：由 opMove 按实际坐标处理
	case "center", "onto", "上", "里面", "中", "中央":
		return 0, 0 // 特殊：由 opMove 环绕散布处理
	default:
		return 0, 0 // center
	}
}

// buildFullLayout 全量布局：先定中心地点，再按方位词/关系排布
// novelIDFor 从地点列表取 novel id（world 形状 id 用）
func novelIDFor(locs []location.Location) int64 {
	if len(locs) > 0 {
		return locs[0].NovelID
	}
	return 0
}

func buildFullLayout(locs []location.Location, chars []character.Character, tls []timeline.TimelineEntry, rels []locRelation) []arrangeShape {
	var shapes []arrangeShape
	if len(locs) == 0 {
		return shapes
	}

	// 定位 ID→坐标（中心 600,400）
	type placed struct{ x, y float64 }
	coord := map[int64]placed{}
	const cx, cy = 600.0, 400.0

	// 世界观容器（井字地图）：先把世界形状放进去（全量布局的容器，所有内容在其中）
	shapes = append(shapes, arrangeShape{
		ID: fmt.Sprintf("world_%d", novelIDFor(locs)), Type: "world",
		X: -80, Y: -120, W: 1360, H: 1040, // 大容器（-80..1280, -120..920）
		Fill: "#4d96ff", FillOpacity: 0.05, Stroke: "#4d96ff", StrokeWidth: 2,
		Label: "世界地图", TextPos: "top",
	})

	// 找中心地点：名字含"王都/城/堡"且描述含"中心/都城/坐镇"，否则第一个
	centerID := locs[0].ID
	for _, l := range locs {
		if strings.Contains(l.Name, "王都") || strings.Contains(l.Name, "堡") || strings.Contains(l.Name, "都") {
			centerID = l.ID
			break
		}
	}
	coord[centerID] = placed{cx, cy}

	// BFS：从中心出发，按关系 description 的方位词摆放相邻地点
	queue := []int64{centerID}
	visited := map[int64]bool{centerID: true}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, r := range rels {
			var other int64
			if r.LocationA == cur {
				other = r.LocationB
			} else if r.LocationB == cur {
				other = r.LocationA
			} else {
				continue
			}
			if visited[other] {
				continue
			}
			p, ok := coord[cur]
			if !ok {
				continue
			}
			dx, dy, found := dirFor(r.Description)
			if !found {
				// 关系无方位 → 往右排
				dx, dy = 300, 0
			}
			coord[other] = placed{p.x + dx, p.y + dy}
			visited[other] = true
			queue = append(queue, other)
		}
	}

	// 未通过关系定位的地点：按自身 tags/描述方位词（相对中心）
	for _, l := range locs {
		if _, ok := coord[l.ID]; ok {
			continue
		}
		dx, dy, found := dirFor(l.Tags + l.Description + l.Name)
		if found {
			coord[l.ID] = placed{cx + dx, cy + dy}
		} else {
			// 找不到方位 → 绕中心环形排
			coord[l.ID] = placed{cx + 250, cy + 220}
		}
	}

	// 生成地点形状（尺寸比例：解析描述里的"横X纵Y/X×X/宽X高Y"，最小者=120px 基准，其余等比）
	const baseW, baseH = 120.0, 100.0
	// 先解析每个地点的相对尺寸（单位）
	type dim struct{ wu, hu float64 }
	dims := map[int64]dim{}
	minUnit := 0.0
	for _, l := range locs {
		wu, hu := parseDim(l.Description + l.Name)
		if wu <= 0 || hu <= 0 {
			wu, hu = 1, 1 // 未说明尺寸 = 1 单位（基准）
		}
		dims[l.ID] = dim{wu, hu}
		if minUnit == 0 || wu < minUnit || hu < minUnit {
			m := wu
			if hu < m {
				m = hu
			}
			if m < minUnit || minUnit == 0 {
				minUnit = m
			}
		}
	}
	// 比例尺：最小单位 = 120px
	scale := baseW / minUnit
	for _, l := range locs {
		shape, fill := templateFor(l.LocationType + l.Name + l.Description)
		d := dims[l.ID]
		w := d.wu * scale
		h := d.hu * scale
		if w < 60 {
			w = 60
		}
		if h < 50 {
			h = 50
		}
		p := coord[l.ID]
		shapes = append(shapes, arrangeShape{
			ID: fmt.Sprintf("loc_%d", l.ID), Type: shape,
			X: p.x - w/2, Y: p.y - h/2, W: w, H: h,
			Fill: fill, FillOpacity: 0.35, Stroke: fill, StrokeWidth: 2,
			Label: l.Name, TextPos: "top",
			EntityType: "location", EntityID: l.ID,
		})
	}

	// 角色/事件：方形金字塔排列（人物一组、事件一组，分开不重叠）
	shapes = append(shapes, pyramidArrange(chars, tls, 0)...)
	return shapes
}

// parseDim 从描述解析相对尺寸（单位）："横10纵1""10×10""宽10高1""10*10"
// 返回 (宽单位, 高单位)；无法解析返回 (0,0)
func parseDim(s string) (float64, float64) {
	re1 := regexp.MustCompile(`(?:横|宽)\s*(\d+(?:\.\d+)?)\s*(?:纵|高)\s*(\d+(?:\.\d+)?)`)
	if m := re1.FindStringSubmatch(s); len(m) == 3 {
		return atof(m[1]), atof(m[2])
	}
	re2 := regexp.MustCompile(`(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)`)
	if m := re2.FindStringSubmatch(s); len(m) == 3 {
		return atof(m[1]), atof(m[2])
	}
	re3 := regexp.MustCompile(`(?:约|大概)?(\d+(?:\.\d+)?)\s*(?:米|单位)`)
	if m := re3.FindStringSubmatch(s); len(m) == 2 {
		v := atof(m[1])
		return v, v
	}
	return 0, 0
}

func atof(s string) float64 {
	var v float64
	fmt.Sscanf(s, "%f", &v)
	return v
}

// pyramidArrange 方形金字塔排列：第1行1个、第2行2个、第3行3个…从上往下逐行递增，行内均分、行间最小间距。
// 人物组与事件组分开放置（人物在上，事件在人物下方，避免重叠）。
func pyramidArrange(chars []character.Character, tls []timeline.TimelineEntry, offsetX float64) []arrangeShape {
	var out []arrangeShape
	const gap = 130.0 // 最小间距
	const left = 60.0
	const topY = 700.0

	// 人物金字塔
	y := topY
	remaining := len(chars)
	row := 1
	idx := 0
	for remaining > 0 {
		n := row
		if n > remaining {
			n = remaining
		}
		rowW := float64(n)*gap - 20
		startX := left + offsetX + (1000-60-rowW)/2
		for i := 0; i < n; i++ {
			if idx >= len(chars) {
				break
			}
			c := chars[idx]
			w, h := 44.0, 56.0 // 形状缩小（字不变，前端 label 固定 13px）
			out = append(out, arrangeShape{
				ID: fmt.Sprintf("char_%d", c.ID), Type: "person",
				X: startX + float64(i)*gap - w/2, Y: y - h/2, W: w, H: h,
				Fill: "#ff6b6b", FillOpacity: 0.35, Stroke: "#ff6b6b", StrokeWidth: 2,
				Label: c.Name, TextPos: "top",
				EntityType: "character", EntityID: c.ID,
			})
			idx++
		}
		remaining -= n
		row++
		y += gap + 20
	}

	// 事件金字塔（人物下方）
	y = topY + float64(pyramidRows(len(chars)))*(gap+20) + 60
	remaining = len(tls)
	row = 1
	idx = 0
	for remaining > 0 {
		n := row
		if n > remaining {
			n = remaining
		}
		rowW := float64(n)*gap - 20
		startX := left + offsetX + (1000-60-rowW)/2
		for i := 0; i < n; i++ {
			if idx >= len(tls) {
				break
			}
			tl := tls[idx]
			w, h := 40.0, 40.0 // 形状缩小（字不变）
			out = append(out, arrangeShape{
				ID: fmt.Sprintf("evt_%d", tl.ID), Type: "event",
				X: startX + float64(i)*gap - w/2, Y: y - h/2, W: w, H: h,
				Fill: "#ffd93d", FillOpacity: 0, Stroke: "#ffb300", StrokeWidth: 3,
				Label: tl.Title, TextPos: "top",
				EntityType: "timeline", EntityID: tl.ID, Star: tl.Importance,
			})
			idx++
		}
		remaining -= n
		row++
		y += gap + 20
	}
	return out
}

// pyramidRows 计算 n 个元素需要的行数（1+2+3+…>=n）
func pyramidRows(n int) int {
	rows := 0
	sum := 0
	for sum < n {
		rows++
		sum += rows
	}
	return rows
}

// applyIncremental 增量：解析"把X放到Y的Z方/在Y的Z方新建X/把X放到Y旁边/删除X（区域及附近人物事件）"等指令
func applyIncremental(prompt string, shapes []arrangeShape, locs []location.Location, chars []character.Character, tls []timeline.TimelineEntry) []arrangeShape {
	// ── 删除指令（优先级最高）：删除X / 删除X区域和该区域所有人物事件 ──
	if strings.Contains(prompt, "删除") || strings.Contains(prompt, "删掉") || strings.Contains(prompt, "移除") || strings.Contains(prompt, "去掉") || strings.Contains(prompt, "清除") {
		// 提取删除目标名（删除后的第一个名字片段）
		reDel := regexp.MustCompile(`(?:删除|删掉|移除|去掉|清除)(?:掉|去)?(.{1,14}?)`)
		if m := reDel.FindStringSubmatch(prompt); len(m) == 2 {
			target := strings.TrimSpace(m[1])
			// 去掉尾部语气词
			target = strings.TrimRight(target, "吧。！？!?，,")
			if target == "" {
				return shapes
			}
			var kept []arrangeShape
			var removedCenter struct{ x, y float64 }
			removedAny := false
			for _, s := range shapes {
				if s.Label == target {
					removedCenter.x = s.X + s.W/2
					removedCenter.y = s.Y + s.H/2
					removedAny = true
					continue // 删除该形状
				}
				kept = append(kept, s)
			}
			// "区域/这一带/所有人物事件" → 一并删除该地点附近的角色(person)/事件(event)
			if removedAny && (strings.Contains(prompt, "区域") || strings.Contains(prompt, "这一带") || strings.Contains(prompt, "附近") || strings.Contains(prompt, "人物事件") || strings.Contains(prompt, "全部")) {
				var kept2 []arrangeShape
				for _, s := range kept {
					if (s.Type == "person" || s.Type == "event") {
						sx := s.X + s.W/2
						sy := s.Y + s.H/2
						if abs(sx-removedCenter.x) < 260 && abs(sy-removedCenter.y) < 240 {
							continue // 删除附近的人物/事件
						}
					}
					kept2 = append(kept2, s)
				}
				kept = kept2
			}
			return kept
		}
	}

	// 匹配：把<X>放到<Y>的<方位>（也兼容无"把"：X移动到Y的Z方）
	reMove := regexp.MustCompile(`(?:把)?(.{1,12}?)(?:放到|移到|移动到|置于|移至)(.{1,12}?)的(.{1,4}?)[方边]`)
	// 匹配：X移动到Y（无方位词 → 放到 Y 旁边）
	reMoveNear := regexp.MustCompile(`(?:把)?(.{1,12}?)(?:放到|移到|移动到|移至)(.{1,12}?)$`)
	// 匹配：在<Y>的<方位>新建/加一个<X>
	reAdd := regexp.MustCompile(`在(.{1,12}?)(?:的)?(.{1,4}?)[方边](?:新建|建|加|放置|放)(?:一个|座|条|片)?(.{1,12}?)`)
	// 匹配：把<X>放到<Y>旁边/附近
	reNear := regexp.MustCompile(`把(.{1,12}?)(?:放到|移到|移动到)(.{1,12}?)(?:旁边|附近)`)

	// 建立 名称→形状 索引
	idx := map[string]int{}
	for i, s := range shapes {
		if s.Label != "" {
			idx[s.Label] = i
		}
	}

	// 找到某名称的形状（现有或新实体）
	findOrCreate := func(name string) (int, bool) {
		if i, ok := idx[name]; ok {
			return i, true
		}
		// 新实体：查地点/角色/事件表
		for _, l := range locs {
			if l.Name == name {
				shape, fill := templateFor(l.LocationType + l.Name + l.Description)
				w, h := 130.0, 100.0
				shapes = append(shapes, arrangeShape{
					ID: fmt.Sprintf("loc_%d", l.ID), Type: shape,
					X: 600 - w/2, Y: 400 - h/2, W: w, H: h,
					Fill: fill, FillOpacity: 0.35, Stroke: fill, StrokeWidth: 2,
					Label: l.Name, TextPos: "top",
					EntityType: "location", EntityID: l.ID,
				})
				idx[name] = len(shapes) - 1
				return len(shapes) - 1, true
			}
		}
		for _, c := range chars {
			if c.Name == name {
				w, h := 90.0, 110.0
				shapes = append(shapes, arrangeShape{
					ID: fmt.Sprintf("char_%d", c.ID), Type: "person",
					X: 600 - w/2, Y: 400 - h/2, W: w, H: h,
					Fill: "#ff6b6b", FillOpacity: 0.35, Stroke: "#ff6b6b", StrokeWidth: 2,
					Label: c.Name, TextPos: "top",
					EntityType: "character", EntityID: c.ID,
				})
				idx[name] = len(shapes) - 1
				return len(shapes) - 1, true
			}
		}
		return -1, false
	}

	// 处理"放到Y的方位"
	if m := reMove.FindStringSubmatch(prompt); len(m) == 4 {
		ti, ok := findOrCreate(m[1])
		anchorIdx, ok2 := findOrCreate(m[2])
		if ok && ok2 {
			dx, dy, found := dirFor(m[3])
			if !found {
				dx, dy = 300, 0
			}
			anchor := shapes[anchorIdx]
			acx := anchor.X + anchor.W/2
			acy := anchor.Y + anchor.H/2
			// 冲突检测：同一目标附近已有其他形状 → 整体让位（把占用者沿同方向再推远）
			occupied := 0
			for i, s := range shapes {
				if i == ti {
					continue
				}
				sx := s.X + s.W/2
				sy := s.Y + s.H/2
				if abs(sx-acx-dx) < 140 && abs(sy-acy-dy) < 120 {
					occupied++
				}
			}
			push := float64(1 + occupied)
			t := shapes[ti]
			t.X = acx + dx*push - t.W/2
			t.Y = acy + dy*push - t.H/2
			shapes[ti] = t
		}
	} else if m := reNear.FindStringSubmatch(prompt); len(m) == 3 {
		ti, ok := findOrCreate(m[1])
		anchorIdx, ok2 := findOrCreate(m[2])
		if ok && ok2 {
			anchor := shapes[anchorIdx]
			t := shapes[ti]
			t.X = anchor.X + anchor.W + 20
			t.Y = anchor.Y + anchor.H/2 - t.H/2
			shapes[ti] = t
		}
	} else if m := reMoveNear.FindStringSubmatch(prompt); len(m) == 3 {
		// 宽松匹配：X移动到Y（无方位词）→ 放到 Y 旁边
		ti, ok := findOrCreate(m[1])
		anchorIdx, ok2 := findOrCreate(m[2])
		if ok && ok2 && ti != anchorIdx {
			anchor := shapes[anchorIdx]
			t := shapes[ti]
			t.X = anchor.X + anchor.W + 20
			t.Y = anchor.Y + anchor.H/2 - t.H/2
			shapes[ti] = t
		}
	} else if m := reAdd.FindStringSubmatch(prompt); len(m) == 4 {
		// 在<Y>的<方位>新建<X>
		anchorIdx, ok := findOrCreate(m[1])
		name := m[3]
		if ok && !strings.Contains(prompt, "把") {
			dx, dy, found := dirFor(m[2])
			if !found {
				dx, dy = 300, 0
			}
			anchor := shapes[anchorIdx]
			acx := anchor.X + anchor.W/2
			acy := anchor.Y + anchor.H/2
			// 新建：查设定里有没有同名
			var shape, fill string
			w, h := 120.0, 90.0
			shape, fill = templateFor(name)
			shapes = append(shapes, arrangeShape{
				ID: fmt.Sprintf("new_%d", len(shapes)), Type: shape,
				X: acx + dx - w/2, Y: acy + dy - h/2, W: w, H: h,
				Fill: fill, FillOpacity: 0.35, Stroke: fill, StrokeWidth: 2,
				Label: name, TextPos: "top",
			})
		}
	}

	return shapes
}

func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func templateFor(s string) (shape, fill string) {
	shape, fill = "rect", "#6bcb77"
	for _, tpl := range arrangeTemplates {
		if strings.Contains(s, tpl.kw) {
			return tpl.shape, tpl.fill
		}
	}
	return shape, fill
}

func dirFor(s string) (dx, dy float64, found bool) {
	for _, d := range arrangeDirs {
		if strings.Contains(s, d.kw) {
			return d.dx, d.dy, true
		}
	}
	return 0, 0, false
}

// sandboxIDForNovel 取该小说第一个沙盘（无则返回 ""）
func sandboxIDForNovel(db *gorm.DB, novelID int64) string {
	dir := filepath.Join(git.NovelDir(novelID), "sandboxs")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			return strings.TrimSuffix(e.Name(), ".json")
		}
	}
	return ""
}

// loadSandboxShapes 读沙盘 shapes（简化结构）
func loadSandboxShapes(novelID int64, sandboxID string) []arrangeShape {
	if sandboxID == "" {
		return nil
	}
	var sd struct {
		Shapes []arrangeShape `json:"shapes"`
	}
	data, err := os.ReadFile(filepath.Join(git.NovelDir(novelID), "sandboxs", sandboxID+".json"))
	if err != nil {
		return nil
	}
	_ = json.Unmarshal(data, &sd)
	return sd.Shapes
}

// saveSandboxShapes 写回沙盘（保留 name/description/view）
func saveSandboxShapes(novelID int64, sandboxID string, shapes []arrangeShape) error {
	if sandboxID == "" {
		sandboxID = "default"
	}
	path := filepath.Join(git.NovelDir(novelID), "sandboxs", sandboxID+".json")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	var sd map[string]any
	if data, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(data, &sd)
	}
	if sd == nil {
		sd = map[string]any{"name": "默认沙盘", "description": "", "viewX": 0, "viewY": 0, "scale": 1}
	}
	sd["shapes"] = shapes
	out, err := json.MarshalIndent(sd, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, out, 0644)
}

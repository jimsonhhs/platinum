package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"novel/internal/draft"
	"novel/internal/git"
)

// ── 沙盘（视觉化世界地图：多份保存，可命名/简介）────────────

// SandboxShape 是沙盘上的一个形状。
type SandboxShape struct {
	ID          string  `json:"id"`
	Type        string  `json:"type"`        // circle | rect | wave | arc | diamond | triangle | text
	X           float64 `json:"x"`           // 左上角 x（circle 用中心）
	Y           float64 `json:"y"`           // 左上角 y（circle 用中心）
	W           float64 `json:"w"`           // 宽度
	H           float64 `json:"h"`           // 高度
	Rotation    float64 `json:"rotation"`    // 旋转角度（度，绕形状中心）
	Fill        string  `json:"fill"`        // 填充色（#rrggbb）
	FillOpacity float64 `json:"fillOpacity"` // 0=透明
	Stroke      string  `json:"stroke"`      // 边框色
	StrokeWidth float64 `json:"strokeWidth"`
	Label       string  `json:"label"`       // 形状上的文字
	TextPos     string  `json:"textPos"`     // 文字位置：top | middle | bottom
	EntityType  string  `json:"entityType"`  // "" | "location" | "character" | "timeline"
	EntityID    int64   `json:"entityId"`    // 关联实体 ID（0=无）
	Star        int     `json:"star"`        // 事件星级（1-5，实体为 timeline 时）
}

// SandboxData 是单份沙盘的完整内容。
type SandboxData struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Shapes      []SandboxShape `json:"shapes"`
	ViewX       float64        `json:"viewX"`
	ViewY       float64        `json:"viewY"`
	Scale       float64        `json:"scale"`
}

// SandboxMeta 是沙盘列表项（不含 shapes）。
type SandboxMeta struct {
	ID          string `json:"id"` // 文件名基准（不含 .json）
	Name        string `json:"name"`
	Description string `json:"description"`
	UpdatedAt   string `json:"updatedAt"`
}

// sandboxDir 返回沙盘目录（novels/{id}/sandboxs/）。
func sandboxDir(novelID int64) string {
	return filepath.Join(git.NovelDir(novelID), "sandboxs")
}

func sandboxPath(novelID int64, id string) string {
	return filepath.Join(sandboxDir(novelID), id+".json")
}

// safeSandboxID 把名称转为安全的文件名 ID；冲突时加时间戳后缀。
func safeSandboxID(name string) string {
	safe := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r > 127 {
			return r
		}
		return '_'
	}, strings.TrimSpace(name))
	if safe == "" {
		safe = "sandbox"
	}
	return safe
}

// ListSandboxes 返回某小说全部沙盘（按更新时间倒序）。
func (a *App) ListSandboxes(novelID int64) ([]SandboxMeta, error) {
	dir := sandboxDir(novelID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("创建沙盘目录失败: %w", err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("读取沙盘目录失败: %w", err)
	}
	var out []SandboxMeta
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		id := strings.TrimSuffix(e.Name(), ".json")
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var sd SandboxData
		if json.Unmarshal(data, &sd) != nil {
			continue
		}
		name := sd.Name
		if name == "" {
			name = id
		}
		info, _ := e.Info()
		ts := ""
		if info != nil {
			ts = info.ModTime().Format(time.RFC3339)
		}
		out = append(out, SandboxMeta{ID: id, Name: name, Description: sd.Description, UpdatedAt: ts})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt > out[j].UpdatedAt })
	return out, nil
}

// GetSandbox 读取指定沙盘；不存在返回空数据（含默认名）。
func (a *App) GetSandbox(novelID int64, id string) (*SandboxData, error) {
	if id == "" || strings.ContainsAny(id, `/\`) {
		return nil, fmt.Errorf("无效的沙盘 ID")
	}
	data, err := os.ReadFile(sandboxPath(novelID, id))
	if err != nil {
		if os.IsNotExist(err) {
			return &SandboxData{Name: id, Shapes: []SandboxShape{}, Scale: 1}, nil
		}
		return nil, fmt.Errorf("读取沙盘失败: %w", err)
	}
	var sd SandboxData
	if err := json.Unmarshal(data, &sd); err != nil {
		return nil, fmt.Errorf("解析沙盘失败: %w", err)
	}
	if sd.Shapes == nil {
		sd.Shapes = []SandboxShape{}
	}
	if sd.Scale <= 0 {
		sd.Scale = 1
	}
	return &sd, nil
}

// SaveSandbox 保存指定沙盘（写文件 + git 提交）。
// 保存前自动归档旧版本到 sandboxs/_history/（去重 + 保留 5 份）。
func (a *App) SaveSandbox(novelID int64, id string, sd *SandboxData) error {
	if id == "" || strings.ContainsAny(id, `/\`) {
		return fmt.Errorf("无效的沙盘 ID")
	}
	if sd == nil {
		return fmt.Errorf("沙盘数据为空")
	}
	if sd.Shapes == nil {
		sd.Shapes = []SandboxShape{}
	}
	if sd.Scale <= 0 {
		sd.Scale = 1
	}

	// 保存前归档当前版本（仅当文件已存在且有内容；去重 + 保留 5 份）
	if _, err := draft.ArchiveCurrent(novelID, filepath.Join("sandboxs", id+".json"), 5); err != nil {
		a.logger.Warn("沙盘归档失败", "novel_id", novelID, "sandbox", id, "err", err)
	}

	if err := os.MkdirAll(sandboxDir(novelID), 0755); err != nil {
		return fmt.Errorf("创建沙盘目录失败: %w", err)
	}
	data, err := json.MarshalIndent(sd, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化沙盘失败: %w", err)
	}
	if err := os.WriteFile(sandboxPath(novelID, id), data, 0644); err != nil {
		return fmt.Errorf("写入沙盘失败: %w", err)
	}
	a.commitSandbox(novelID, "update sandbox: "+id)
	return nil
}

// ListSandboxHistory 返回某沙盘的历史版本（时间倒序）。
func (a *App) ListSandboxHistory(novelID int64, id string) ([]draft.HistoryEntry, error) {
	if id == "" || strings.ContainsAny(id, `/\`) {
		return nil, fmt.Errorf("无效的沙盘 ID")
	}
	return draft.ListHistory(novelID, filepath.Join("sandboxs", id+".json"))
}

// RestoreSandboxHistory 把某历史版本恢复到沙盘文件（当前版本自动归档）。
func (a *App) RestoreSandboxHistory(novelID int64, id string, fileName string) error {
	if id == "" || strings.ContainsAny(id, `/\`) {
		return fmt.Errorf("无效的沙盘 ID")
	}
	return draft.RestoreHistory(novelID, filepath.Join("sandboxs", id+".json"), fileName, 5)
}

// CreateSandbox 新建沙盘（默认名"沙盘 N"），返回新 ID。
func (a *App) CreateSandbox(novelID int64, name string, description string) (string, error) {
	base := safeSandboxID(name)
	if base == "" {
		base = "sandbox"
	}
	id := base
	n := 1
	for {
		if _, err := os.Stat(sandboxPath(novelID, id)); os.IsNotExist(err) {
			break
		}
		n++
		id = fmt.Sprintf("%s_%d", base, n)
	}
	sd := &SandboxData{
		Name:        name,
		Description: description,
		Shapes:      []SandboxShape{},
		Scale:       1,
	}
	if err := a.SaveSandbox(novelID, id, sd); err != nil {
		return "", err
	}
	return id, nil
}

// UpdateSandboxMeta 更新沙盘名称与简介（保留内容）。
func (a *App) UpdateSandboxMeta(novelID int64, id string, name string, description string) error {
	sd, err := a.GetSandbox(novelID, id)
	if err != nil {
		return err
	}
	sd.Name = name
	sd.Description = description
	return a.SaveSandbox(novelID, id, sd)
}

// DeleteSandbox 删除沙盘文件（git 提交）。
func (a *App) DeleteSandbox(novelID int64, id string) error {
	if id == "" || strings.ContainsAny(id, `/\`) {
		return fmt.Errorf("无效的沙盘 ID")
	}
	if err := os.Remove(sandboxPath(novelID, id)); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("删除沙盘失败: %w", err)
	}
	a.commitSandbox(novelID, "delete sandbox: "+id)
	return nil
}

func (a *App) commitSandbox(novelID int64, msg string) {
	if repo, err := git.New(novelID, a.settings.GitName, a.settings.GitEmail, a.logger); err == nil {
		if err := repo.StageAll(); err == nil {
			if _, err := repo.Commit(msg); err != nil {
				a.logger.Warn("沙盘保存后 git 提交失败", "novel_id", novelID, "err", err)
			}
		}
	}
}

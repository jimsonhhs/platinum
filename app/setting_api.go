package app

import (
	"fmt"

	"novel/internal/setting"
)

// SaveSettingInput 是前端保存设定的入参。
type SaveSettingInput struct {
	NovelID  int64  `json:"novel_id"`
	ID       int64  `json:"id"` // 0 = 新建
	Category string `json:"category"`
	Content  string `json:"content"`
}

// ListSettings 返回某小说的全部世界设定。
func (a *App) ListSettings(novelID int64) ([]setting.SettingItem, error) {
	if a.settingStore == nil {
		return nil, fmt.Errorf("setting store 未初始化")
	}
	return a.settingStore.List(a.ctx, novelID)
}

// SaveSetting 新建或更新一条世界设定（与 AI 的 upsert_setting 同一套合并逻辑）。
func (a *App) SaveSetting(input SaveSettingInput) (*setting.SettingItem, error) {
	if a.settingStore == nil {
		return nil, fmt.Errorf("setting store 未初始化")
	}
	if input.NovelID <= 0 {
		return nil, fmt.Errorf("小说 ID 无效")
	}
	return a.settingStore.Upsert(a.ctx, input.NovelID, input.ID, input.Category, input.Content)
}

// DeleteSetting 删除一条世界设定。
func (a *App) DeleteSetting(novelID, id int64) error {
	if a.settingStore == nil {
		return fmt.Errorf("setting store 未初始化")
	}
	return a.settingStore.Delete(a.ctx, novelID, id)
}

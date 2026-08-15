// Package setting 提供"设定管理"：世界设定（力量体系/地理/势力/角色固定属性等）的
// 结构化存储。每条设定有唯一 ID 和分类标签，会话开头全量注入 System3。
package setting

import (
	"context"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

// SettingItem 是一条世界设定。
type SettingItem struct {
	ID        int64     `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	NovelID   int64     `gorm:"column:novel_id;not null;index" json:"novel_id"`
	Category  string    `gorm:"column:category" json:"category"`
	Content   string    `gorm:"column:content" json:"content"`
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
}

// TableName 指定 GORM 表名。
func (SettingItem) TableName() string { return "setting_items" }

// Store 设定存取。
type Store struct {
	DB *gorm.DB
}

func NewStore(db *gorm.DB) *Store { return &Store{DB: db} }

// List 返回某小说的全部设定（按分类、ID 排序）。
func (s *Store) List(ctx context.Context, novelID int64) ([]SettingItem, error) {
	var items []SettingItem
	if err := s.DB.WithContext(ctx).
		Where("novel_id = ?", novelID).
		Order("category ASC, id ASC").
		Find(&items).Error; err != nil {
		return nil, fmt.Errorf("setting store: list: %w", err)
	}
	return items, nil
}

// Upsert 新建或更新设定。
// id > 0：PATCH 语义，只更新传入的 category/content 字段。
// id <= 0：新建；若同分类存在"主题相同"的条目（内容前 8 个字一致），则合并更新该条目，避免重复。
func (s *Store) Upsert(ctx context.Context, novelID, id int64, category, content string) (*SettingItem, error) {
	category = strings.TrimSpace(category)
	content = strings.TrimSpace(content)
	if category == "" || content == "" {
		return nil, fmt.Errorf("setting store: 分类和内容不能为空")
	}

	if id > 0 {
		var item SettingItem
		if err := s.DB.WithContext(ctx).First(&item, id).Error; err != nil {
			return nil, fmt.Errorf("setting store: 设定不存在: %w", err)
		}
		updates := map[string]any{}
		if category != "" {
			updates["category"] = category
		}
		if content != "" {
			updates["content"] = content
		}
		if len(updates) > 0 {
			if err := s.DB.WithContext(ctx).Model(&item).Updates(updates).Error; err != nil {
				return nil, fmt.Errorf("setting store: update: %w", err)
			}
		}
		_ = s.DB.WithContext(ctx).First(&item, id).Error
		return &item, nil
	}

	// 新建：同分类同主题则合并更新
	subject := subjectOf(content)
	if subject != "" {
		var existing SettingItem
		err := s.DB.WithContext(ctx).
			Where("novel_id = ? AND category = ? AND content LIKE ?", novelID, category, subject+"%").
			First(&existing).Error
		if err == nil {
			existing.Content = content
			if err := s.DB.WithContext(ctx).Model(&existing).Update("content", content).Error; err != nil {
				return nil, fmt.Errorf("setting store: merge update: %w", err)
			}
			return &existing, nil
		}
	}

	item := SettingItem{NovelID: novelID, Category: category, Content: content}
	if err := s.DB.WithContext(ctx).Create(&item).Error; err != nil {
		return nil, fmt.Errorf("setting store: create: %w", err)
	}
	return &item, nil
}

// Delete 删除一条设定。
func (s *Store) Delete(ctx context.Context, novelID, id int64) error {
	res := s.DB.WithContext(ctx).
		Where("novel_id = ? AND id = ?", novelID, id).
		Delete(&SettingItem{})
	if res.Error != nil {
		return fmt.Errorf("setting store: delete: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return fmt.Errorf("setting store: 设定不存在")
	}
	return nil
}

// subjectOf 取内容的"主题"（首个中文冒号/冒号/句号前的内容，或前 8 个字），用于合并判定。
func subjectOf(content string) string {
	for _, sep := range []string{"：", ":", "。", "，"} {
		if idx := strings.Index(content, sep); idx > 0 {
			s := strings.TrimSpace(content[:idx])
			if len([]rune(s)) <= 20 {
				return s
			}
		}
	}
	r := []rune(content)
	if len(r) > 8 {
		return string(r[:8])
	}
	return content
}

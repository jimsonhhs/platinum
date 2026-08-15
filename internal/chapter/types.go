package chapter

import "time"

// Chapter 是章节元数据，正文和大纲以文件形式存储在 Git 仓库中。
// DB 仅保存索引和统计信息，不存实际内容。
type Chapter struct {
	ID            int64     `gorm:"column:id;primaryKey;autoIncrement"                                    json:"id"`
	NovelID       int64     `gorm:"column:novel_id;not null;uniqueIndex:uk_novel_chapter;index"           json:"novel_id"`
	ChapterNumber int       `gorm:"column:chapter_number;not null;uniqueIndex:uk_novel_chapter"           json:"chapter_number"`
	Title         string    `gorm:"column:title"                                                          json:"title"`
	PrevChapterNumber int   `gorm:"column:prev_chapter_number;default:0" json:"prev_chapter_number"` // 真实上一章（跨空洞），新建时默认记录，AI 可更新
	SortOrder         float64 `gorm:"column:sort_order;default:0"        json:"sort_order"`        // 展示/叙事顺序（拖拽调序用），默认=chapter_number
	Volume            int     `gorm:"column:volume;default:1"            json:"volume"`            // 所属卷（1=第一卷），卷是虚拟分组
	Summary       string    `gorm:"column:summary"                                                        json:"summary"` // AI 生成的章节简介
	WordCount     int       `gorm:"column:word_count;default:0"                                           json:"word_count"`
	CreatedAt     time.Time `gorm:"column:created_at;autoCreateTime"                                      json:"created_at"`
	UpdatedAt     time.Time `gorm:"column:updated_at;autoUpdateTime"                                      json:"updated_at"`
	FilePath      string    `gorm:"-"                                                                       json:"file_path"` // 不存 DB，由 git.ChapterPath 计算
}

// TableName 指定 GORM 表名。
func (Chapter) TableName() string { return "chapters" }

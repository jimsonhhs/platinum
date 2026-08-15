package novel

import "time"

// Novel 是小说索引，记录每部小说的基本信息。
// 正文存储在 Git 仓库中，路径由 config.NovelDirPath(ID) 实时计算。
type Novel struct {
	ID          int64     `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	Title       string    `gorm:"column:title;not null;index"        json:"title"`
	Genre       string    `gorm:"column:genre;index"                 json:"genre"`
	Description string    `gorm:"column:description"                 json:"description"`
	BreakWords  string    `gorm:"column:break_words"                 json:"break_words"` // 旧字段（兼容，视为第 1 轮）
	BreakWords1 string    `gorm:"column:break_words_1"               json:"break_words_1"` // 破甲词第 1 轮
	BreakWords2 string    `gorm:"column:break_words_2"               json:"break_words_2"` // 破甲词第 2 轮（空则不进入下一轮）
	BreakWords3 string    `gorm:"column:break_words_3"               json:"break_words_3"` // 破甲词第 3 轮（空则不进入下一轮）
	AIConfig    string    `gorm:"column:ai_config"                   json:"ai_config"`     // JSON：{"inject_world":true,"inject_goink":true,"maint":["outline",...]}，空=全开
	ChapterSeq  int       `gorm:"column:chapter_seq;default:0"       json:"chapter_seq"`   // 章节号单调计数器（删除不回退，保证编号永不复用）
	Volumes     string    `gorm:"column:volumes"                     json:"volumes"`       // JSON 卷定义：[{"name":"第一卷"},...]，空=默认第一卷
	EnabledStyle string   `gorm:"column:enabled_style"               json:"enabled_style"` // 当前书启用的文风（styles/ 下的文件名，空=未启用）
	CreatedAt   time.Time `gorm:"column:created_at;autoCreateTime"   json:"created_at"`
	UpdatedAt   time.Time `gorm:"column:updated_at;autoUpdateTime"   json:"updated_at"`
}

// TableName 指定 GORM 表名。
func (Novel) TableName() string { return "novels" }

// PreferenceItem 是创作偏好条目。
// IsGlobal=true 表示用户级偏好（对所有小说生效），IsGlobal=false 表示特定小说的偏好。
type PreferenceItem struct {
	ID        int64     `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	NovelID   int64     `gorm:"column:novel_id;index"             json:"novel_id"`  // IsGlobal=true 时无意义
	IsGlobal  bool      `gorm:"column:is_global;not null;index"   json:"is_global"` // true=用户全局，false=特定小说
	Category  string    `gorm:"column:category"                   json:"category"`  // LLM 自行归类，自由文本
	Content   string    `gorm:"column:content;not null"           json:"content"`   // 偏好内容
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime"  json:"created_at"`
}

// TableName 指定 GORM 表名。
func (PreferenceItem) TableName() string { return "preference_items" }

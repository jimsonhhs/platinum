package migrate

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"gorm.io/gorm"

	"novel/internal/chapter"
	"novel/internal/character"
	"novel/internal/config"
	"novel/internal/location"
	"novel/internal/novel"
	"novel/internal/reader"
	"novel/internal/rollback"
	"novel/internal/session"
	"novel/internal/storage"
	"novel/internal/storyarc"
	"novel/internal/timeline"
	"novel/internal/style"
	"novel/internal/writing"
	"novel/internal/setting"
)

// Run 自动创建/更新全部数据表，幂等安全。
func Run(db *gorm.DB, log *slog.Logger) error {
	// 移除旧 novels 表的 dir_path 列（该字段从未被读取过）。幂等：列不存在时报错忽略。
	if err := db.Exec("ALTER TABLE novels DROP COLUMN dir_path").Error; err != nil {
		log.Warn("迁移：删除 novels.dir_path 列失败（如列已不存在则无害）", "err", err)
	}

	models := []any{
		&config.AppSettings{},
		&setting.SettingItem{},
		&novel.Novel{},
		&novel.PreferenceItem{},
		&chapter.Chapter{},
		&character.Character{},
		&character.CharacterRelation{},
		&timeline.TimelineEntry{},
		&storyarc.StoryArc{},
		&storyarc.ArcNode{},
		&location.Location{},
		&location.LocationRelation{},
		&reader.ReaderPerspective{},
		&session.Session{},
		&session.Message{},
		&storage.OperationLogRecord{},
		&rollback.TurnCommit{},
		&style.Sample{},
		&writing.WritingLog{},
	}

	for _, m := range models {
		if err := db.AutoMigrate(m); err != nil {
			return fmt.Errorf("migrate: %T: %w", m, err)
		}
	}

	log.Info("数据库迁移完成", "tables", len(models))

	// ── 数据初始化（幂等）──────────────────────────────────
	// 卷：默认第一卷；sort_order：默认=chapter_number；chapter_seq：默认=最大章号（单调不回退）
	var novels []novel.Novel
	if err := db.Find(&novels).Error; err != nil {
		return fmt.Errorf("migrate: load novels: %w", err)
	}
	for _, n := range novels {
		// chapter_seq 初始化
		var maxNum int
		if err := db.Model(&chapter.Chapter{}).
			Where("novel_id = ?", n.ID).
			Select("COALESCE(MAX(chapter_number), 0)").Scan(&maxNum).Error; err != nil {
			return fmt.Errorf("migrate: max chapter: %w", err)
		}
		if n.ChapterSeq < maxNum {
			if err := db.Model(&novel.Novel{}).Where("id = ?", n.ID).Update("chapter_seq", maxNum).Error; err != nil {
				return fmt.Errorf("migrate: update seq: %w", err)
			}
		}
		// volume / sort_order 初始化（新列默认 0 → 归一到 1 / chapter_number）
		if err := db.Model(&chapter.Chapter{}).
			Where("novel_id = ? AND volume = 0", n.ID).
			Update("volume", 1).Error; err != nil {
			return fmt.Errorf("migrate: volume init: %w", err)
		}
		if err := db.Model(&chapter.Chapter{}).
			Where("novel_id = ? AND sort_order = 0", n.ID).
			UpdateColumn("sort_order", gorm.Expr("chapter_number")).Error; err != nil {
			return fmt.Errorf("migrate: sort init: %w", err)
		}
	}
	log.Info("数据初始化完成（卷/顺序/章节计数器）")

	// ── 品牌迁移：goink.md → platinum.md（文件重命名 + ai_config 模块 id 迁移）──
	migrateGoinkToPlatinum(db, log)
	return nil
}

// migrateGoinkToPlatinum 把各小说的 goink.md 重命名为 platinum.md，并迁移 ai_config 中 maint 的旧模块 id。
func migrateGoinkToPlatinum(db *gorm.DB, log *slog.Logger) {
	var novels []novel.Novel
	if err := db.Find(&novels).Error; err != nil {
		log.Warn("品牌迁移：读取小说列表失败", "err", err)
		return
	}
	for _, n := range novels {
		// 文件重命名（git 仓库内）
		oldP := filepath.Join(config.NovelDirPath(n.ID), "goink.md")
		newP := filepath.Join(config.NovelDirPath(n.ID), "platinum.md")
		if _, err := os.Stat(oldP); err == nil {
			if _, err2 := os.Stat(newP); err2 == nil {
				_ = os.Remove(oldP) // 新文件已存在，删除旧残留
			} else {
				if err3 := os.Rename(oldP, newP); err3 != nil {
					log.Warn("品牌迁移：重命名 goink.md 失败", "novel", n.ID, "err", err3)
				} else {
					log.Info("品牌迁移：goink.md → platinum.md", "novel", n.ID)
				}
			}
		}
		// ai_config maint 旧模块 id 'goink' → 'platinum'
		if n.AIConfig != "" && strings.Contains(n.AIConfig, "goink") {
			var cfg map[string]any
			if json.Unmarshal([]byte(n.AIConfig), &cfg) == nil {
				if arr, ok := cfg["maint"].([]any); ok {
					for i, v := range arr {
						if s, ok := v.(string); ok && s == "goink" {
							arr[i] = "platinum"
						}
					}
					b, _ := json.Marshal(cfg)
					_ = db.Model(&novel.Novel{}).Where("id = ?", n.ID).Update("ai_config", string(b)).Error
				}
			}
		}
	}
}

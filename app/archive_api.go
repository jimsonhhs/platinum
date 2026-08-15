package app

import (
	"fmt"
	"time"

	"novel/internal/archive"
	"novel/internal/config"
)

// ArchiveRestoreInput 是恢复单个文件的入参。
type ArchiveRestoreInput struct {
	SnapshotID string `json:"snapshot_id"`
	Path       string `json:"path"` // 快照内相对路径，如 novels/1/chapters/003.md
}

// ListSnapshots 返回全部存档快照。
func (a *App) ListSnapshots() ([]archive.SnapshotMeta, error) {
	return archive.List()
}

// CreateSnapshot 手动立即存档一次。
func (a *App) CreateSnapshot() (string, error) {
	return archive.Create(0)
}

// ListSnapshotFiles 返回快照内全部文件（相对路径）。
func (a *App) ListSnapshotFiles(snapshotID string) ([]string, error) {
	return archive.ListFiles(snapshotID)
}

// RestoreSnapshotFile 恢复快照中的单个文件到原始位置。恢复前自动存档当前状态（防误操作无法回退）。
func (a *App) RestoreSnapshotFile(input ArchiveRestoreInput) error {
	if input.SnapshotID == "" || input.Path == "" {
		return fmt.Errorf("参数无效")
	}
	a.safetySnapshot()
	return archive.RestoreFile(input.SnapshotID, input.Path)
}

// RestoreSnapshotAll 恢复整个快照（覆盖同名文件），返回恢复的文件数。恢复前自动存档当前状态。
func (a *App) RestoreSnapshotAll(snapshotID string) (int, error) {
	if snapshotID == "" {
		return 0, fmt.Errorf("快照 ID 无效")
	}
	a.safetySnapshot()
	return archive.RestoreAll(snapshotID)
}

// safetySnapshot 在恢复操作前自动对当前状态存档一次（失败仅告警，不阻塞恢复）。
func (a *App) safetySnapshot() {
	if _, err := archive.Create(0); err != nil {
		a.logger.Warn("恢复前自动存档失败", "err", err)
	} else {
		a.logger.Info("恢复前已自动存档当前状态")
	}
}

// SaveArchiveInterval 保存定时存档间隔（分钟，0=关闭）。
func (a *App) SaveArchiveInterval(minutes int) error {
	if minutes < 0 || minutes > 1440 {
		return fmt.Errorf("存档间隔需在 0-1440 分钟之间")
	}
	a.settings.ArchiveIntervalMinutes = minutes
	return config.SaveSettings(a.db, a.settings)
}

// startArchiveTimer 启动定时存档后台任务（每分钟检查一次间隔）。
func (a *App) startArchiveTimer() {
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		last := time.Now()
		for {
			select {
			case <-a.ctx.Done():
				return
			case <-ticker.C:
				s := a.settings
				if s == nil || s.ArchiveIntervalMinutes <= 0 {
					last = time.Now()
					continue
				}
				iv := time.Duration(s.ArchiveIntervalMinutes) * time.Minute
				if time.Since(last) >= iv {
					if _, err := archive.Create(0); err != nil {
						a.logger.Warn("定时存档失败", "err", err)
					} else {
						a.logger.Info("定时存档完成", "interval_min", s.ArchiveIntervalMinutes)
					}
					last = time.Now()
				}
			}
		}
	}()
}

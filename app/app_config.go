package app

import (
	"fmt"
	"runtime"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"novel/internal/config"
	"novel/internal/storage"
)

// GetAppConfig 返回当前运行时配置信息（供前端诊断）。
func (a *App) GetAppConfig() map[string]any {
	if a.cfg == nil {
		return map[string]any{"initialized": false}
	}
	return map[string]any{
		"initialized": true,
		"data_dir":    config.DataDirPath(),
	}
}

// UpdateDataDir 更改数据目录并立即重新初始化所有运行时模块（无需重启）。
func (a *App) UpdateDataDir(newPath string) error {
	if newPath == "" {
		return fmt.Errorf("数据目录路径不能为空")
	}

	// 先保存新配置（写入 exe 目录/data_dir.txt），失败时旧 DB 仍可用
	if err := config.Save(newPath); err != nil {
		return fmt.Errorf("保存配置失败: %w", err)
	}

	// 关闭旧数据库
	if a.db != nil {
		if err := storage.Close(a.db); err != nil {
			return fmt.Errorf("关闭旧数据库失败: %w", err)
		}
		a.db = nil
	}

	// 重新加载并初始化
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("加载新配置失败: %w", err)
	}

	a.initWithConfig(cfg)
	a.logger.Info("数据目录已更改", "data_dir", config.DataDirPath())
	return nil
}

// PickDataDir 弹出目录选择对话框，返回用户选择的目录路径（取消返回空串）。
func (a *App) PickDataDir() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("应用尚未初始化")
	}
	selected, err := wailsruntime.OpenDirectoryDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title:            "选择数据目录",
		DefaultDirectory: config.DataDirPath(),
	})
	if err != nil {
		return "", fmt.Errorf("打开目录选择失败: %w", err)
	}
	return selected, nil // 空串 = 用户取消
}

// GetPlatform 返回平台信息，供前端决定默认路径等行为。
func (a *App) GetPlatform() map[string]any {
	return map[string]any{
		"os":          runtime.GOOS,
		"defaultPath": config.DataDirPath(),
	}
}

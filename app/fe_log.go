package app

import (
	"os"
	"path/filepath"
	"time"

	"novel/internal/config"
)

// LogFrontend 前端调试日志（写 runtime/dnd.log），用于验证交互状态。
func (a *App) LogFrontend(msg string) error {
	dir := filepath.Join(config.DataDirPath(), "runtime")
	_ = os.MkdirAll(dir, 0755)
	line := time.Now().Format("15:04:05.000") + " | FE | " + msg + "\n"
	f, err := os.OpenFile(filepath.Join(dir, "dnd.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.WriteString(line)
	return err
}

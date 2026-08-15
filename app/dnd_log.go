package app

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"novel/internal/config"
)

// logDrag 把拖拽操作参数追加写入数据目录 runtime/dnd.log（调试用，验证拖拽结果）。
func logDrag(novelID int64, op string, chapterID int64, volume int, order float64) {
	dir := filepath.Join(config.DataDirPath(), "runtime")
	_ = os.MkdirAll(dir, 0755)
	line := fmt.Sprintf("%s | novel=%d | op=%s | chapter_id=%d | volume=%d | order=%.6f\n",
		time.Now().Format("15:04:05.000"), novelID, op, chapterID, volume, order)
	f, err := os.OpenFile(filepath.Join(dir, "dnd.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.WriteString(line)
}

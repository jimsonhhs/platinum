package agentcfg

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gorm.io/gorm"

	"novel/internal/config"
	"novel/internal/novel"
)

// StylesDir 返回全局文风库目录。
func StylesDir() string {
	return filepath.Join(config.DataDirPath(), "styles")
}

// EnabledStyle 返回某小说启用的文风内容（从文风库读取），未启用返回空。
func EnabledStyle(db *gorm.DB, novelID int64) string {
	if db == nil || novelID <= 0 {
		return ""
	}
	var n novel.Novel
	if err := db.First(&n, novelID).Error; err != nil {
		return ""
	}
	name := strings.TrimSpace(n.EnabledStyle)
	if name == "" {
		return ""
	}
	// 文件名安全：只允许基础文件名
	if strings.ContainsAny(name, `/\`) || filepath.Ext(name) != ".md" {
		return ""
	}
	data, err := os.ReadFile(filepath.Join(StylesDir(), name))
	if err != nil {
		return ""
	}
	return string(data)
}

// StyleFileName 把文风名转为安全的文件名。
func StyleFileName(name string) string {
	safe := strings.Map(func(r rune) rune {
		if r == ' ' || r == '　' {
			return '_'
		}
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r > 127 {
			return r
		}
		return '_'
	}, strings.TrimSpace(name))
	if safe == "" {
		safe = "style"
	}
	return fmt.Sprintf("%s.md", safe)
}

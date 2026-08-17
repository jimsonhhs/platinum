package imp

import (
	"fmt"
	"log/slog"
	"path/filepath"
	"strings"
)

// Chapter 表示解析出的一章。
type Chapter struct {
	Title   string
	Content string
}

// SkippedChapter 记录解析时跳过的章节。
type SkippedChapter struct {
	Title  string `json:"title"`
	Reason string `json:"reason"`
}

// Result 是导入解析的结果。
type Result struct {
	Title           string
	Chapters        []Chapter
	SkippedChapters []SkippedChapter
	NeedsLLM        bool // 当正则无法正确分割时设为 true，提示前端可调用 LLM 分析
}

// Parse 根据文件扩展名选择合适的解析器。
func Parse(filePath string, logger *slog.Logger) (*Result, error) {
	return ParseWithSeparator(filePath, logger, "")
}

// ParseWithSeparator 支持用户指定章节分隔符（"章""节""篇"等）；空串时用默认全模式。
func ParseWithSeparator(filePath string, logger *slog.Logger, separator string) (*Result, error) {
	ext := strings.ToLower(filepath.Ext(filePath))
	switch ext {
	case ".epub":
		return parseEpub(filePath, logger)
	case ".txt", ".md", ".markdown":
		return parseTxt(filePath, separator)
	default:
		return nil, fmt.Errorf("不支持的文件格式: %s", ext)
	}
}

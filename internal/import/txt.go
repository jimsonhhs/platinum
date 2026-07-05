package imp

import (
	"fmt"
	"os"
	"regexp"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
)

// chapterMarkerRe 匹配章节标记行（仅匹配行首的章节头，不含后续正文）。
// 支持：第N章、第一章、Chapter N 等，以及可选的 Markdown # 前缀。
var chapterMarkerRe = regexp.MustCompile(
	`(?m)^(?:#{1,6}\s+)?(?:[ 　\t]*)(第[零〇一二三四五六七八九十百千两\d]+[章卷部]|Chapter\s+\d+)\s*[：:\.\s]?\s*(.*)`,
)

// maxChapterTitleLen 章节标题行最大字符数，超过此长度的视为正文引用而非章节头。
const maxChapterTitleLen = 80

func parseTxt(filePath string) (*Result, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("读取文件失败: %w", err)
	}

	content, err := decodeText(data)
	if err != nil {
		return nil, err
	}
	content = strings.ReplaceAll(content, "\r\n", "\n")
	content = strings.ReplaceAll(content, "\r", "\n")

	title := inferTitle(filePath)

	// 找出所有潜在的章节匹配
	var candidates []struct {
		start int    // 在 content 中的字节偏移
		line  string // 匹配行文本
	}
	allMatches := chapterMarkerRe.FindAllStringSubmatchIndex(content, -1)
	for _, m := range allMatches {
		lineStart := m[0]
		lineEnd := m[1]
		line := content[lineStart:lineEnd]

		// 过滤：章节标题行不应过长（正文中提到章节号的行通常很长）
		if len([]rune(line)) <= maxChapterTitleLen {
			candidates = append(candidates, struct {
				start int
				line  string
			}{start: lineStart, line: line})
		}
	}

	if len(candidates) == 0 {
		content = strings.TrimSpace(content)
		if content == "" {
			return nil, fmt.Errorf("文件内容为空")
		}
		return &Result{
			Title: title,
			Chapters: []Chapter{{
				Title:   "第1章",
				Content: content,
			}},
		}, nil
	}

	var chapters []Chapter
	for i, c := range candidates {
		var end int
		if i+1 < len(candidates) {
			end = candidates[i+1].start
		} else {
			end = len(content)
		}

		chapContent := strings.TrimSpace(content[c.start:end])

		// 提取标题：取第一行，去除 Markdown 标记
		lines := strings.SplitN(chapContent, "\n", 2)
		titleLine := strings.TrimSpace(lines[0])
		for strings.HasPrefix(titleLine, "#") {
			titleLine = strings.TrimPrefix(titleLine, "#")
			titleLine = strings.TrimSpace(titleLine)
		}
		chapTitle := titleLine

		if chapTitle == "" {
			chapTitle = fmt.Sprintf("第%d章", i+1)
		}

		chapters = append(chapters, Chapter{
			Title:   chapTitle,
			Content: chapContent,
		})
	}

	if len(chapters) == 0 {
		return nil, fmt.Errorf("未能从文件中提取到章节")
	}

	return &Result{
		Title:    title,
		Chapters: chapters,
	}, nil
}

func decodeText(data []byte) (string, error) {
	data = trimUTF8BOM(data)
	if utf8.Valid(data) {
		return string(data), nil
	}
	decoded, err := simplifiedchinese.GB18030.NewDecoder().Bytes(data)
	if err != nil {
		return "", fmt.Errorf("文本编码不是 UTF-8，按 GB18030 解码也失败: %w", err)
	}
	return string(decoded), nil
}

func trimUTF8BOM(data []byte) []byte {
	if len(data) >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF {
		return data[3:]
	}
	return data
}

func inferTitle(filePath string) string {
	name := filePath
	// 去掉路径
	if idx := strings.LastIndex(name, "/"); idx >= 0 {
		name = name[idx+1:]
	}
	if idx := strings.LastIndex(name, "\\"); idx >= 0 {
		name = name[idx+1:]
	}
	// 去掉扩展名
	if idx := strings.LastIndex(name, "."); idx >= 0 {
		name = name[:idx]
	}
	// 去掉常见后缀
	name = strings.TrimSuffix(name, "_")

	if name == "" {
		name = "未命名"
	}
	return name
}

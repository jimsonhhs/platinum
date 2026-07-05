package style

import (
	"fmt"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"novel/internal/text"

	"gopkg.in/yaml.v3"
)

var idRe = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// frontmatter 是 style sample 文件的 YAML 头部。
type frontmatter struct {
	Name string   `yaml:"name"`
	Tags []string `yaml:"tags"`
}

// Service 管理全局风格素材的 CRUD 和风格提取。
type Service struct {
	mu     sync.RWMutex
	logger *slog.Logger
	dir    string // ~/.goink/style_samples/
}

// NewService 创建 Service 并确保目录存在。
func NewService(logger *slog.Logger, dir string) (*Service, error) {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("创建 style_samples 目录失败: %w", err)
	}
	return &Service{logger: logger, dir: dir}, nil
}

// List 返回所有风格素材。
func (s *Service) List() ([]Sample, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var samples []Sample
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		id := strings.TrimSuffix(e.Name(), ".md")
		sample, err := s.load(id)
		if err != nil {
			s.logger.Warn("加载风格素材失败，已跳过", "id", id, "err", err)
			continue
		}
		samples = append(samples, *sample)
	}

	sort.Slice(samples, func(i, j int) bool {
		return samples[i].CreatedAt.Before(samples[j].CreatedAt)
	})
	return samples, nil
}

// Create 创建一条风格素材。
func (s *Service) Create(name, content string) (*Sample, error) {
	id := fmt.Sprintf("%d", time.Now().UnixNano())
	sample := &Sample{
		ID:        id,
		Name:      name,
		Content:   content,
		Tags:      []string{},
		WordCount: len([]rune(content)),
		CreatedAt: time.Now(),
	}

	raw, err := buildFile(sample)
	if err != nil {
		return nil, fmt.Errorf("create style sample: %w", err)
	}
	fullPath := filepath.Join(s.dir, id+".md")
	if err := os.WriteFile(fullPath, []byte(raw), 0644); err != nil {
		return nil, fmt.Errorf("create style sample: %w", err)
	}
	return sample, nil
}

// Delete 删除一条风格素材。
func (s *Service) Delete(id string) error {
	if !idRe.MatchString(id) {
		return fmt.Errorf("无效的素材 ID: %s", id)
	}
	fullPath := filepath.Join(s.dir, id+".md")
	if err := os.Remove(fullPath); err != nil {
		return fmt.Errorf("delete style sample: %w", err)
	}
	return nil
}

// Update 更新素材的名称、内容和标签。
func (s *Service) Update(id, name, content string, tags []string) error {
	if !idRe.MatchString(id) {
		return fmt.Errorf("无效的素材 ID: %s", id)
	}
	sample := &Sample{
		ID:      id,
		Name:    name,
		Content: content,
		Tags:    tags,
	}
	raw, err := buildFile(sample)
	if err != nil {
		return fmt.Errorf("update style sample: %w", err)
	}
	fullPath := filepath.Join(s.dir, id+".md")
	return os.WriteFile(fullPath, []byte(raw), 0644)
}

// Load 获取单条素材完整内容。
func (s *Service) Load(id string) (*Sample, error) {
	if !idRe.MatchString(id) {
		return nil, fmt.Errorf("无效的素材 ID: %s", id)
	}
	return s.load(id)
}

func (s *Service) load(id string) (*Sample, error) {
	fullPath := filepath.Join(s.dir, id+".md")
	raw, err := os.ReadFile(fullPath)
	if err != nil {
		return nil, err
	}

	rawStr := string(raw)
	// 解析 YAML frontmatter
	parts := strings.SplitN(rawStr, "---\n", 3)
	content := rawStr
	var fm frontmatter
	if len(parts) >= 3 {
		if err := yaml.Unmarshal([]byte(parts[1]), &fm); err == nil {
			content = parts[2]
		}
	}

	createdAt := time.Now()
	if info, statErr := os.Stat(fullPath); statErr == nil {
		createdAt = info.ModTime()
	}

	return &Sample{
		ID:        id,
		Name:      fm.Name,
		Content:   strings.TrimSpace(content),
		Tags:      fm.Tags,
		WordCount: len([]rune(strings.TrimSpace(content))),
		CreatedAt: createdAt,
	}, nil
}

// ComputeStats 对多段素材文本进行确定性统计。
func (s *Service) ComputeStats(samples []Sample) Stats {
	var combined strings.Builder
	for _, s := range samples {
		combined.WriteString(s.Content)
		combined.WriteString("\n")
	}
	content := combined.String()

	stats := text.ComputeStats(content)

	// 句子长度分布
	sentences := splitSentences(content)
	total := len(sentences)
	if total == 0 {
		return Stats{}
	}
	short, mid, long := 0, 0, 0
	totalLen := 0
	lens := make([]int, len(sentences))
	for i, s := range sentences {
		l := len([]rune(s))
		lens[i] = l
		totalLen += l
		if l < 15 {
			short++
		} else if l <= 30 {
			mid++
		} else {
			long++
		}
	}

	// 标点密度
	chars := len([]rune(content))
	if chars == 0 {
		chars = 1
	}
	commas := strings.Count(content, "，") + strings.Count(content, ",")
	periods := strings.Count(content, "。") + strings.Count(content, ".")
	exclaims := strings.Count(content, "！") + strings.Count(content, "!")
	questions := strings.Count(content, "？") + strings.Count(content, "?")
	quotes := strings.Count(content, "「") + strings.Count(content, "」") +
		strings.Count(content, "\"") + strings.Count(content, "\u201c") + strings.Count(content, "\u201d")

	// 段落统计
	paragraphs := strings.Split(strings.TrimSpace(content), "\n\n")
	paraCount := 0
	paraTotalLen := 0
	for _, p := range paragraphs {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		paraCount++
		paraTotalLen += len([]rune(p))
	}
	avgParaLen := 0.0
	if paraCount > 0 {
		avgParaLen = float64(paraTotalLen) / float64(paraCount)
	}

	avgSentLen := float64(totalLen) / float64(total)
	varSentLen := 0.0
	for _, l := range lens {
		diff := float64(l) - avgSentLen
		varSentLen += diff * diff
	}
	sentLenStdDev := math.Sqrt(varSentLen / float64(total))

	return Stats{
		TotalChars:      chars,
		TotalWords:      stats.WordCount,
		SentenceCount:   total,
		ShortSentPct:    float64(short) * 100 / float64(total),
		MidSentPct:      float64(mid) * 100 / float64(total),
		LongSentPct:     float64(long) * 100 / float64(total),
		AvgSentLen:      avgSentLen,
		SentLenStdDev:   sentLenStdDev,
		CommaDensity:    float64(commas) * 100 / float64(chars),
		PeriodDensity:   float64(periods) * 100 / float64(chars),
		ExclaimDensity:  float64(exclaims) * 100 / float64(chars),
		QuestionDensity: float64(questions) * 100 / float64(chars),
		QuoteDensity:    float64(quotes) * 100 / float64(chars),
		ParagraphCount:  paraCount,
		AvgParaLen:      avgParaLen,
	}
}

func buildFile(sample *Sample) (string, error) {
	fm := frontmatter{Name: sample.Name, Tags: sample.Tags}
	fmBytes, err := yaml.Marshal(&fm)
	if err != nil {
		return "", fmt.Errorf("marshal frontmatter: %w", err)
	}
	return "---\n" + string(fmBytes) + "---\n\n" + sample.Content, nil
}

func splitSentences(content string) []string {
	var sentences []string
	var b strings.Builder
	for _, r := range content {
		b.WriteRune(r)
		if r == '。' || r == '！' || r == '？' || r == '\n' || r == '.' || r == '!' || r == '?' {
			s := strings.TrimSpace(b.String())
			if s != "" {
				sentences = append(sentences, s)
			}
			b.Reset()
		}
	}
	s := strings.TrimSpace(b.String())
	if s != "" {
		sentences = append(sentences, s)
	}
	return sentences
}

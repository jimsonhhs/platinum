package style

import "time"

// Sample 是一条风格素材。
type Sample struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Content   string    `json:"content"`
	Tags      []string  `json:"tags"`
	WordCount int       `json:"word_count"`
	CreatedAt time.Time `json:"created_at"`
}

// Stats 是代码计算的确定性文本统计，不依赖 LLM。
type Stats struct {
	TotalChars      int     `json:"total_chars"`
	TotalWords      int     `json:"total_words"`
	SentenceCount   int     `json:"sentence_count"`
	ShortSentPct    float64 `json:"short_sent_pct"` // <15 字
	MidSentPct      float64 `json:"mid_sent_pct"`   // 15-30 字
	LongSentPct     float64 `json:"long_sent_pct"`  // >30 字
	AvgSentLen      float64 `json:"avg_sent_len"`
	SentLenStdDev   float64 `json:"sent_len_std_dev"` // 句长标准差
	CommaDensity    float64 `json:"comma_density"`    // 逗号占比
	PeriodDensity   float64 `json:"period_density"`   // 句号占比
	ExclaimDensity  float64 `json:"exclaim_density"`  // 感叹号占比
	QuestionDensity float64 `json:"question_density"` // 问号占比
	QuoteDensity    float64 `json:"quote_density"`    // 引号占比
	ParagraphCount  int     `json:"paragraph_count"`
	AvgParaLen      float64 `json:"avg_para_len"`
}

// ExtractResult 是风格提取的返回值。
type ExtractResult struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	RawContent  string `json:"raw_content"`
	FilePath    string `json:"file_path"`
}

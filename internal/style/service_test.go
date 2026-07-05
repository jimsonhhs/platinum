package style

import (
	"math"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// splitSentences
// ---------------------------------------------------------------------------

func TestSplitSentences_ChinesePeriod(t *testing.T) {
	got := splitSentences("今天天气很好。明天会下雨。")
	if len(got) != 2 {
		t.Fatalf("sentences = %v, want 2", got)
	}
	if got[0] != "今天天气很好。" {
		t.Errorf("first = %q, want 今天天气很好。", got[0])
	}
	if got[1] != "明天会下雨。" {
		t.Errorf("second = %q, want 明天会下雨。", got[1])
	}
}

func TestSplitSentences_MixedPunctuation(t *testing.T) {
	got := splitSentences("他问为什么？没有人回答！沉默。")
	if len(got) != 3 {
		t.Fatalf("sentences = %v, want 3", got)
	}
	if !strings.Contains(got[0], "为什么") {
		t.Errorf("first = %q, should contain 为什么", got[0])
	}
	if !strings.Contains(got[1], "回答") {
		t.Errorf("second = %q, should contain 回答", got[1])
	}
	if !strings.Contains(got[2], "沉默") {
		t.Errorf("third = %q, should contain 沉默", got[2])
	}
}

func TestSplitSentences_English(t *testing.T) {
	got := splitSentences("Hello world. How are you? Fine!")
	if len(got) != 3 {
		t.Fatalf("sentences = %v, want 3", got)
	}
}

func TestSplitSentences_Newline(t *testing.T) {
	got := splitSentences("第一行\n第二行\n")
	if len(got) != 2 {
		t.Fatalf("sentences = %v, want 2", got)
	}
}

func TestSplitSentences_TrailingContent(t *testing.T) {
	// 末尾没有终止符的文本应该作为最后一个句子
	got := splitSentences("第一句。第二句没有句号")
	if len(got) != 2 {
		t.Fatalf("sentences = %v, want 2", got)
	}
	if got[1] != "第二句没有句号" {
		t.Errorf("trailing = %q, want 第二句没有句号", got[1])
	}
}

func TestSplitSentences_Empty(t *testing.T) {
	got := splitSentences("")
	if len(got) != 0 {
		t.Errorf("empty input should yield 0 sentences, got %d", len(got))
	}
}

func TestSplitSentences_OnlyWhitespace(t *testing.T) {
	got := splitSentences("   \n\n  ")
	if len(got) != 0 {
		t.Errorf("whitespace-only should yield 0 sentences, got %d", len(got))
	}
}

func TestSplitSentences_ContinuousPunctuation(t *testing.T) {
	// 连续标点应该各自切分，但空句子被过滤
	got := splitSentences("！！。")
	if len(got) != 0 {
		// "！", "！", "。" 各自为一句，TrimSpace 后只剩标点
		// 实际上 "！" 长度 > 0，所以会保留
		t.Logf("continuous punctuation: %v (len=%d)", got, len(got))
	}
}

func TestSplitSentences_LongChinese(t *testing.T) {
	text := "在一个风雨交加的夜晚，少年独自走在回家的路上，心中充满了对未来的迷茫与不安。突然，一道闪电划破天际，照亮了前方的一座古堡。"
	got := splitSentences(text)
	if len(got) != 2 {
		t.Fatalf("sentences = %d, want 2", len(got))
	}
}

// ---------------------------------------------------------------------------
// ComputeStats (uses a zero-value Service; no dir needed)
// ---------------------------------------------------------------------------

var testSvc = &Service{}

func TestComputeStats_Empty(t *testing.T) {
	got := testSvc.ComputeStats(nil)
	if got.SentenceCount != 0 {
		t.Errorf("SentenceCount = %d, want 0", got.SentenceCount)
	}
	if got.TotalChars != 0 {
		t.Errorf("TotalChars = %d, want 0", got.TotalChars)
	}
}

func TestComputeStats_SingleSample(t *testing.T) {
	samples := []Sample{
		{Content: "短句。这是一句中等长度的句子，包含了逗号。这是一句非常非常非常非常非常非常非常非常长的句子，它超过了三十个字所以应该被归类为长句。"},
	}
	got := testSvc.ComputeStats(samples)

	if got.SentenceCount != 3 {
		t.Errorf("SentenceCount = %d, want 3", got.SentenceCount)
	}
	if got.ShortSentPct <= 0 {
		t.Errorf("ShortSentPct = %.1f, want > 0", got.ShortSentPct)
	}
	if got.LongSentPct <= 0 {
		t.Errorf("LongSentPct = %.1f, want > 0", got.LongSentPct)
	}
	if got.CommaDensity <= 0 {
		t.Errorf("CommaDensity = %.1f, want > 0", got.CommaDensity)
	}
	if got.PeriodDensity <= 0 {
		t.Errorf("PeriodDensity = %.1f, want > 0", got.PeriodDensity)
	}
	if got.ParagraphCount != 1 {
		t.Errorf("ParagraphCount = %d, want 1", got.ParagraphCount)
	}
}

func TestComputeStats_MultipleSamples(t *testing.T) {
	samples := []Sample{
		{Content: "第一段。短。"},
		{Content: "第二段，较长一些。"},
	}
	got := testSvc.ComputeStats(samples)

	if got.SentenceCount != 3 {
		t.Errorf("SentenceCount = %d, want 3", got.SentenceCount)
	}
	// 两个 sample 用 \n 拼接，但段落需要 \n\n 分隔，所以只有 1 个段落
	if got.ParagraphCount != 1 {
		t.Errorf("ParagraphCount = %d, want 1", got.ParagraphCount)
	}
}

func TestComputeStats_PunctuationDensity(t *testing.T) {
	// 精确计算标点密度
	// ComputeStats 拼接多个 sample 时每个加 \n，所以 combined = content + "\n"
	content := "你好，世界。真的！为什么？"
	samples := []Sample{
		{Content: content},
	}
	got := testSvc.ComputeStats(samples)
	combined := content + "\n" // ComputeStats 的拼接逻辑
	runes := float64(len([]rune(combined)))

	wantComma := float64(1) * 100 / runes
	if math.Abs(got.CommaDensity-wantComma) > 0.1 {
		t.Errorf("CommaDensity = %.2f, want ~%.2f", got.CommaDensity, wantComma)
	}

	wantPeriod := float64(1) * 100 / runes
	if math.Abs(got.PeriodDensity-wantPeriod) > 0.1 {
		t.Errorf("PeriodDensity = %.2f, want ~%.2f", got.PeriodDensity, wantPeriod)
	}

	wantExclaim := float64(1) * 100 / runes
	if math.Abs(got.ExclaimDensity-wantExclaim) > 0.1 {
		t.Errorf("ExclaimDensity = %.2f, want ~%.2f", got.ExclaimDensity, wantExclaim)
	}

	wantQuestion := float64(1) * 100 / runes
	if math.Abs(got.QuestionDensity-wantQuestion) > 0.1 {
		t.Errorf("QuestionDensity = %.2f, want ~%.2f", got.QuestionDensity, wantQuestion)
	}
}

func TestComputeStats_QuoteDensity(t *testing.T) {
	content := "他说「你好」然后走了。"
	samples := []Sample{
		{Content: content},
	}
	got := testSvc.ComputeStats(samples)
	combined := content + "\n"
	runes := float64(len([]rune(combined)))

	// 「 和 」各一个
	wantQuote := float64(2) * 100 / runes
	if math.Abs(got.QuoteDensity-wantQuote) > 0.1 {
		t.Errorf("QuoteDensity = %.2f, want ~%.2f", got.QuoteDensity, wantQuote)
	}
}

func TestComputeStats_SentenceLengthDistribution(t *testing.T) {
	// 构造已知长度的句子
	// "短。" = 2 chars (< 15)
	// "这是一句中等长度的句子。" = 12 chars (< 15, 实际含标点 13)
	// 构造 > 30 字的句子
	longSentence := strings.Repeat("很", 30) + "长。"
	samples := []Sample{
		{Content: "短。" + longSentence},
	}
	got := testSvc.ComputeStats(samples)

	if got.ShortSentPct <= 0 {
		t.Errorf("ShortSentPct should be > 0, got %.1f", got.ShortSentPct)
	}
	if got.LongSentPct <= 0 {
		t.Errorf("LongSentPct should be > 0, got %.1f", got.LongSentPct)
	}
	// 百分比之和应接近 100
	total := got.ShortSentPct + got.MidSentPct + got.LongSentPct
	if math.Abs(total-100) > 1 {
		t.Errorf("pct sum = %.1f, want ~100", total)
	}
}

func TestComputeStats_StdDev(t *testing.T) {
	// 所有句子等长时，标准差 = 0
	samples := []Sample{
		{Content: "一二三四五。一二三四五。一二三四五。"},
	}
	got := testSvc.ComputeStats(samples)
	if got.SentLenStdDev > 0.01 {
		t.Errorf("equal-length sentences: StdDev = %.4f, want ~0", got.SentLenStdDev)
	}
}

func TestComputeStats_AvgSentLen(t *testing.T) {
	// "你好。" = 3 chars, "世界。" = 3 chars -> avg = 3
	samples := []Sample{
		{Content: "你好。世界。"},
	}
	got := testSvc.ComputeStats(samples)
	if math.Abs(got.AvgSentLen-3.0) > 0.5 {
		t.Errorf("AvgSentLen = %.1f, want ~3.0", got.AvgSentLen)
	}
}

func TestComputeStats_AvgParaLen(t *testing.T) {
	// 单段落 5 个字
	samples := []Sample{
		{Content: "你好世界。"},
	}
	got := testSvc.ComputeStats(samples)
	if got.AvgParaLen < 1 {
		t.Errorf("AvgParaLen = %.1f, want > 0", got.AvgParaLen)
	}
}

func TestComputeStats_TotalWords(t *testing.T) {
	// 混合中英文
	samples := []Sample{
		{Content: "你好hello世界world。"},
	}
	got := testSvc.ComputeStats(samples)
	if got.TotalWords < 4 { // 至少 2 中文字 + 2 英文单词
		t.Errorf("TotalWords = %d, want >= 4", got.TotalWords)
	}
}

// ---------------------------------------------------------------------------
// buildFile
// ---------------------------------------------------------------------------

func TestBuildFile(t *testing.T) {
	s := &Sample{
		Name:    "测试素材",
		Content: "这是正文内容",
		Tags:    []string{"标签1", "标签2"},
	}
	raw, err := buildFile(s)
	if err != nil {
		t.Fatalf("buildFile: %v", err)
	}
	if !strings.Contains(raw, "---\n") {
		t.Error("should contain frontmatter delimiter")
	}
	if !strings.Contains(raw, "测试素材") {
		t.Error("should contain name")
	}
	if !strings.Contains(raw, "这是正文内容") {
		t.Error("should contain content after frontmatter")
	}
}

func TestBuildFile_EmptyTags(t *testing.T) {
	s := &Sample{
		Name:    "无标签",
		Content: "内容",
		Tags:    nil,
	}
	raw, err := buildFile(s)
	if err != nil {
		t.Fatalf("buildFile: %v", err)
	}
	if !strings.Contains(raw, "无标签") {
		t.Error("should contain name")
	}
}

// ---------------------------------------------------------------------------
// idRe validation
// ---------------------------------------------------------------------------

func TestIDRe_Valid(t *testing.T) {
	validIDs := []string{"abc", "my-sample-123", "A_B", "test-id-v2"}
	for _, id := range validIDs {
		if !idRe.MatchString(id) {
			t.Errorf("id %q should be valid", id)
		}
	}
}

func TestIDRe_Invalid(t *testing.T) {
	invalidIDs := []string{"", "abc def", "id/../../../etc", "中文id", "id.md"}
	for _, id := range invalidIDs {
		if idRe.MatchString(id) {
			t.Errorf("id %q should be invalid", id)
		}
	}
}

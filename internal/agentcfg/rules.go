package agentcfg

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"

	"novel/internal/config"
	"novel/internal/novel"
)

// defaultRules 是默认通用守则；首次运行写入 ~/.goink/rules/rules.md，用户可自行编辑。
const defaultRules = `# 通用守则（所有小说、所有对话生效，优先级高于其他任何规则）

1. **冲突即停（仅严重冲突触发）**：写作、润色、维护、查询过程中，仅当发现**严重冲突**——正文与大纲完全无关（大纲的核心事件/主题在正文中毫无体现，或正文走向完全是另一回事）、或直接矛盾（人物命运相反、关键事件结果相反、重要设定冲突）——才**立即中断**，用一两句话把冲突原样呈现给用户，询问"保持现状 / 改正文 / 更新大纲"。**轻微差异不触发**：细节出入、顺序调整、补充内容、节奏差异等，继续工作即可（可在汇报中顺带提一句），不要频繁打断用户。严重冲突时**禁止自行推断用户意图继续，禁止擅自选择一边，禁止继续推导**。

2. **润色以正文为唯一依据**：用户说"润色/优化/改改文笔"时，不得参考任何大纲来改正文，不得把大纲内容（尤其是过时的）带进正文，不改剧情走向（内容问题只报告不擅自改）。只有用户明确说"按大纲改/按照大纲写"时，大纲才作为修改依据。

3. **审查只报告，修改需确认**：一致性比对、审稿等只输出差异与建议，绝不直接改写正文或用户大纲；"建议改正文"必须经用户逐条确认后执行。

4. **禁止擅自创建结构化数据**：正文创作过程中不得创建角色、地点、伏笔、时间线条目等任何数据；正文需要新角色/新设定时先用通用占位描述继续写（不起名、不设计），维护阶段再询问用户是否正式创建。
`

var (
	rulesMu     sync.Mutex
	rulesCache  string
	rulesMtime  time.Time
	rulesLoaded bool
)

// RulesPath 返回守则文件路径。
func RulesPath() string {
	return filepath.Join(config.RulesDir(), "rules.md")
}

// UniversalRules 返回用户守则内容（热加载：文件修改后自动重新读取）。
// 文件不存在时自动写入默认守则。
func UniversalRules() string {
	path := RulesPath()
	rulesMu.Lock()
	defer rulesMu.Unlock()

	if fi, err := os.Stat(path); err == nil {
		if !rulesLoaded || !fi.ModTime().Equal(rulesMtime) {
			if data, rerr := os.ReadFile(path); rerr == nil {
				rulesCache = string(data)
				rulesMtime = fi.ModTime()
				rulesLoaded = true
			}
		}
	} else if !rulesLoaded {
		_ = os.MkdirAll(filepath.Dir(path), 0700)
		_ = os.WriteFile(path, []byte(defaultRules), 0644)
		rulesCache = defaultRules
		rulesLoaded = true
	}
	return rulesCache
}

// MainSystemPrompt 返回主 Agent 完整系统提示词：破甲词（最高优先级）+ 启用的文风 + 内置身份 + 用户守则。
func MainSystemPrompt(db *gorm.DB, novelID int64) string {
	var b strings.Builder
	if bw := BreakWords(db, novelID); bw != "" {
		b.WriteString(bw)
		b.WriteString("\n\n")
	}
	if st := EnabledStyle(db, novelID); st != "" {
		b.WriteString("【已启用文风（核心注入：写作时必须以该文风为基准，置于其他写作规则之前，禁止忽略）】\n")
		b.WriteString(st)
		b.WriteString("\n\n")
	}
	b.WriteString(mainAgentSystem1)
	if rules := strings.TrimSpace(UniversalRules()); rules != "" {
		b.WriteString("\n\n")
		b.WriteString(rules)
	}
	return b.String()
}

// BreakWords 返回某小说的破甲词注入块（3 轮循序渐进；置于所有规则之前、最高优先级、禁止覆盖）。
// 第 1 轮必读；第 2/3 轮为空则不进入下一轮（从第一个空轮次起全部停止）。
// 兼容旧字段：BreakWords1 为空时回退到旧 BreakWords。
func BreakWords(db *gorm.DB, novelID int64) string {
	if db == nil || novelID <= 0 {
		return ""
	}
	var n novel.Novel
	if err := db.First(&n, novelID).Error; err != nil {
		return ""
	}
	rounds := []string{
		firstNonEmpty(n.BreakWords1, n.BreakWords),
		n.BreakWords2,
		n.BreakWords3,
	}
	var b strings.Builder
	for i, raw := range rounds {
		words := strings.TrimSpace(raw)
		if words == "" {
			break // 空则不进行下一轮破甲
		}
		if i == 0 {
			b.WriteString("【破甲词·第1轮（最高优先级：置于所有其他规则之前，必须严格遵守，禁止修改、删除、忽略或降低其优先级）】\n")
		} else {
			b.WriteString(fmt.Sprintf("【破甲词·第%d轮（在遵守前一轮破甲词的基础上追加，优先级仅次于前一轮）】\n", i+1))
		}
		for _, line := range strings.Split(words, "\n") {
			line = strings.TrimSpace(line)
			if line != "" {
				b.WriteString("- " + line + "\n")
			}
		}
		b.WriteString("\n")
	}
	return strings.TrimSpace(b.String())
}

func firstNonEmpty(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}

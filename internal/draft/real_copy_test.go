package draft

import (
	"testing"

	"novel/internal/git"
)

// 用真实数据目录（Desktop\platinum）验证复制到草稿是否落盘。
// 注意：测试环境 config 未初始化时数据目录为平台默认，本测试仅用于真实目录验证。
func TestCopyToDraftReal(t *testing.T) {
	const novelID = int64(1)
	const num = 1
	body, err := git.ReadFile(novelID, git.ChapterPath(num))
	if err != nil {
		t.Skipf("测试环境无真实数据目录（config 未初始化），跳过: %v", err)
	}
	t.Logf("正文前80字: %q", body[:min(len(body), 80)])
	if err := CopyToDraft(novelID, num, DefaultLimit); err != nil {
		t.Fatalf("CopyToDraft: %v", err)
	}
	d, err := git.ReadFile(novelID, git.DraftPath(num))
	if err != nil {
		t.Fatalf("读草稿失败: %v", err)
	}
	t.Logf("草稿前80字: %q", d[:min(len(d), 80)])
	if d != body {
		t.Fatalf("草稿与正文不一致! 草稿len=%d 正文len=%d", len(d), len(body))
	}
	t.Log("PASS: 草稿已包含正文全文")
}

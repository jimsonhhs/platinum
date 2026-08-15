package draft

import (
	"os"
	"testing"

	"novel/internal/git"
)

// 端到端验证：真实数据目录（GOINK_DATA_DIR 指向 Desktop\platinum）。
// 复现用户场景：006 复制到草稿 → 历史 → 恢复。
func TestCopyDraftHistoryCh6(t *testing.T) {
	if os.Getenv("GOINK_DATA_DIR") == "" {
		t.Skip("未设置 GOINK_DATA_DIR")
	}
	const novelID = int64(1)
	const num = 6
	body, err := git.ReadFile(novelID, git.ChapterPath(num))
	if err != nil {
		t.Fatalf("读正文失败: %v", err)
	}
	t.Logf("正文 len=%d", len(body))

	// 1. 复制到草稿
	if err := CopyToDraft(novelID, num, DefaultLimit); err != nil {
		t.Fatalf("CopyToDraft: %v", err)
	}
	d, err := git.ReadFile(novelID, git.DraftPath(num))
	if err != nil {
		t.Fatalf("读草稿失败: %v", err)
	}
	if d != body {
		t.Fatalf("草稿 != 正文: %d vs %d", len(d), len(body))
	}
	t.Log("1. 复制到草稿 OK")

	// 2. 归档 + 列表
	if _, err := ArchiveCurrent(novelID, git.DraftPath(num), DefaultLimit); err != nil {
		t.Fatalf("ArchiveCurrent: %v", err)
	}
	entries, err := ListHistory(novelID, git.DraftPath(num))
	if err != nil {
		t.Fatalf("ListHistory: %v", err)
	}
	t.Logf("2. 历史条目数=%d, 最新=%v 字数=%d", len(entries), entries[0].Name, entries[0].Words)
	if len(entries) == 0 {
		t.Fatal("历史为空")
	}

	// 3. 恢复
	if err := RestoreHistory(novelID, git.DraftPath(num), entries[0].Name, DefaultLimit); err != nil {
		t.Fatalf("RestoreHistory: %v", err)
	}
	d2, err := git.ReadFile(novelID, git.DraftPath(num))
	if err != nil || d2 != body {
		t.Fatalf("恢复后不一致: %v", err)
	}
	t.Log("3. 恢复 OK")

	// 4. 正文历史（导入会归档正文）
	ImportDraftMock := func() error {
		// 简化：直接归档正文
		_, err := ArchiveCurrent(novelID, git.ChapterPath(num), DefaultLimit)
		return err
	}
	if err := ImportDraftMock(); err != nil {
		t.Fatalf("归档正文: %v", err)
	}
	bEntries, _ := ListHistory(novelID, git.ChapterPath(num))
	t.Logf("4. 正文历史条目数=%d 最新=%v", len(bEntries), bEntries[0].Name)
	t.Log("ALL PASS")
}

package trash

import (
	"os"
	"path/filepath"
	"testing"

	"novel/internal/config"
)

// TestChapterRoundtrip 验证章节：移入回收站 → 列表可见 → 恢复 → 内容与文件还原。
func TestChapterRoundtrip(t *testing.T) {
	t.Setenv("GOINK_DATA_DIR", t.TempDir())
	const novelID int64 = 7
	const num = 3
	content := "第一章正文内容\n第二行\n"

	it, err := MoveChapter(novelID, num, "测试章", 42, content)
	if err != nil {
		t.Fatalf("MoveChapter: %v", err)
	}
	if it.Type != "chapter" || it.OriginalPath != "chapters/003.md" || it.Title != "测试章" {
		t.Fatalf("unexpected item: %+v", it)
	}

	items, err := List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(items) != 1 || items[0].ID != it.ID {
		t.Fatalf("expected 1 item, got %+v", items)
	}

	got, err := it.Content()
	if err != nil || got != content {
		t.Fatalf("Content mismatch: %q %v", got, err)
	}

	rel, err := it.RestoreFiles(novelID)
	if err != nil {
		t.Fatalf("RestoreFiles: %v", err)
	}
	if rel != "chapters/003.md" {
		t.Fatalf("unexpected rel: %s", rel)
	}
	// 文件已回到小说目录
	full := filepath.Join(config.NovelDirPath(novelID), "chapters", "003.md")
	data, err := os.ReadFile(full)
	if err != nil || string(data) != content {
		t.Fatalf("restored file mismatch: %v", err)
	}
	// 回收站已清空
	items, _ = List()
	if len(items) != 0 {
		t.Fatalf("trash should be empty after restore, got %+v", items)
	}
}

// TestChapterPurge 验证章节二次删除后彻底消失。
func TestChapterPurge(t *testing.T) {
	t.Setenv("GOINK_DATA_DIR", t.TempDir())
	it, err := MoveChapter(7, 1, "t", 0, "abc")
	if err != nil {
		t.Fatalf("MoveChapter: %v", err)
	}
	if err := it.Purge(); err != nil {
		t.Fatalf("Purge: %v", err)
	}
	items, _ := List()
	if len(items) != 0 {
		t.Fatalf("expected empty trash after purge, got %+v", items)
	}
}

// TestNovelSkillRoundtrip 验证小说级技能：移入回收站 → 恢复。
func TestNovelSkillRoundtrip(t *testing.T) {
	t.Setenv("GOINK_DATA_DIR", t.TempDir())
	const novelID int64 = 9
	dir := filepath.Join(config.NovelDirPath(novelID), "skills")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	content := "---\nname: mytest\ndescription: d\ncategory: c\nmode: auto\n---\n# body\n"
	if err := os.WriteFile(filepath.Join(dir, "mytest.md"), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	it, err := MoveSkill("novel", novelID, dir, "mytest")
	if err != nil {
		t.Fatalf("MoveSkill: %v", err)
	}
	if it.Type != "skill" || it.OriginalPath != "skills/mytest.md" {
		t.Fatalf("unexpected item: %+v", it)
	}
	// 原文件已不在
	if _, err := os.Stat(filepath.Join(dir, "mytest.md")); !os.IsNotExist(err) {
		t.Fatalf("original skill file should be gone")
	}

	if _, err := it.RestoreFiles(0); err != nil {
		t.Fatalf("RestoreFiles: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "mytest.md"))
	if err != nil || string(data) != content {
		t.Fatalf("restored skill mismatch: %v", err)
	}
	items, _ := List()
	if len(items) != 0 {
		t.Fatalf("trash should be empty, got %+v", items)
	}
}

// TestChapterSameSecondCollision 验证：同号章节在同秒/同毫秒重复删除不互相覆盖。
func TestChapterSameSecondCollision(t *testing.T) {
	t.Setenv("GOINK_DATA_DIR", t.TempDir())
	if _, err := MoveChapter(7, 4, "第四章", 10, "content-A"); err != nil {
		t.Fatalf("MoveChapter 1: %v", err)
	}
	if _, err := MoveChapter(7, 4, "第四章", 10, "content-B"); err != nil {
		t.Fatalf("MoveChapter 2: %v", err)
	}
	items, err := List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d: %+v", len(items), items)
	}
	contents := map[string]string{}
	for _, it := range items {
		c, err := it.Content()
		if err != nil {
			t.Fatalf("Content: %v", err)
		}
		contents[c] = it.ID
	}
	if _, ok := contents["content-A"]; !ok {
		t.Fatalf("content-A lost: %+v", contents)
	}
	if _, ok := contents["content-B"]; !ok {
		t.Fatalf("content-B lost: %+v", contents)
	}
}

// TestUserSkillMoveAndPurge 验证用户级技能：移入回收站（不恢复，避免触碰真实用户目录）→ 二次删除。
func TestUserSkillMoveAndPurge(t *testing.T) {
	t.Setenv("GOINK_DATA_DIR", t.TempDir())
	tmp := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmp, "foo.md"), []byte("# foo"), 0644); err != nil {
		t.Fatal(err)
	}
	it, err := MoveSkill("user", 0, tmp, "foo")
	if err != nil {
		t.Fatalf("MoveSkill: %v", err)
	}
	if it.Type != "skill" || it.Source != "user" || it.OriginalPath != "foo.md" {
		t.Fatalf("unexpected item: %+v", it)
	}
	if err := it.Purge(); err != nil {
		t.Fatalf("Purge: %v", err)
	}
	items, _ := List()
	if len(items) != 0 {
		t.Fatalf("expected empty trash, got %+v", items)
	}
}

package archive

import (
	"os"
	"path/filepath"
	"testing"

	"novel/internal/config"
)

// TestSnapshotRestore 验证：创建快照 → 修改原文件 → 从快照恢复。
func TestSnapshotRestore(t *testing.T) {
	t.Setenv("GOINK_DATA_DIR", t.TempDir())
	const novelID int64 = 5

	// 准备原始文件
	chDir := filepath.Join(config.NovelDirPath(novelID), "chapters")
	if err := os.MkdirAll(chDir, 0755); err != nil {
		t.Fatal(err)
	}
	chFile := filepath.Join(chDir, "001.md")
	if err := os.WriteFile(chFile, []byte("原文内容"), 0644); err != nil {
		t.Fatal(err)
	}

	// 快照
	id, err := Create(0)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if id == "" {
		t.Fatal("empty snapshot id")
	}

	// 修改原文件
	if err := os.WriteFile(chFile, []byte("被改坏了"), 0644); err != nil {
		t.Fatal(err)
	}

	// 列表
	snaps, err := List()
	if err != nil || len(snaps) != 1 {
		t.Fatalf("List: %v %d", err, len(snaps))
	}

	// 文件清单
	files, err := ListFiles(id)
	if err != nil {
		t.Fatalf("ListFiles: %v", err)
	}
	found := false
	for _, f := range files {
		if f == "novels/5/chapters/001.md" {
			found = true
		}
	}
	if !found {
		t.Fatalf("快照中缺少章节文件: %+v", files)
	}

	// 恢复单个文件
	if err := RestoreFile(id, "novels/5/chapters/001.md"); err != nil {
		t.Fatalf("RestoreFile: %v", err)
	}
	data, err := os.ReadFile(chFile)
	if err != nil || string(data) != "原文内容" {
		t.Fatalf("恢复失败: %q %v", data, err)
	}
}

// TestSnapshotPrune 验证：保留最近 keep 份。
func TestSnapshotPrune(t *testing.T) {
	t.Setenv("GOINK_DATA_DIR", t.TempDir())
	for i := 0; i < 5; i++ {
		if _, err := Create(2); err != nil {
			t.Fatalf("Create %d: %v", i, err)
		}
	}
	snaps, err := List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(snaps) > 2 {
		t.Fatalf("应只保留 2 份，实际 %d", len(snaps))
	}
}

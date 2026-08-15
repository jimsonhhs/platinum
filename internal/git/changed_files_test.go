package git

import (
	"os"
	"path/filepath"
	"testing"
)

// TestChangedFiles_Modified 验证：修改已跟踪文件能被检测到。
func TestChangedFiles_Modified(t *testing.T) {
	r, dir, cleanup := testRepo(t, 1)
	defer cleanup()

	if err := os.WriteFile(filepath.Join(dir, "file.txt"), []byte("content\nmodified line\n"), 0644); err != nil {
		t.Fatalf("modify file: %v", err)
	}

	changes, err := r.ChangedFiles()
	if err != nil {
		t.Fatalf("ChangedFiles: %v", err)
	}
	if len(changes) != 1 {
		t.Fatalf("expected 1 change, got %d: %+v", len(changes), changes)
	}
	c := changes[0]
	if c.Path != "file.txt" || c.Status != "modified" {
		t.Errorf("unexpected change: %+v", c)
	}
	if c.Insertions < 1 || c.Deletions < 1 {
		t.Errorf("expected insertions/deletions >= 1, got %+v", c)
	}
}

// TestChangedFiles_Untracked 验证：未跟踪文件被标记为 added 且行数为本地统计。
func TestChangedFiles_Untracked(t *testing.T) {
	r, dir, cleanup := testRepo(t, 1)
	defer cleanup()

	if err := os.WriteFile(filepath.Join(dir, "chapters", "new.md"), []byte("line1\nline2\nline3\n"), 0644); err != nil {
		os.MkdirAll(filepath.Join(dir, "chapters"), 0755)
		if err := os.WriteFile(filepath.Join(dir, "chapters", "new.md"), []byte("line1\nline2\nline3\n"), 0644); err != nil {
			t.Fatalf("write untracked file: %v", err)
		}
	}

	changes, err := r.ChangedFiles()
	if err != nil {
		t.Fatalf("ChangedFiles: %v", err)
	}
	var found *FileChange
	for i := range changes {
		if changes[i].Path == "chapters/new.md" {
			found = &changes[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("untracked file not detected: %+v", changes)
	}
	if found.Status != "added" || found.Insertions != 3 {
		t.Errorf("unexpected untracked change: %+v", found)
	}
}

// TestChangedFiles_Deleted 验证：删除已跟踪文件能被检测到。
func TestChangedFiles_Deleted(t *testing.T) {
	r, dir, cleanup := testRepo(t, 1)
	defer cleanup()

	if err := os.Remove(filepath.Join(dir, "file.txt")); err != nil {
		t.Fatalf("delete file: %v", err)
	}

	changes, err := r.ChangedFiles()
	if err != nil {
		t.Fatalf("ChangedFiles: %v", err)
	}
	if len(changes) != 1 || changes[0].Status != "deleted" || changes[0].Path != "file.txt" {
		t.Fatalf("unexpected changes: %+v", changes)
	}
}

// TestChangedFiles_Clean 验证：无改动时返回空列表。
func TestChangedFiles_Clean(t *testing.T) {
	r, _, cleanup := testRepo(t, 1)
	defer cleanup()

	changes, err := r.ChangedFiles()
	if err != nil {
		t.Fatalf("ChangedFiles: %v", err)
	}
	if len(changes) != 0 {
		t.Fatalf("expected no changes, got %+v", changes)
	}
}

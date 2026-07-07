//go:build cgo && e2e

package e2e

import (
	"os"
	"path/filepath"
	"testing"

	ort "github.com/yalue/onnxruntime_go"

	"novel/internal/config"
	"novel/internal/migrate"
	"novel/internal/platform"
	"novel/internal/rag"
	"novel/internal/storage"
)

func init() {
	// Ensure ONNX lib is set before any test runs
	if lib, err := platform.ResolveOnnxLib(); err == nil {
		ort.SetSharedLibraryPath(lib)
	}
}

func TestAppLifecycle_InitWithConfig(t *testing.T) {
	// Simulate the initWithConfig flow from app/handler.go

	// 1. Set ONNX shared library path (normally done in main.go)
	lib, err := platform.ResolveOnnxLib()
	if err != nil {
		t.Fatalf("ResolveOnnxLib() failed: %v", err)
	}
	ort.SetSharedLibraryPath(lib)

	// 2. Set global config
	dataDir := platform.DataDir()
	cfg := &config.AppConfig{DataDir: dataDir}
	config.Set(cfg)

	// 3. Initialize ONNX embedder (async, like real app)
	modelsDir := config.ModelsDir()
	t.Logf("Models dir: %s", modelsDir)
	rag.InitEmbedder(modelsDir, testLogger(t))

	// 4. Open global database
	dbPath := config.GlobalDBPath()
	t.Logf("DB path: %s", dbPath)
	db, err := storage.Open(dbPath, testLogger(t))
	if err != nil {
		t.Fatalf("storage.Open() failed: %v", err)
	}
	t.Cleanup(func() {
		storage.Close(db)
		os.Remove(dbPath)
	})

	// 5. Run auto-migrations
	if err := migrate.Run(db, testLogger(t)); err != nil {
		t.Fatalf("migrate.Run() failed: %v", err)
	}

	// 6. Load settings
	settings, err := config.LoadSettings(db)
	if err != nil {
		t.Fatalf("config.LoadSettings() failed: %v", err)
	}
	t.Logf("Settings loaded: approval_mode=%s", settings.ApprovalMode)

	// 7. Wait for embedder and initialize vector store
	embedder, err := rag.GetEmbedder()
	if err != nil {
		t.Fatalf("GetEmbedder() failed: %v", err)
	}
	defer embedder.Close()

	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("db.DB() failed: %v", err)
	}

	rag.InitVectorStore(sqlDB, embedder, testLogger(t))
	vs := rag.GetVectorStore()
	if vs == nil {
		t.Fatal("GetVectorStore() returned nil")
	}

	t.Log("Full app lifecycle simulation completed successfully")
}

func TestAppLifecycle_NovelDirectoryCreation(t *testing.T) {
	dataDir := platform.DataDir()

	// Verify DataDir is correct
	expectedDir := os.Getenv("GOINK_DATA_DIR")
	if dataDir != expectedDir {
		t.Errorf("DataDir() = %q, expected %q", dataDir, expectedDir)
	}

	// Verify necessary subdirectories can be created
	for _, sub := range []string{"novels", "skills", "models", "runtime"} {
		p := filepath.Join(dataDir, sub)
		if err := os.MkdirAll(p, 0755); err != nil {
			t.Errorf("MkdirAll %s: %v", sub, err)
		}
	}

	t.Log("Novel directory structure OK")
}

func TestAppLifecycle_DatabaseOperations(t *testing.T) {
	// Open database and verify basic operations
	dbPath := config.GlobalDBPath()
	db, err := storage.Open(dbPath, testLogger(t))
	if err != nil {
		t.Fatalf("storage.Open() failed: %v", err)
	}
	t.Cleanup(func() {
		storage.Close(db)
		os.Remove(dbPath)
	})

	// Run migrations
	if err := migrate.Run(db, testLogger(t)); err != nil {
		t.Fatalf("migrate.Run() failed: %v", err)
	}

	// Verify database is functional
	sqlDB, _ := db.DB()
	if err := sqlDB.Ping(); err != nil {
		t.Fatalf("database ping failed: %v", err)
	}

	// Verify WAL mode
	var mode string
	db.Raw("PRAGMA journal_mode").Scan(&mode)
	if mode != "wal" {
		t.Errorf("journal_mode = %q, expected 'wal'", mode)
	}

	t.Log("Database operations OK")
}

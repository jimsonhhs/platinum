//go:build cgo && e2e

package e2e

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"novel/internal/config"
	"novel/internal/platform"
)

func TestMain(m *testing.M) {
	// 1. GOINK_TESTING must be set (ensures ResolveGit/ResolveOnnxLib skip system fallback)
	if os.Getenv("GOINK_TESTING") == "" {
		fmt.Fprintln(os.Stderr, "FATAL: GOINK_TESTING env var not set; E2E tests require GOINK_TESTING=1")
		os.Exit(1)
	}
	fmt.Println("OK: GOINK_TESTING is set")

	// 2. ResolveGit() must find bundled git (not system git)
	gitBin, err := platform.ResolveGit()
	if err != nil {
		fmt.Fprintf(os.Stderr, "FATAL: ResolveGit() failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("OK: ResolveGit() -> %s\n", gitBin)

	// Verify the resolved path is a bundled path (under DataDir), not system PATH
	dataDir := platform.DataDir()
	if !strings.HasPrefix(gitBin, dataDir) {
		fmt.Fprintf(os.Stderr, "FATAL: ResolveGit() returned non-bundled path: %s (expected under %s)\n", gitBin, dataDir)
		os.Exit(1)
	}
	fmt.Println("OK: git path is under DataDir (bundled)")

	// 3. Verify the resolved git binary actually works
	cmd := exec.Command(gitBin, "--version")
	out, err := cmd.CombinedOutput()
	if err != nil {
		fmt.Fprintf(os.Stderr, "FATAL: bundled git --version failed: %v\n%s\n", err, out)
		os.Exit(1)
	}
	fmt.Printf("OK: bundled git works: %s", string(out))

	// 4. ResolveOnnxLib() must find ONNX runtime (bundled, not system)
	onnxLib, err := platform.ResolveOnnxLib()
	if err != nil {
		fmt.Fprintf(os.Stderr, "FATAL: ResolveOnnxLib() failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("OK: ResolveOnnxLib() -> %s\n", onnxLib)

	if !strings.HasPrefix(onnxLib, dataDir) {
		fmt.Fprintf(os.Stderr, "FATAL: ResolveOnnxLib() returned non-bundled path: %s (expected under %s)\n", onnxLib, dataDir)
		os.Exit(1)
	}
	fmt.Println("OK: ONNX lib path is under DataDir (bundled)")

	// 5. Model files must exist
	modelsDir := config.ModelsDir()
	modelPath := filepath.Join(modelsDir, "model.onnx")
	if _, err := os.Stat(modelPath); err != nil {
		fmt.Fprintf(os.Stderr, "FATAL: model.onnx not found at %s: %v\n", modelPath, err)
		os.Exit(1)
	}
	vocabPath := filepath.Join(modelsDir, "vocab.txt")
	if _, err := os.Stat(vocabPath); err != nil {
		fmt.Fprintf(os.Stderr, "FATAL: vocab.txt not found at %s: %v\n", vocabPath, err)
		os.Exit(1)
	}
	fmt.Printf("OK: models dir -> %s\n", modelsDir)

	// 6. Set global config so config.DataDirPath() etc. work
	cfg := &config.AppConfig{DataDir: platform.DataDir()}
	config.Set(cfg)

	os.Exit(m.Run())
}

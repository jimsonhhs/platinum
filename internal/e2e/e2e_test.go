//go:build cgo

package e2e

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"novel/internal/config"
	"novel/internal/platform"
)

func TestMain(m *testing.M) {
	// 1. System git MUST NOT be accessible (CI hides it)
	if _, err := exec.LookPath("git"); err == nil {
		fmt.Fprintln(os.Stderr, "FATAL: system git is still in PATH; E2E tests require system git to be hidden")
		os.Exit(1)
	}
	fmt.Println("OK: system git is hidden")

	// 2. ResolveGit() must find bundled git
	gitBin, err := platform.ResolveGit()
	if err != nil {
		fmt.Fprintf(os.Stderr, "FATAL: ResolveGit() failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("OK: ResolveGit() -> %s\n", gitBin)

	// 3. Verify the resolved git binary actually works
	cmd := exec.Command(gitBin, "--version")
	out, err := cmd.CombinedOutput()
	if err != nil {
		fmt.Fprintf(os.Stderr, "FATAL: bundled git --version failed: %v\n%s\n", err, out)
		os.Exit(1)
	}
	fmt.Printf("OK: bundled git works: %s", string(out))

	// 4. ResolveOnnxLib() must find ONNX runtime
	onnxLib, err := platform.ResolveOnnxLib()
	if err != nil {
		fmt.Fprintf(os.Stderr, "FATAL: ResolveOnnxLib() failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("OK: ResolveOnnxLib() -> %s\n", onnxLib)

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

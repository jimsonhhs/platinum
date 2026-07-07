//go:build cgo && e2e

package e2e

import (
	"log/slog"
	"os"
	"testing"
)

// testLogger creates a slog.Logger that outputs to stderr for test visibility.
func testLogger(t *testing.T) *slog.Logger {
	t.Helper()
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug}))
}

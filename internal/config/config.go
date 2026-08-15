package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"novel/internal/platform"
)

// ErrNotInitialized 表示指针文件不存在，应用尚未完成首次初始化。没初始化弹出来初始化界面，如果初始化了但是还是出错就谈配置错误恢复
var ErrNotInitialized = errors.New("指针文件不存在，应用未初始化")

var (
	globalCfg *AppConfig
	cfgMu     sync.RWMutex
)

// Set 设置全局配置单例，InitWithConfig 成功后调用。
func Set(cfg *AppConfig) {
	cfgMu.Lock()
	defer cfgMu.Unlock()
	globalCfg = cfg
}

// Get 返回全局配置单例，未初始化时返回 nil。
func Get() *AppConfig {
	cfgMu.RLock()
	defer cfgMu.RUnlock()
	return globalCfg
}

// AppConfig 是启动指针文件的内容。
// 数据目录记录在 exe 所在文件夹的 data_dir.txt（便携，随程序移动），不再写 ~/.goink/config.json。
type AppConfig struct {
	DataDir string `json:"data_dir,omitempty"` // 兼容旧字段，实际以 data_dir.txt 为准
}

// DataDirPath 返回数据根目录（绝对路径）。
// 优先级：GOINK_DATA_DIR 环境变量（仅集成测试）> exe 目录/data_dir.txt（用户选择）> exe 所在目录（默认）。
func DataDirPath() string {
	if dir := os.Getenv("GOINK_DATA_DIR"); dir != "" {
		return dir
	}
	if dir := readLocalDataDir(); dir != "" {
		return dir
	}
	return platform.DataDir()
}

// localDataDirFile 返回记录数据目录的文件路径（exe 所在文件夹/data_dir.txt，便携）。
func localDataDirFile() string {
	dir, err := platform.AppDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "data_dir.txt")
}

// readLocalDataDir 读取 exe 目录/data_dir.txt 中记录的数据目录（不存在或为空返回 ""）。
func readLocalDataDir() string {
	path := localDataDirFile()
	if path == "" {
		return ""
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	dir := strings.TrimSpace(string(data))
	// 兼容 UTF-8 BOM（某些编辑器/PowerShell 写入会带）
	dir = strings.TrimPrefix(dir, "\ufeff")
	// 目录不存在则忽略（可能被移动/删除）
	if _, err := os.Stat(dir); err != nil {
		return ""
	}
	return dir
}

// GlobalDBPath 返回全局数据库路径。
func GlobalDBPath() string {
	return filepath.Join(DataDirPath(), "novel-agent.db")
}

// TrashDir 返回回收站根目录（数据目录下的 trash/，独立于各小说的 git 仓库）。
// 结构：trash/chapters/{novelID}/{chapterNumber}_{ts}.md + .json
//       trash/skills/{source}/{name}_{ts}.md + .json
func TrashDir() string {
	return filepath.Join(DataDirPath(), "trash")
}

// NovelDirPath 返回指定小说的 Git 仓库根目录。
func NovelDirPath(novelID int64) string {
	return filepath.Join(DataDirPath(), "novels", fmt.Sprintf("%d", novelID))
}

// LLMConfigPath 返回 LLM 加密配置文件的固定路径 ~/.goink/llm_config.enc。
func LLMConfigPath() string {
	dir, _ := configDir()
	return filepath.Join(dir, "llm_config.enc")
}

// UserSkillsDir 返回全局（用户级）skill 目录：数据目录下的 skills/，随数据便携，所有小说共用。
func UserSkillsDir() string {
	return filepath.Join(DataDirPath(), "skills")
}

// RulesDir 返回用户守则目录：数据目录下的 rules/（热加载，AI 只读）。
func RulesDir() string {
	return filepath.Join(DataDirPath(), "rules")
}

// NovelSkillsDir 返回指定小说的 skill 目录。
func NovelSkillsDir(novelID int64) string {
	return filepath.Join(NovelDirPath(novelID), "skills")
}

// StyleSamplesDir 返回全局风格素材目录 ~/.goink/style_samples/。
func StyleSamplesDir() string {
	dir, _ := configDir()
	return filepath.Join(dir, "style_samples")
}

// ModelsDir 返回 ONNX 模型目录路径。
// 优先查安装包自带的 runtime/models/，找不到再 fallback 到用户数据目录。
func ModelsDir() string {
	appDir, err := platform.AppDir()
	if err == nil {
		bundled := platform.BundledModelsDir(appDir)
		if _, err := os.Stat(filepath.Join(bundled, "model.onnx")); err == nil {
			return bundled
		}
	}
	return filepath.Join(DataDirPath(), "models")
}

// readLegacyConfigDir 读取旧版 ~/.goink/config.json 中的 data_dir（迁移用）。
func readLegacyConfigDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	path := filepath.Join(home, ".goink", "config.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	cfg := &AppConfig{}
	if json.Unmarshal(data, cfg) != nil {
		return ""
	}
	dir := strings.TrimSpace(cfg.DataDir)
	if dir == "" {
		return ""
	}
	if _, err := os.Stat(dir); err != nil {
		return ""
	}
	return dir
}
func configDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("获取用户目录失败: %w", err)
	}
	return filepath.Join(home, ".goink"), nil
}

// configPath 已废弃：数据目录记录改为 exe 目录/data_dir.txt，不再使用 ~/.goink/config.json。

// Load 读取启动指针文件（exe 目录/data_dir.txt），返回 AppConfig。
// 文件不存在时返回错误，调用方应引导用户完成初始化。
func Load() (*AppConfig, error) {
	path := localDataDirFile()
	if path == "" {
		return nil, fmt.Errorf("%w: 无法定位程序目录", ErrNotInitialized)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		// 迁移兼容：旧版把数据目录写在 ~/.goink/config.json，读到则自动迁移到 data_dir.txt
		if legacy := readLegacyConfigDir(); legacy != "" {
			_ = Save(legacy)
			if err := os.MkdirAll(legacy, 0700); err == nil {
				return &AppConfig{DataDir: legacy}, nil
			}
		}
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("%w: %s", ErrNotInitialized, path)
		}
		return nil, fmt.Errorf("读取配置文件失败: %w", err)
	}

	// 数据目录固定 = exe 所在文件夹（便携）；data_dir.txt 里记录用户选择，可覆盖默认。
	dataDir := strings.TrimSpace(string(data))
	dataDir = strings.TrimPrefix(dataDir, "\ufeff") // 兼容 UTF-8 BOM
	if dataDir == "" {
		dataDir = platform.DataDir()
	}
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return nil, fmt.Errorf("创建数据目录 %s 失败: %w", dataDir, err)
	}
	return &AppConfig{DataDir: dataDir}, nil
}

// expandTilde 将路径开头的 ~ 替换为当前用户主目录。
func expandTilde(path string) string {
	if path == "" || path == "~" {
		home, _ := os.UserHomeDir()
		return home
	}
	if strings.HasPrefix(path, "~/") {
		home, _ := os.UserHomeDir()
		return filepath.Clean(filepath.Join(home, path[2:]))
	}
	return path
}

// Save 将用户选择的数据目录写入 exe 目录/data_dir.txt（便携：整个文件夹拷走，选择跟随）。
// 自动展开 ~ 并转为绝对路径。
func Save(dataDir string) error {
	dataDir = expandTilde(dataDir)
	var err error
	dataDir, err = filepath.Abs(dataDir)
	if err != nil {
		return fmt.Errorf("解析数据目录绝对路径失败: %w", err)
	}

	path := localDataDirFile()
	if path == "" {
		return fmt.Errorf("无法定位程序目录")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return fmt.Errorf("创建配置目录失败: %w", err)
	}
	if err := os.WriteFile(path, []byte(dataDir), 0600); err != nil {
		return fmt.Errorf("写入数据目录记录失败: %w", err)
	}
	return nil
}

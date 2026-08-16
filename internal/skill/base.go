package skill

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// baseSkillNames 是三个基础 skill（内置层文件名，来自 builtin/ 目录）。
// 首次启动复制到用户技能目录，用户可自由编辑；删除后不自动补（仅首次安装）。
var baseSkillNames = []string{"一致性比对", "分段写作", "多章创作"}

// EnsureBaseSkills 首次安装基础 skill：用户技能目录缺少时，从内置层复制。
func EnsureBaseSkills(userSkillsDir string) error {
	if err := os.MkdirAll(userSkillsDir, 0700); err != nil {
		return fmt.Errorf("创建技能目录失败: %w", err)
	}
	for _, name := range baseSkillNames {
		fileName := SanitizeFileName(name) + ".md"
		dst := filepath.Join(userSkillsDir, fileName)
		// 已存在（含用户自己创建的）则跳过
		if _, err := os.Stat(dst); err == nil {
			continue
		}
		src, err := BuiltinFS.ReadFile("builtin/" + fileName)
		if err != nil {
			// 内置层没有（可能被裁剪）→ 跳过，不阻塞启动
			continue
		}
		if err := os.WriteFile(dst, src, 0600); err != nil {
			return fmt.Errorf("写入基础技能 %s 失败: %w", name, err)
		}
	}
	return nil
}

// BuiltinFileNames 返回内置 skill 文件名列表（供调试/日志）。
func BuiltinFileNames() []string {
	entries, err := fs.ReadDir(BuiltinFS, "builtin")
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() {
			out = append(out, e.Name())
		}
	}
	return out
}

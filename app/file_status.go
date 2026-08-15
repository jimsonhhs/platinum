package app

import (
	"fmt"

	"novel/internal/git"
)

// GetChangedFiles 返回小说工作区相对 HEAD 的全部文件改动。
// 纯本地 git 检测，不消耗任何 token；前端据此提示用户把改动交给 AI 做状态维护。
func (a *App) GetChangedFiles(novelID int64) ([]git.FileChange, error) {
	if novelID <= 0 {
		return nil, fmt.Errorf("小说 ID 无效")
	}
	repo, err := git.New(novelID, a.settings.GitName, a.settings.GitEmail, a.logger)
	if err != nil {
		return nil, fmt.Errorf("打开小说仓库失败: %w", err)
	}
	return repo.ChangedFiles()
}

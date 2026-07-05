# 前端错误处理现状与改进计划

## 背景

2026-07-05 审查发现 WorkspaceView 的 novel CRUD handler 用 `catch (err) { console.error(err) }` 吞掉错误，
导致 NovelEditDialog 和 NovelDeleteDialog 内置的 `setError()` 永远无法触发。
已修复：改为 `catch (err) { console.error(err); throw err }`，错误可冒泡到 Dialog 展示。

## 现状分类

### 1. 内部完整处理（有 try/catch + setError + finally）

用户可见错误提示，体验良好。

- CharacterListView — Create/Update/Delete
- LocationListView — Create/Update/Delete
- ReaderView — Create/Update/Delete
- PreferenceView — Create/Update/Delete
- TimelineView — Create/Update/Delete/UpdateChapterPlan
- ArcListView — Create/Update/Delete（故事弧 + 节点，共 7 个写操作）
- ModelConfigTab — SaveLLMConfig
- StyleView — Create/Update/Save/Extract（handleDelete 除外）
- PatternExtractView — Save/Extract

### 2. 内部静默吞错（有 try/catch 但无 UI 反馈）

操作失败后用户看不到任何提示，不知道是否成功。

- CharacterList — DeleteCharacter，catch 注释"静默失败，主视图会处理"
- LocationList — DeleteLocation，catch 注释"静默失败"
- SkillList — DeleteSkill，仅 console.error
- StyleView — DeleteStyleSample，仅 console.error

### 3. 裸 await 无错误处理（连 try/catch 都没有）

操作失败时错误作为 unhandled promise rejection 冒泡，行为不可控。

- ContentPanel — SaveContent (doSave)
- ChapterList — CreateChapter, UpdateChapterTitle
- ProfileView — SaveAvatar, SaveUserName

### 4. WorkspaceView 中的 novel 操作

- handleCreateNovelFromDialog — 已修复（re-throw → Dialog 展示）
- handleUpdateNovel — 已修复（re-throw → Dialog 展示）
- handleDeleteNovel — 已修复（re-throw → Dialog 展示）
- handleSelectNovel — 保留 console.error（无对应 Dialog）
- handleCreateNovel — 保留 console.error（老版内联创建，无 Dialog）
- handleSaveCover — 保留 console.error（无对应 Dialog）
- handleExportNovel — 裸 await（无 try/catch）

## 改进计划

### 优先级高：裸 await 组件加 try/catch

- [ ] ContentPanel.doSave — 加 try/catch + 用户可见错误提示
- [ ] ChapterList.CreateChapter / UpdateChapterTitle — 加 try/catch + 用户可见错误提示
- [ ] ProfileView.SaveAvatar / SaveUserName — 加 try/catch + 用户可见错误提示
- [ ] WorkspaceView.handleExportNovel — 加 try/catch 或 re-throw

### 优先级中：静默吞错组件加用户可见提示

- [ ] CharacterList.DeleteCharacter — 加 setError 或 toast
- [ ] LocationList.DeleteLocation — 加 setError 或 toast
- [ ] SkillList.DeleteSkill — 加 setError 或 toast
- [ ] StyleView.DeleteStyleSample — 统一使用 setError（与同组件其他操作一致）

### 优先级低：统一错误提示方式

目前各组件的 setError 都是内联红色文字，无统一 toast 机制。未来可考虑：
- 引入全局 toast 通知组件（react-hot-toast / sonner 等）
- 统一错误提示样式和位置
- 网络错误、权限错误等通用错误统一处理

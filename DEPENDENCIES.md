# DEPENDENCIES.md — 模块依赖树（反向索引 + 依赖面）

> **核心规则（用户定）：每次完成一个小功能，必须检查依赖/引用是否造成其他影响**，有影响就同步修改其他枝。
> **设计原则**：不是"A 依赖 B"单向记录，而是 **B 记录"谁依赖了我"**——B 改动时查反向索引，逐个评估依赖者的"依赖面"（依赖了 B 的哪些具体输出、强依赖还是弱依赖），判定是否需要连锁修改，**无需重读全部代码**。
> 生成方式：5 子代理全量精读（47k 行代码，~830k token），2026-08-15。

## 0. 术语约定（二维模型）

- **依赖面**：A 依赖 B 的哪些具体输出（函数名/类型/字段/文件路径/i18n 键/事件名）。写全，不能只写"依赖 B"。
- **维度一：耦合强度（针对 B 改"内部实现"时）**：**强** = A 直接用 B 的内部实现细节（具体字段/内部函数/文件路径/行为），B 内部变必须查；**弱** = A 只走 B 的公开接口（函数签名/DTO/interface），B 内部实现随便改，A 不用动。
- **维度二：接口变更敏感性（针对 B 改"接口本身"时，与维度一正交，一律强联动）**：B **改名/改签名/删功能** → 所有引用其名字的依赖者必须跟着改（查反向索引全改）；B **接口新增** → 看类型：函数加参→调用者全改；struct 加字段→一般不用；interface 加方法→实现者全要实现；事件/i18n 键新增→向后兼容。
- **传递判定**：C→A→B 时 B 改是否波及 C，看 C 依赖 A 的什么：A 的 API 签名不变 → 改好 A 内部即可，C 不动；A 把 B 的类型直接暴露给 C → C 也要改。
- **改 B 时的流程**：① 查本节 B 的反向索引（"被谁依赖"）；② 看每个依赖者用到 B 的哪些符号（依赖面）；③ 按二维模型判定：内部实现变更→看耦合强度；接口改名/删功能→一律改；④ 改完跑构建 + audit_i18n + 对照速查表。

---

## 1. 数据层（novel-agent.db + 文件系统）

### 1.1 DB 表（唯一建表入口 `internal/migrate.Run`，19 张表 AutoMigrate）

```
app_config / setting_items / novels / preference_items / chapters / characters /
character_relations / timeline_entries / story_arcs / arc_nodes / locations /
location_relations / reader_perspectives / sessions / messages / operation_log /
turn_commits / style_samples / writing_logs
```
- **加表/加字段 → 只改 migrate.go + 模型 struct**，其余全自动。
- **novels 表关键字段**：`chapter_seq`（单调计数器）、`volumes`（JSON）、`ai_config`（JSON）、`enabled_style`、`break_words_1/2/3`。
- **chapters 表关键字段**：`chapter_number`（文件号=身份，永不变）、`volume`（归属）、`sort_order`（卷内分数序号）、`prev_chapter_number`。
- 数据初始化：`chapter_seq=MAX(chapter_number)`、`volume 0→1`、`sort_order 0→chapter_number`。

### 1.2 文件系统（每本小说一个 git 仓库 `novels/<ID>/`，路径常量集中在 `internal/git/rw.go`）

```
chapters/%03d.md（正文，AI 禁直接写） / drafts/%03d.md（草稿+_history/）
outlines/%03d.md（AI 总结大纲） / user_outlines/%03d.md / platinum.md（故事状态文档）
plans/{scope}.md / skills/ / cover.jpg / rules/rules.md（全局，AI 只读） / sandboxs/*.json（沙盘，多份）
```
- **改路径 → git 包函数 + 前端 path 判断 + 技能/rules 文档 + edit 工具白名单正则 四处同步。**

### 1.4 数据目录（便携）

```
默认 = exe 所在文件夹；用户选择记录在 exe 目录/data_dir.txt（一行路径，便携）
优先级：GOINK_DATA_DIR 环境变量（测试）> data_dir.txt > exe 目录
旧 ~/.goink/config.json 的 data_dir 仅做一次性迁移（config.Load 自动写入 data_dir.txt 后不再读取）
设置页改目录 → UpdateDataDir（保存+关旧DB+重新初始化，立即生效）；PickDataDir 弹目录选择框
```
- **改数据目录逻辑 → config.go（DataDirPath/Load/Save/readLocalDataDir/readLegacyConfigDir）+ app_config.go（UpdateDataDir/PickDataDir）+ settings.go（SetDataDir）+ 前端 GeneralConfigTab 三处同步。**

### 1.3 包依赖面（数据/存储层：16 包）

| 包 | 公开 API（依赖面） | 依赖他人 | 被谁依赖（反向索引） |
|---|---|---|---|
| **config** | DataDirPath/RulesDir/GlobalDBPath/NovelSkillsDir/AppSettings | 无（中枢） | 几乎全部包（路径/DB 位置） |
| **storage** | Open/PageParams/PageResult/PATCH/WithTurn(operation_log 回滚) | gorm | agent/turn 回滚、各 Store、migrate、app |
| **git** | New/WriteFile/ReadFile/Repo/Commit/Log/Revert + 路径常量 | — | chapter/draft/import/rollback/search/agentcfg/pattern/export/rag |
| **chapter** | Store: ListByNovel/GetByNovelAndNumber/Create 等 + Chapter 模型 | git, storage | app/chapter.go、draft、import、migrate、search、pattern、rag、mcp_tools(chapter_tools/memory_tools/rw_tools) |
| **novel** | Novel/PreferenceItem/ParseAIConfig/Store | storage | agentcfg（ParseAIConfig/Novel/EnabledStyle）、mcp_tools、export、app/novel.go、migrate |
| **draft** | CopyToDraft/ImportDraft/ArchiveCurrent/ListHistory/RestoreHistory（签名含 limit） | git, chapter, novel, rag, text | mcp_tools(subagent_tools)、app/draft_api.go、agent 创作流程 |
| **import** | Parse/ImportNovel（包名 imp） | git, chapter, novel, config, text（llm 经 GenerateTextFunc 解耦） | app/import_novel.go、mcp_tools(analyze_material) |
| **archive** | 快照（<DataDir>/archive/<ts>/，AI 不可达） | git, storage | app/archive_api.go |
| **trash** | 回收站（.md+.json 成对，二次删除才清除） | git, storage | app/trash_api.go |
| **rollback** | RollbackBeforeTurn（git revert 三步） | git, storage | agent（配合 storage.WithTurn） |
| **search** | Service（聚合 5 Store + rag + git 读正文） | chapter/character/location/timeline/storyarc + rag + git | app/search.go、mcp_tools（toolContext.SearchService） |
| **migrate** | Run（19 表 AutoMigrate + 品牌迁移 goink.md→platinum.md + 数据初始化） | 全部模型 | app/handler.go（唯一调用） |
| **setting** | SettingItem + Store.Upsert | storage | agentcfg（世界设定注入）、mcp_tools(upsert_setting)、app/setting_api.go |
| **skill** | Store/ParseBytes/SanitizeFileName/SkillMeta/ModeAlways | storage | agentcfg（技能目录/常驻技能）、agent、pattern、style、mcp_tools(edit 校验)、app/skill_api.go |
| **version** | Version | — | update、app |
| **logger** | — | — | 全部 |

---

## 2. AI 上下文注入链（每轮 system 组装）

### 2.1 主会话 4 条 system（`app/chat.go` writeSystemMessages，事务内）

```
① MainSystemPrompt（agentcfg） = 破甲词(break_words_1/2/3，空则止)
                                + 【已启用文风】(novel.enabled_style → styles/ 目录)
                                + mainAgentSystem1（身份/创作流程/操作准则/文件路径约定）
                                + UniversalRules（rules/rules.md 热加载，缺失写默认）
② AlwaysSkills（mode=always 的 skill 正文拼合，去 frontmatter）
③ SkillCatalog（mode=auto 的 skill 目录，novel>user>builtin 分组）
④ NovelState = 【小说基础信息】 + [inject_goink]【故事状态文档】platinum.md
              + [inject_world]【世界设定】setting_items 全量
              + 【本书 AI 功能配置】ai_config.maint 声明
              + 【当前打开章节】(SetCurrentChapter 前端上报)
```
- **ai_config 空/非法 JSON → 全开**；Maint 空 → AllModules（outline/character/timeline/reader/arc/platinum，兼容旧名 goink）。
- **改注入内容 → 检查点**：agentcfg/novel_state.go 或 aiconfig.go + app/chat.go + 前端 AISettingsDialog + HelpDialog 工具参考。

### 2.2 子 Agent system（RunSubAgent）

```
BreakWords + AgentIdentity(类型) + NovelState（第二条 system）+ user 指令
AllowedTools = agentcfg.Allowlist(类型)：main=44 工具 / review=10 只读 / memory=10 / writer=11（+edit 写正文）
```

### 2.3 压缩（token ≥80% 触发）

主 Agent Compress：LLM 摘要 → 事务 active_version++ → 重建 4 条 system + 摘要 + 保留最近 15 条 user 消息。子 Agent compressInMemory：纯内存。

---

## 3. MCP 工具注册链（40 个工具）

```
新增工具 → ① internal/mcp_tools/xxx_tools.go 定义 RegisterXxxTools
        → ② registry.go RegisterAllTools 挂上
        → ③ agentcfg/identity.go Allowlist 白名单（按 Agent 类型）
        → ④ 帮助对话框工具参考（HelpDialog i18n）
        → ⑤ 前端直调才需 useApp 绑定
```

**注册点（registry.go RegisterAllTools）**：
- novel_tools：get_chapter_list、get_preferences、create_preference、update_preference
- character_tools：get_characters、get_character_relations、create_character、update_character、update_character_relationship
- reader_perspective_tools：get_reader_perspective、create_reader_perspective_entry、update_reader_perspective_entry
- location_tools：get_locations、create_location、update_location、create_location_relation、update_location_relation
- timeline_tools：get_timeline、create_timeline_entry、update_timeline_entry、update_chapter_plan
- storyarc_tools：get_story_arcs、create_story_arc、update_story_arc、create_arc_node、update_arc_node
- rw_tools：edit、read
- memory_tools（**//go:build cgo**）：search_story_memory
- subagent_tools：run_subagent、update_prev_chapter、upsert_setting、copy_to_draft、import_draft、analyze_material、set_enabled_style、list_styles
- delete_tools：delete_record（10 表路由）
- web：web_search、web_fetch

**关键工具依赖面**：
- **edit**（最重）：路径白名单正则 `chapters/\d{3,6}.md|goink.md|outlines/…|skills/…`；内置 skill 只读、rules/archive 受保护、**AI 禁写正文 chapters/（走草稿+import_draft）**；三种 change_type；git diff 审批（approval）；写后 → rag.SubmitRefresh + searchService.UpdateCachedChapter + text.ComputeStats + writing.WritingLog；大改注入 5 步维护提醒。
- **search_story_memory**（cgo）：rag 向量检索 → MMRRerank(0.7) → chapter 元数据 JOIN。
- **run_subagent**：→ agent.RunSubAgent 闭包（memory/review/writer）。
- **set_enabled_style/list_styles**：→ agentcfg.StylesDir + novel.enabled_style。
- **delete_record**：10 表路由 + 关联数据检查 + 审批。

---

## 4. 前端 ↔ 后端契约（useApp 133 方法集中绑定）

### 4.1 绑定规则
- 全部经 `useApp()`（useMemo 封装 133 个 Wails 方法），**CheckUpdate 与 Wails runtime 窗口方法、SearchAll/GetCommitLog/GetCommitFileList/GetFileDiff 例外直接 import**。
- 方法名与 Go 方法名一一对应（Wails 生成 `@/lib/wailsjs/go/app/App`）。
- **新增后端方法 → 重新生成绑定（wails build 自动）+ useApp 导出 + 组件调用。**

### 4.2 调用矩阵（反向索引：方法 ← 谁在用）

| 后端方法 | 调用组件 |
|---|---|
| GetChapters/GetVolumes/SaveVolumes/RenameVolume/DeleteVolume/ReorderVolumes/ReorderChapter/ReorderChaptersBatch/RecomputePrevChapters/CreateChapter/UpdateChapterTitle/DeleteChapter/SetCurrentChapter/GetChangedFiles/LogFrontend | ChapterList + WorkspaceView.DeleteChapter |
| GetContent/SaveContent/ImportDraft/CopyToDraft/ArchiveHistory/ListHistory/RestoreHistory | ContentPanel/HistoryPanel/StyleView/PatternExtractView |
| Chat/CancelChat/CompressContext/GetSessions/GetSession/GetSessionMessages/SetLastSession/ListSlashCommands/SetSelectedModel/SetReasoningEffort/SetApprovalMode/ApproveTool | ChatPanel + WorkspaceView |
| GetModels/GetSettings/GetLLMConfig/SaveLLMConfig/TestConnection/DiscoverModels/SaveGitConfig/GetVersion/CheckUpdate/DismissUpdate/SetDataDir/SaveMaintainReminderMinutes/SaveArchiveInterval/SaveHistoryLimit/RebuildNovelIndex/GetAppConfig | SettingsDialog 系/GeneralConfigTab/UpdateDialog |
| CreateNovel/UpdateNovel/DeleteNovel/SetActiveNovel/GetNovels/SaveCover/ExportNovel | WorkspaceView（NovelEditDialog/AISettingsDialog/ExportDialog/BookshelfView） |
| 角色/地点/弧线/时间线/读者/偏好 CRUD 各 8-12 方法 | 对应 List/View/Graph/ReferenceDrawer |
| ListSettings/SaveSetting/DeleteSetting | SettingList/SettingsView |
| ListSkills/DeleteSkill/RenameSkill/DuplicateSkill | SkillList |
| 文风 14 方法（ListStyles/GetStyleContent/SaveStyleToLibrary/DeleteStyle/SetEnabledStyle/GetEnabledStyle/ExtractStyle/CancelExtract/SelectMaterialFile/ExtractMaterialStyle/ListStyleSamples/样本 CRUD/ComputeStyleStats） | StyleView/StyleSampleList/MaterialExtractCard/StyleLibraryPanel |
| ExtractPattern/CancelExtractPattern | PatternExtractView |
| ImportNovel/PickAndImportNovel/ImportWithLLM | useImportNovel + ImportProgressDialog |
| 快照 5 方法 | ArchiveView |
| 回收站 4 方法 | TrashView |
| GetWritingActivity/GetWritingStats/SaveAvatar/SaveUserName | ProfileView |
| GetPlatform/Initialize/IsInitialized/SaveSettings | App.tsx/InitView |

### 4.3 事件通道（EventsOn）
`file:changed`（edit 工具写文件）、`chat:started`、`agent:<turn_id>`（ChatPanel）、`import:progress`（useImportNovel）、`pattern:progress`（usePatternProgress）。

### 4.4 localStorage 键
`theme`、`i18nextLng`、`goink_tabs_all`、`goink_sidepanel_width`、`goink_chatpanel_width`、`goink_window_{w,h,x,y,maximised}`、`editor_prefs`、`platinum_color_presets`。

---

## 5. 组件传参链（WorkspaceView 状态中心）

```
WorkspaceView（novels/activeNovelId/activePanel/sidebarPanel/tabTarget/aiSettingsNovel/
              editingNovel/exportNovelId/searchQuery/各 focusId/reminder* 等状态）
├── ActivityBar：activeId + enabledModules（从 ai_config.maint 解析，空=全开）→ 模块过滤
├── SidePanel → SearchPanel/SkillList/NovelList/ChapterList/CharacterList/SettingList/
│               LocationList/ArcList/TimelineList/ReaderList/PreferenceList/GitHistoryList/StyleSampleList
│   └── ChapterList（拖拽核心）：props novelId/target/onSelectChapter/onEditNovelSettings/
│       onEditAISettings/onExportNovel/onDeleteChapter/onMaintainChanges
├── 主内容区：ContentPanel(ref)/BookshelfView/CharacterListView/LocationListView/ArcListView/
│             TimelineView/ReaderView/PreferenceView/SettingsView/ExtractWorkspaceView(常驻隐藏)/
│             GitCommitView/TrashView/ArchiveView/ProfileView
├── ChatPanel(ref.send)：onApprove/onReject/onApprovalFileEdit
├── StatusBar：content/isDirty
└── 弹窗：SettingsDialog/HelpDialog/NovelEditDialog(×2)/AISettingsDialog/NovelDeleteDialog/
          ExportDialog/ImportProgressDialog/UpdateDialog + 维护提醒内联遮罩
```

**改 props/状态 → 检查点**：WorkspaceView 定义处 + 子组件 Props 接口 + 传递处（通常 2-3 处同步）。

---

## 6. i18n 链

```
新增/改名键 → zh-CN.json + en.json 同步（zh 1322 键 / en 1364 键，en 有 38 对复数 _one/_other）
→ audit_i18n.cjs 审计（或 scripts/i18n-check.mjs：结构一致性/重复/空值/源码硬编码中文 4 项）
→ 前端 t() 引用
```
- 命名空间 31 个（common/app/init/workspace/shell/sidebar/chat/settings/novel/character/location/storyarc/timeline/reader/preference/search/export/git/skill/styleSample/extract/content/help/profile/markdown/update/trash/archive/settingsView/theme/styleLib）。
- **键改名必须全局搜**（maintainPartGoink→maintainPartPlatinum 先例）。

---

## 7. 部署链

```
wails build（Go 1.26.5 + mingw + CGO_CFLAGS=-IC:\Users\haoha\go\goink-cgo-include）
→ build/bin/platinum.exe
→ deploy_windows.ps1（备份 platinum_时间戳.exe → 部署 → 镜像 V1.0）
→ 强停授权（用户按次授权，当前剩余 1 次）
```

---

## 8. 实战示例：同源调用点清单（新书创建 + AI 设定提示）

> 改"创建后的行为/提示跳转"时，**3 个前端入口必须一起改**（先例：AI 设定跳转漏了快速创建入口）。

1. 后端唯一实现：`app/novel.go` `CreateNovel`（内含初始章节 001 自动创建、chapter_seq=1）。
2. 前端快速创建：`WorkspaceView.tsx` `handleCreateNovel` → confirm(novel.aiConfigReminder) → `setAiSettingsNovel(n)`。
3. 前端新建对话框：`handleCreateNovelFromDialog` → 同上。
4. 前端导入：`handleImportedNovel` → 同上。
- 跳转目标 = `setAiSettingsNovel`（**不是** setEditingNovel 书名简介）；MCP 层无建书工具。
- **将来新增建书入口必须复制此提示逻辑。**

---

## 9. 易遗漏联动速查表（新增/修改功能时对照）

| 改动 | 必须同步检查 |
|------|-------------|
| novel/chapter 表字段 | migrate.go + 模型 struct + agentcfg 注入 + MCP 工具 + 前端类型 + AISettingsDialog |
| 新增 MCP 工具 | RegisterAllTools + identity.go Allowlist + HelpDialog + useApp（如前端直调） |
| i18n 键 | zh-CN + en + audit_i18n.cjs |
| 文件路径/文件名 | internal/git/rw.go + 前端 path 判断 + edit 工具白名单 + 技能/rules + README |
| 沙盘（sandboxs/*.json） | app/sandbox_api.go（List/Get/Save/Create/Update/Delete）+ useApp 6 方法 + SandboxView/SandboxList + i18n；形状/实体关联字段（entityType/entityId）变更需同步前端类型 |
| 沙盘 AI 布局 | internal/mcp_tools/sandbox_tools.go（arrange_sandbox：ops 结构化 move/delete/add + 全量/增量 + 比例尺 + 金字塔 + 嵌套 + 批量拆分）+ agentcfg/identity.go allowlist + app/sandbox_arrange.go（LLM 版按钮）+ 前端 ArrangeSandbox + 自动刷新轮询 + beforeunload 兜底；world/setting 实体关联需同步 entityTarget 与 WorkspaceView focus |
| 后端新方法 | wails build 重新生成绑定 + useApp 导出 + 组件调用 |
| 注入链内容 | agentcfg（MainSystemPrompt/NovelState）+ app/chat.go writeSystemMessages + AISettingsDialog |
| 拖拽/排序 | dnd.log 快照验证 + prev 重算 + 导出顺序 |
| 新建章节入口 | CreateNovel（初始章）/ CreateChapter（计数器）/ import 导入 / trash 恢复 / draft.ImportDraft 自动建章——**5 处都要设 Volume/SortOrder/同步 chapter_seq**，否则文件号冲突或卷序错乱（本次实战修复） |
| 前端状态/props | WorkspaceView + 子组件 Props 接口 + 传递处 |
| 事件通道 | 后端 EventsEmit 名 + 前端 EventsOn 名（import:progress/pattern:progress/file:changed/agent:<turn>） |
| 新功能 | README + 帮助对话框 + DEPENDENCIES.md + 技能库/rules |
| localStorage 键 | 读写处 + 版本迁移（goink_tabs_all 先例） |

## 10. 实战教训：建章入口 5 处联动（2026-08-15 依赖审计发现）

**问题**：卷/排序体系新增后，导入与回收站恢复两条路径**漏设 Volume/SortOrder、漏同步 chapter_seq**：
- 导入书 chapter_seq=0 → 新建章 next=1 与导入第 1 章**文件号冲突**；导入章节 volume=0、sort_order=0。
- 回收站恢复章节 volume=0、sort_order=0 → 恢复后跑到卷首、不更新计数器。
- RecomputePrevChapters/导出按全局 sort_order 排序 → 跨卷**交错**（sort_order 是卷内序号）。

**修复**：
1. `internal/import/import.go`：导入章节 Volume=1、SortOrder=i+1；建章后更新 chapter_seq=chapterCount。
2. `app/trash_api.go` restoreChapter：Volume=1、SortOrder=MAX+1（追加末尾不插队）、chapter_seq=GREATEST(seq, chapNum)。
3. `app/volume_api.go` RecomputePrevChapters + `app/novel.go` ExportNovel：改为「卷顺序→卷内 sort_order」排序（未归属卷排最后），跨卷不交错。
4. CreateNovel 初始章 / CreateChapter / draft.ImportDraft 已正确（Volume/SortOrder/chapter_seq 齐全）。

**规则**：任何新建/恢复章节的路径，必须同时设置 Volume、SortOrder、同步 chapter_seq（5 处入口）。

## 11. 子代理报告归档（原始明细，已汇总进上文）

- `.cowork-temp/deps/report_data.md`（数据层 16 包）
- `.cowork-temp/deps/report_ai.md`（AI/业务层 21 包 + 8 条关键调用路径）
- `.cowork-temp/deps/report_app.md`（app 层 45 文件逐方法）
- `.cowork-temp/deps/report_frontend_core.md`（useApp 133 方法清单 + WorkspaceView 状态表）
- `.cowork-temp/deps/report_frontend_components.md`（组件树 + 调用矩阵）

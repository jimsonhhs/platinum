# KNOWN_ISSUES.md — 功能入口 + 已知坑速查

> 用途：AI 定位 bug 时先查本表（省 token），用户描述现象 → 快速锁定文件/函数/已知坑。
> 维护：每踩一个新坑必须补一条（功能 | 位置 | 坑 | 修复），否则表会过期。

## 一、高频功能入口（去哪找）

| 功能 | 位置 | 入口/说明 |
|---|---|---|
| 沙盘 AI 布局（按钮） | app/sandbox_arrange.go | ArrangeSandbox：LLM 一次性输出全部形状绝对坐标 JSON，专业 prompt 引导，全局规划 |
| 沙盘聊天绘图（AI 工具） | internal/mcp_tools/sandbox_tools.go | arrange_sandbox：结构化 ops（move/delete/add/resize/color + dir 方位），增量执行 |
| 沙盘增量文本解析 | sandbox_tools.go applyIncremental（~1020 行） | 自然语言"在X新建Y"→ 正则解析，含删除/移动/新增分支 |
| 沙盘前端渲染 | frontend/src/components/sandbox/SandboxView.tsx | 形状路径 shapePath（贝塞尔弧线）、编辑悬浮窗、图层、撤销 |
| edit/read 工具 | internal/mcp_tools/rw_tools.go | 路径白名单 pathRe（~546 行）；edit 三种模式 full_replace/search_replace/line_range_replace |
| 创建角色 | internal/mcp_tools/character_tools.go | create_character 批量 1-10，事务原子 |
| 创建地点 | internal/mcp_tools/location_tools.go | create_location/update_location，成功后 Notify "locations:changed" |
| 事件清单（原时间线） | internal/mcp_tools/timeline_tools.go + frontend/src/components/timeline/TimelineView.tsx | 事件状态：not_started/pending/foreshadowing/completed/abandoned |
| 导入 | internal/import/txt.go + parse.go + app/import_novel.go | ParseWithSeparator（空=自动识别章/卷/回/节/篇等）；ImportProgressDialog 前端 |
| 导出 | internal/export/txt.go, markdown.go, epub.go | 标题直接出 ch.Title（无"第X章"前缀），空标题 fallback 第X章 |
| 主题/外观 | frontend/src/components/settings/AppearanceTab.tsx + useTheme.ts | 8 主题 + 自定义主题/编辑器双区域 |
| 聊天会话 | app/chat.go + internal/agent/agent.go | agent.Run 循环；工具执行 → 结果合并 metadata 推前端 |
| 审批 | internal/approval/approval.go | 手动模式零超时阻塞等前端；edit/delete_record 触发 |

## 二、已知坑（踩过，复发率高）

1. **版本注入 -X 路径**：必须完整包路径 `-X novel/internal/version.Version=vX`（go.mod 是 module novel）。写 `internal/version.Version` 会静默失败，运行时永远是 "dev"。验证：`go version -m exe` 看 ldflags。
2. **构建必须带 `-tags native_webview2loader`**：否则 ld 报 `.rsrc merge failure: multiple non-default manifests`（build_windows.ps1 已修）。
3. **skill 文件不能带 UTF-8 BOM**：BOM 导致 frontmatter 开头不是 `---` → "缺少 name 字段"解析失败被跳过。写入 .md 用无 BOM。
4. **edit 路径白名单曾漏 platinum.md**：pathRe 只允许 goink.md（已修加 platinum.md）。改白名单时描述和正则要同步。
5. **增量新增正则 reAdd**：① 无方位词（"在X增加Y"）原本不匹配——已改两步解析；② anchor 贪婪吞词（"霜烬大陆增"）——已修。Go RE2 无负向前瞻，用排除字符类或分步。
6. **opAdd dir 为空**：新形状叠在 anchor 正中心（合体）——已修默认偏移 (160,120)。
7. **GetModels 无客户端返回 nil** → 前端 `null.find` 崩溃。已改返回 `[]`。前端运行时错误看 `runtime/dnd.log`（不是 goink.log）。
8. **标签页串台**：useEditorTabs 的 localStorage（goink_tabs_all）只按 novelId 不分数据目录。已改会话级。
9. **数据目录真源**：桌面版实际用 `Desktop\platinum`（data_dir.txt 优先），不是 ~/.goink/config.json 里的 V2。部署/查数据先确认这个。
10. **完整包必须含 runtime**：exe 单独跑会丢 git/向量检索（onnxruntime.dll + model.onnx 缺失）。分发给 zip 完整包。
11. **PatchAndSave omitempty 限制**：string 字段无法清空为 ""（需要清空时前端传空格或加 ClearXxx flag）。
12. **事件状态旧值兼容**：旧数据 status=pending/resolved，前端 normStatus 映射（resolved→completed）。
13. **沙盘坐标=左上角**：x/y 是形状左上角（circle 用中心），增量/布局计算按此，勿当中心用。
14. **BOM/编码**：改 .ps1 用 UTF-8 BOM（中文路径兼容）；.bat 不要加 chcp 65001（PowerShell 5.1 GBK 输出变乱码）。

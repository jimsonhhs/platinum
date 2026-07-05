# 回滚链路已知问题

本文档记录回滚 operation_log 集成后，已知但暂未修复的问题。

## 问题 1：ClearParent 不走 GORM 回调

**位置**：`app/location_view.go` UpdateLocation 中的 ClearParent 分支

**现象**：`Model().Where().Update("parent_location_id", nil)` 使用零值 struct 作为 Dest，`getPKValues` 无法提取主键，`fetchOldRow` 返回 nil，afterUpdate 回调跳过日志记录。

**影响**：用户清空地点父级时，该操作不被记录到 operation_log，回滚时 parent_location_id 不恢复。

**修复方案**：把 ClearParent 合并进 PatchAndSave 流程。`UpdateLocationInput.ParentLocationID` 已是 `*int64`，PatchAndSave 的 json.Unmarshal 能自然处理 nil，去掉单独的 `Model().Where().Update` 分支。

**严重程度**：中（影响回滚完整性，但仅限 location 的 parent 字段）

## 问题 2：级联删除关系不被追踪

**位置**：
- `app/character_view.go` DeleteCharacter 中级联删除 CharacterRelation
- `app/location_view.go` DeleteLocation 中清空子地点 parent + 删除关系
- `app/storyarc_view.go` DeleteStoryArc 中删除 ArcNode

**现象**：`tx.Where(...).Delete(&Relation{})` 是批量删除，Dest 是零值 struct，`getPKValues` 无法提取主键，回调跳过日志记录。

**影响**：回滚时只能恢复实体本身，无法恢复被级联删除的关系/子节点。

**修复方案**：把批量删除改为 per-row 循环——先 `Find` 查出所有受影响行，再逐行 `Delete(&row)`，每行都触发回调。

**严重程度**：中（仅在"用户删除 AI 曾操作过的实体，随后回滚"时出现，发生率低）

## 问题 3：omitempty 导致无法清空字段

**位置**：所有 `UpdateXxxInput` 结构体的 `omitempty` tag

**现象**：PATCH 语义下，`omitempty` 使 json.Marshal 跳过零值字段。用户无法通过 PATCH 将 string 字段清空为 `""` 或将 int 字段清零。

**影响**：与回滚无关，是 PATCH API 的固有限制。

**修复方案**：将 optional 字段改为指针类型（`*string`、`*int`），或添加显式的 `ClearXxx bool` flag（模仿 ClearParent 模式）。

**严重程度**：低（影响 API 功能，不影响回滚）

## 问题 4：索引列顺序

**位置**：`internal/storage/operation_log.go` OperationLogRecord 的 `idx_oplog_rollback` 索引

**现象**：当前索引列顺序是 `(turn_id, session_id)`，但 `RollbackInTx` 查询条件是 `WHERE session_id = ? AND turn_id >= ? AND turn_id <= ?`，前导列应是 `session_id` 等值匹配。

**影响**：operation_log 量级小（单 session 几百行），性能影响可忽略，但与设计文档不一致。

**修复方案**：调换字段声明顺序，或用 `index:idx_oplog_rollback,priority:1` / `priority:2` 指定列顺序。改完后需要 drop 旧索引、重建。

**严重程度**：低（性能影响可忽略，正确性问题）

## 问题 5：PatchAndSave 的 PK 防御

**位置**：`internal/storage/patch.go` PatchAndSave 函数

**现象**：`json.Unmarshal(data, entity)` 会将 input 中所有 JSON 字段覆盖到 entity 上。当前各 `UpdateXxxInput` 结构体没有 `id`/`novel_id` 字段，所以不会出问题。但这是"靠约定"而非"靠机制"的安全保证。

**影响**：如果有人给 Input 结构体加上 `ID` 或 `NovelID` 字段，会导致主键被覆盖。

**修复方案**：在 Unmarshal 后、Save 前，用反射强制将 entity 的 PK 字段回写为 First 时读到的值。

**严重程度**：低（当前无 bug，但存在未来踩坑风险）

## 修复优先级

| 优先级 | 问题 | 原因 |
|--------|------|------|
| P1 | ClearParent | 影响回滚完整性，修复简单 |
| P2 | 级联删除 | 影响回滚完整性，但发生率低 |
| P2 | PK 防御 | 防御性编程，修复简单 |
| P3 | 索引顺序 | 性能影响可忽略 |
| P3 | omitempty | 与回滚无关，独立追踪 |

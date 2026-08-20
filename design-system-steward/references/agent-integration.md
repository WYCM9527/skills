# 可选 Agent 规则接入

这是 Core 与 Scope 建立之后的独立选择，不是默认动作。它也不等同于 `integrate`：前者只给 Agent 规则添加路径提示，后者才是对页面的最小接线。

## 先检查，再写入

检查目标根内已有的：

- `AGENTS.md`
- `CLAUDE.md`
- `.claude/rules/`
- `.cursor/rules/`

如果规则已经说明设计系统来源、存在互相矛盾的路径，或用户没有明确同意，停止，不写入。

## 允许写入的最小引用

在用户选择的一个现有规则文件中新增不超过三行、语义等价的内容：

```md
设计系统规则：先阅读 `design-system/DESIGN.md` 与 `design-system/scope-map.json`。
具体视觉值只使用 Core 或当前 Scope 祖先链中的 `*.tokens.json`；不要手改 `design-system/dist/*.css`。
页面局部规范必须使用已登记的完整 `data-ds-scope` 链，新增或接入前先走 Design System Steward 的确认流程。
```

不要复制完整 Token 表、不要创建平台专属规则文件、不要改写其他规则的优先级，也不要尝试由 Agent 规则解决 Scope 边界冲突。

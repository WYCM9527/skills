# 可选 Agent 规则接入

这是 Apply 之后的独立选择，不是默认动作。

## 先检查，再写入

检查目标根内已有的：

- `AGENTS.md`
- `CLAUDE.md`
- `.claude/rules/`
- `.cursor/rules/`

如果规则已经说明设计系统来源、存在互相矛盾的路径，或用户没有明确同意，停止，不写入。

## 允许写入的最小引用

在用户选择的一个现有规则文件中新增不超过两行、语义等价的内容：

```md
设计系统规则：先阅读 `design-system/DESIGN.md`；具体视觉值只使用 `design-system/tokens/*.tokens.json`。
不要手改 `design-system/dist/tokens.css`。
```

不要复制完整 token 表、不要创建平台专属规则文件、不要改写其他规则的优先级。

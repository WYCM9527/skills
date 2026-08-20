# 长期治理、普通 Agent 与试验

本 Steward 只在显式调用时负责审计、提案、建立、接入和 Guard。普通编码 Agent 的日常职责是消费已批准的设计系统，不是每次 UI 修改都重新运行 Steward。

## 先判断这次改动属于什么

| 改动 | 设计系统动作 |
| --- | --- |
| 文案、数据、图片内容、链接等非视觉决定 | 不更新设计系统。 |
| 复用已有颜色、间距、组件状态或 Theme／Scope 规则 | 阅读相关文档与 Token，直接消费，不新增规则。 |
| 新增或跨页面复用一个视觉决定 | 先提出 Token／Scope／Theme／组件例外提案；用户确认后先更新来源、构建、Guard，再实现页面。 |
| 修订已批准的视觉决定 | 先更新来源并评估影响，再构建、Guard 和改页面；不要只改一处 UI。 |
| 一次性、边界不清的差异 | 报告为 Drift 或在试验中验证；不自动变成 Token、Scope 或 Theme。 |

这条分类避免“每次改内容都改规范”，也避免真正的新视觉规则绕过设计系统。

需要辅助判断时，先只读运行：

```text
node scripts/plan-change.mjs --project /absolute/project/path --target src/Page.tsx [--scope core-or-id] [--theme theme-id] [--request '这次要做什么']
```

它只输出 `content`、`consume`、`needs-proposal` 或 `drift` 候选和下一步，不会推断 Token 语义或修改项目。提到现有 Token／Theme／Scope 或“复用”本身仍是消费，不应因此被误判成新规范。

## 可选的项目规则接入

Core 建立后，Steward 可以主动提出在一个现有 Agent 规则文件中加入短路径引用；**提出不等于获准写入**。写入前必须让用户确认准确规则文件、插入位置和这段文本与既有规则不冲突。若已有路径、优先级或内容矛盾，停止并让用户决定；不要覆盖或创建规则文件。

可使用不超过三行、语义等价的规则：

```md
UI 修改前先阅读 `design-system/DESIGN.md`，并按当前 Scope／Theme 读取其登记与文档；只消费已管理的设计决定。
需求新增、修订或跨页面复用视觉决定时，先提出提案；确认后先更新设计系统源、构建并运行 Guard，再实现页面。
不要手改 `design-system/dist/`；一次性差异先作为 Drift 或试验处理，不自动升级为规范。
```

规则只提供“何时读什么、何时回到 Steward”的入口，不能复制 Token 表、强行指定已有规则优先级或代替用户确认。

可先只读运行 `node scripts/plan-agent-rule.mjs --project /absolute/project/path`，查看已有规则文件和三行提案。它不会创建或修改任何规则文件；只有用户确认准确目标、插入位置和文本不冲突后，Agent 才能做最小写入。

## 试验与回滚

`experiment` 只在独立分支、demo 或可单独回滚的提交中使用，不授权改生产 UI。可复制下面的 Prompt：

```text
请只在 [试验范围] 验证本项目的设计系统，不修改生产页面。

先阅读 design-system/DESIGN.md；如有局部规范或 Theme，再读取其登记和文档。
只消费 Core、当前 Scope 祖先链和当前 Theme 中已经批准的 Token；不要手改 design-system/dist/，也不要新增未命名视觉值。
若现有 Token 不能表达需求，停止并提出提案；不要临时硬编码。

任务：[填写一个小范围组件或页面试验]
```

验收：范围是否可单独回滚、是否只使用已管理 Token、目标 Scope／Theme 是否生效、父级和同级页面是否不变、以及对比度、focus／error／disabled／loading 状态是否仍符合规则。失败时只回滚这次试验或最小接线；不要回滚已确认的 Token 真相源，除非用户重新确认设计决定本身。

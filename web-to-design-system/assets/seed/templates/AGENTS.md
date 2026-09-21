# {{PROJECT}} · Agent 规则

## 设计系统（design-system-steward 三行规则）

1. 所有 UI 修改先阅读 `design-system/DESIGN.md` 与当前 Scope／Theme 的登记和说明，只使用已管理的设计决定。
2. 若需求需要新增、修改或跨页面复用的视觉决定，先提出提案；确认后先更新设计系统源、构建并运行 Guard，再实现页面。
3. 不要手改 `design-system/dist/`；一次性差异先作为 Drift 或实验处理，不自动升级为规范。

## 项目接线（{{SYSTEM_NAME}} · {{STACK_LABEL}}）

{{STACK_NOTES}}
- **上游快照只读**：`design-systems/{{SYSTEM_ID}}/` 是设计系统的上游快照，永不手改（改了 `ds.mjs status` 会报警）；项目需要的差异写在自己的 `app.css` / 工作副本 `design-system/`（scope / 豁免），需要共享的向上游提提案。配方不够用时**不在页面上补样式**。
- **推断值先确认**：这套系统由网站实测提炼，`tokens/semantic.tokens.json` 里 `$description` 以 `[推断]` 开头的角色是按规则补的默认值——第一次用到该角色的页面前，先在 `design-system/AUDIT.md`「推断角色清单」里确认或改值，确认后把前缀改为 `[确认]`。
- **验收**：改完 UI 运行 `npm run build` 与 `{{ACCEPT_COMMAND}}`；`design-system-steward` 的 `guard.mjs --project $PWD` 应为 `current`。

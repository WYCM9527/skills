# Apply：经确认后建立 Core、Scope 或 Theme

`apply` 是登记和来源建立步骤，不是页面迁移器。它不会修改 UI、旧设计文档、Figma 或运行时切换代码。

## 建立 Core

开始前必须确认：

1. 准确的绝对项目根目录；
2. 冲突时选定的权威来源；
3. 可以创建 `design-system/`，以及本次将写入的准确 Token／文档／构建产物；
4. 只有已批准的少量 Token 种子会成为真相源，未经确认的审计候选不会被写入。

Bootstrap 不覆盖已有 `design-system/`、旧文档、`src/` 或页面。经用户确认后，Agent 再按目标项目已有的包管理链添加并锁定构建依赖、提供统一构建命令；脚本本身只建立设计系统产物。先验证 Token，再构建生成 CSS。

Core 是确认的默认 Theme，不会再复制一份默认模式到 `themes/`。

## 建立局部规范

`apply --scope <id>` 要在 Core 已存在后执行，并再次确认：

1. 项目根目录和 Scope ID；
2. `kind`（`section` 或 `page`）与现有父级；
3. 至少一个非空路由或源码 glob；
4. 设计理由、权威来源和允许创建 `scopes/<id>/`／更新 `scope-map.json`。

它只创建相对父级的文档、按需 Token 目录和唯一登记册；不加 `data-ds-scope`、不改 Layout、不导入 CSS。含 `*` 的 glob 必须加引号，避免 shell 先展开它。

## 建立 Theme

`apply --theme <id>` 只在已有 Theme 有静态证据，或用户明确要求新增 Theme 后进行。开始前必须确认：

1. 项目根目录、Theme ID、Core 代表的默认模式；
2. 权威映射来源，以及已有模式的选择器／运行时切换线索；
3. 一个受控的根级激活方式和其运行时所有者；不能接受任意手写 CSS selector；
4. 可以创建或更新 `theme-map.json`、`themes/<id>/` 和对应生成物；
5. 本次只纳管已批准的 Theme Semantic delta，以及已批准的 Component 例外。

它创建 Theme 登记与相对 Core 的文档／Token delta，不改旧 Theme CSS、不添加切换按钮、`localStorage`、provider 或 `prefers-color-scheme` 逻辑。没有 Theme 证据且用户未要求时，什么也不创建；用户要求新增时，先走 [theme.md](theme.md) 的提案，不从现有颜色自动反相生成 dark mode。

## 文档原则

- `DESIGN.md` 写 Core 的设计语言、Token 使用、布局、组件、交互和响应式规则；不重复色值或 px 值。
- `SCOPE.md` 只写相对父级的范围、理由、差异与 Do／Don't；不复制 Core。
- `THEME.md` 只写相对 Core 的模式意图、适用性和运行时约束；不重复 Token 值或 Scope 规则。
- `AUDIT.md` 保留证据、用户选择、未迁移项与风险；不删除旧规范。
- `TRY.md` 只用于可回滚试验，不授权直接改生产 UI。

Component Token 只用于明确、已批准且不能提升为通用 Semantic 的组件例外。Theme 与 Scope 不能因为目录都存在就自动相乘；Theme 的详细边界见 [theme.md](theme.md)。

# Apply：经确认后建立 Core 或局部规范

Apply 有两个相互独立的写入动作：首次建立 Core，以及随后建立某个局部规范。它们都不修改 UI。

## 建立 Core

只有用户明确确认以下三件事后，才可执行首次 Apply：

1. 精确的绝对项目根目录；
2. 发生冲突时选择的权威来源；
3. 可以创建该项目的 `design-system/` 目录。

安全顺序：

1. 将 `audit` JSON 证据保存到项目外的临时位置，或通过 `--audit-report` 传给 bootstrap。
2. 运行 bootstrap。它拒绝覆盖已有 `design-system/`，不修改 `src/`、页面、旧文档或现有 Token。
3. 只把用户确认过的少量 Token 写入 Core Primitive／Semantic 文件；不要把未经确认的候选值写成真相。
4. 根据目标项目已有锁文件判断 npm、pnpm、yarn 或 bun，并在同一次确认下添加精确版本的开发依赖 `style-dictionary@5.5.2`。
5. 向目标 `package.json` 添加一个统一构建命令，由检测到的包管理器执行；不要求用户自行选择构建工具。
6. 每次构建前验证 Token，再运行构建命令。首次成功后才出现 `design-system/dist/tokens.css` 和 `dist/index.css`。

## 建立局部规范

`apply --scope <id>` 只能在 Core 已存在后运行。先确认以下内容：

1. 精确的绝对项目根目录；
2. Scope ID 与 `kind`（`section` 或 `page`）；
3. 现有父级（`core` 或已登记 Scope）；
4. 至少一个非空路由 glob 或源码 glob；
5. 设计理由与选定权威来源；
6. 可以创建 `scopes/<id>/` 并更新 `scope-map.json`。

运行：

```text
node scripts/scaffold-scope.mjs \
  --project <absolute-project-root> \
  --scope <id> \
  --kind <section|page> \
  --parent <core-or-scope-id> \
  --reason <confirmed-reason> \
  [--routes <comma-separated-route-globs>] \
  [--source-globs <comma-separated-source-globs>] \
  [--status <active|reference-only>]
```

该命令必须拒绝覆盖现有 Scope、缺失父级、循环关系、同级范围重叠和不合格的 ID。它只创建局部文档、按需 Token 目录并更新登记册；不加 `data-ds-scope`、不改 Layout、不导入 CSS、也不替用户决定局部 Token。

命令参数中的 glob 要加引号，例如 `--source-globs 'src/showcase/**'`；否则 shell 可能在脚本运行前展开 `*`。

## 文档原则

- `DESIGN.md` 写 Core 的视觉语言、布局、交互、响应式、Token 使用规则和 Do/Don't；不要再次列色值或 px 值。
- `SCOPE.md` 只写该 Scope 相对父级的设计理由、边界、特殊规则和 Do/Don't；不要复制 `DESIGN.md` 或具体值。
- `AUDIT.md` 写证据位置、用户选择、未迁移项和已知风险；不删除旧规范。
- `TRY.md` 用于后续中文 Prompt 驱动的局部试验，不直接接入现有页面。

## Theme 与 Component Token

仅当审计发现既有 Theme 的静态证据、且用户确认映射时，创建 `themes/`。不因为“设计系统通常有 dark mode”而发明一个 Theme，也不自动创造 Scope × Theme 组合。

仅当组件有明确、已批准、不该提升为通用 Semantic Token 的例外时，才创建 Component Token。局部 Scope 的 Component 覆写同样需要这个批准；否则应修改父级 Semantic 或停下讨论。

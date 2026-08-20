# Apply：经确认后建立基础系统

只有用户明确确认以下三件事后，才可执行 Apply：

1. 精确的绝对项目根目录；
2. 发生冲突时选择的权威来源；
3. 可以创建该项目的 `design-system/` 目录。

## 安全顺序

1. 保存 `audit` 的 JSON 证据到项目外的临时位置，或以 `--audit-report` 传给 bootstrap。
2. 运行 bootstrap。它拒绝覆盖已有 `design-system/`，不修改 `src/`、页面、旧文档或现有 token。
3. 将用户确认过的少量 token 写入 Primitive/Semantic 文件；不要把未经确认的候选值写成真相。
4. 根据目标项目已有锁文件判断 npm、pnpm、yarn 或 bun，并在同一次确认下添加精确版本的开发依赖：`style-dictionary@5.5.2`。
5. 向目标 `package.json` 添加一个统一构建命令：

   ```text
   style-dictionary build --config design-system/style-dictionary.config.mjs
   ```

   由检测到的包管理器执行它；不要求用户挑选构建工具。
6. 先运行 `validate-tokens.mjs`，再运行构建命令。构建成功后 `design-system/dist/tokens.css` 才出现。

## 文档原则

- `DESIGN.md` 写设计语言、布局、交互、响应式、Token 使用规则和 Do/Don't；不要再次列色值或 px 值。
- `AUDIT.md` 写证据位置、用户选择、未迁移项和已知风险；不删除旧规范。
- `TRY.md` 用于后续中文 Prompt 驱动的试验，不直接接入现有页面。

## 主题与 Component Token

仅当审计发现既有主题的静态证据、且用户确认映射时，创建 `themes/`。不因为“设计系统通常有 dark mode”而发明一个主题。

仅当一个组件有明确、已批准、不该提升为通用 Semantic token 的例外时，带 `--with-components` 创建 `components.tokens.json`。

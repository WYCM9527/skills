# Theme：同一界面的受控模式

Theme 回答“同一界面在什么模式下使用哪组已确认的语义值”，例如 light／dark。它不是第四层 Token，也不是 Scope：Scope 是页面边界，Theme 是同一界面的模式。

## 目录与来源

Core Token 是用户确认的默认 Theme，不再复制到 `themes/<default>/`。只有相对 Core 的已确认 delta 才进入 Theme：

```text
design-system/
├── tokens/                         # Core = 默认 Theme
├── theme-map.json                  # 唯一 Theme 登记册
├── themes/
│   └── dark/
│       ├── THEME.md
│       └── tokens/
└── dist/themes/dark.css            # 构建生成物
```

`theme-map.json` 登记默认模式、每个 Theme ID、受控的根级激活方式、来源、运行时所有者和状态。不要把任意 CSS selector 当作可执行配置，也不要在多个文件重复登记主题。

Theme Token 优先覆写 Core Semantic alias；Component delta 仅限已经批准的例外。不要覆写 Core Primitive，也不要用 Theme 目录偷偷复制整套 Core。

## 先判断是哪一种需求

| 现状 | 应做什么 |
| --- | --- |
| 已有亮／暗模式 | Audit 只收集静态 selector、模式名和文件证据；默认模式、运行时所有者与来源仍由人确认。Propose 后才映射，不改旧 UI。 |
| 没有 Theme，用户没有要求 | 不创建 `themes/`，不凭空造 dark mode。 |
| 没有 Theme，用户明确要新增 | 先提案确认模式、默认值、激活方式、运行时所有者、语义映射和验收；不能从当前色值自动反相。 |
| Scope 有局部差异 | 仍是 Scope；若覆写值随 Theme 变化，停下要求人决定，当前版本不自动生成 Scope × Theme delta。 |

## `apply --theme <id>` 的确认

在写入前，用户必须明确确认：

1. 绝对项目根目录与 Theme ID；
2. Core 默认模式是什么；
3. 已有 Theme 的权威来源，或新增 Theme 的已批准设计提案；
4. 受控的根级激活方式与其运行时所有者；
5. 可创建／更新 `theme-map.json`、`themes/<id>/` 和构建输出；
6. 仅哪些 Semantic delta 与 Component 例外会进入系统。

Apply 只创建登记、文档和 Token delta。它不重写 legacy Theme CSS，也不创建切换控件、持久化、provider 或系统偏好逻辑。

## 构建与 `integrate --theme <id>`

构建器需要完整字典来解析 alias，但 `dist/themes/<id>.css` 只输出该 Theme 的 delta；`dist/index.css` 按受控顺序聚合生成 CSS。不要手改任一生成物。

`integrate --theme <id>` 必须先给只读预览，列出 Theme 根级选择器、生成 CSS、唯一入口和影响范围。用户第二次确认该确切入口后，才可做最小接线。没有明确运行时所有者、存在冲突选择器或会影响未登记页面时停止。

## 验收与边界

验证已登记模式的默认值、切换行为（若项目已有）、对比度、focus／error／disabled／loading 状态及父级页面。确认目标 Theme 生效后，再检查 Scope 不会被错误覆盖；遇到 Scope × Theme 需求，回到提案而不是叠加猜测性 CSS。

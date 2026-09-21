# {{NAME}} 设计系统

> 本文件记录设计意图与使用规则。对已确认纳管的设计决定，具体视觉数值的唯一来源是 `tokens/*.tokens.json`；不要在这里重复色值、尺寸或阴影参数。未迁移的旧规范仅作为审计证据，不与 Token 双重维护。
>
> 来源：从 {{SOURCES}} 实测提炼（{{DATE}}），证据、推断与缺口见 `AUDIT.md`。写着「待填写」的段落必须由人或 Agent 依据证据补齐或删除，不能留到接入。

## 先读这里（编码 Agent 速查）

做页面时只需要这一屏 + 下面的「组件配方」表；其余章节是规则的理由，遇到配方没覆盖的情况再读。

1. 待填写：品牌色只做什么（主按钮 / 进度 / 指示条 / 链接？），不做什么（选中态？大面积底？文字？）。一句话写清「品牌色出现的地方就是该被注意的地方」还是「品牌色随处可见」。
2. 待填写：选中、当前、强调用什么表达（品牌色 / 反转块 / 边线）。
3. 状态色只做「文字 + 同色浅底」胶囊（`color.status.*` / `*-bg`）；实底按钮只有主（`color.action.primary`）与危险（`color.action.danger` + `color.text.on-danger`）。
4. 待填写：链接怎么识别（色相 / 下划线 / 字重），内容型与操作型链接是否分开。
5. 尺寸只从 token 拿：控件高 `control.height.*`，间距 `space.* / spacing.*`，圆角 `radius.*` 按容器层级递减，字号走 `text.*.size` 阶梯；不在阶梯之外取值。
6. 待填写：字重归属（正文 / 标签 / 强调 / 大字各用哪一档）。
7. 禁用 = `opacity.disabled`；只读 = `color.bg.readonly`；加载 = 骨架屏 `color.bg.skeleton*`，不用禁用态假装。
8. 图标类控件必须有 `aria-label`、命中区 ≥ `control.hit-min`；所有颜色和尺寸都必须能在 `dist/tokens.css` 里找到名字。
9. 改完跑 steward `guard`（构建与登记一致）和 `status`（页面字面量清零）。

## 视觉语言

- 待填写：品牌色的角色与面积（引用 `color.action.primary` / `color.brand.indicator` / `color.bg.brand` 等角色名，不写 hex）。
- 待填写：中性色的调性（冷灰 / 暖灰 / 纯灰）与层次手段（边线 / 阴影 / 底色差）。
- 待填写：文字色三档（`color.text.primary / secondary / muted`）的用途边界与占位符（`color.text.placeholder`）的适用范围。
- 待填写：字体栈（`font.family.body`）、根字号（`text.body.size`）、字号阶梯有几档、最小字号。
- 待填写：状态色的色相归属（success / warning / error / info 各是哪一族）以及与品牌色如何靠色相分开。

## 设计原则

- 优先复用已批准的 Semantic token。
- 需要新值时先提出 token 提案，不在组件里临时硬编码。
- Component token 只用于经确认的组件例外。

## Token 使用规则

- Primitive token 表示值本身（`color.<族>.<明度档>`、`spacing.<px/4>`、`font.size.*`…）。
- Semantic token 表示用途（`color.action.primary`、`text.body.size`、`elevation.card.*`…），页面只引用用途名。
- `$description` 以 `[观察]` 开头的是实测证据，以 `[推断]` 开头的是提炼时按规则补的默认值——接入项目前逐条确认，确认后把前缀改为 `[确认]`。
- `dist/tokens.css` 是生成物，禁止手改。

## 局部规范／生效范围

- Core 规范默认作用于整个项目；局部差异必须登记在 `scope-map.json`，不能靠零散选择器或目录名称猜测。
- Scope 只记录相对父级的差异；页面需要完整的 `data-ds-scope` 继承链才会消费对应的运行时 CSS。
- Theme、单个组件例外和未登记硬编码分别按 Theme、Component Token、Drift 管理，不把它们误建成 Scope。

## Theme

- Core 默认作用于确认的默认 Theme；已有或经确认新增的模式登记在 `theme-map.json`，其相对 Core 的差异位于 `themes/<id>/`。
- Theme 只覆写已批准的 Semantic token 和 Component 例外；不复制 Core，也不手写任意选择器。
- Scope 与 Theme 不自动组合。局部覆写遇到随 Theme 变化的 Semantic 时，先提出提案并等待确认。
{{THEME_NOTE}}

## 布局与响应式

- 待填写：页面骨架（顶栏 `layout.topbar.height` / 侧栏 `layout.sidebar.width` / 居中容器 `layout.container.max-width`），哪些是 sticky。
- 间距走 4px 基础阶梯（`spacing.*`），页面级留白用四个语义间距：`space.gutter`（内容区四周）、`space.stack`（块与块之间）、`space.card`（卡片 / 弹窗内边距）、`space.inline`（同一行相邻元素）。
- 待填写：圆角有几档、按容器层级怎么递减（外层容器 → 卡片 → 控件 → 标签 → 勾选框），胶囊与圆形一律 `radius.full`。
- 层级只有四档：`layer.sticky`、`layer.dropdown`、`layer.modal`、`layer.toast`；不手写 z-index 数字。
- 待填写：断点（`layout.breakpoint.mobile` / `narrow`）与各档的布局变化（导航折叠 / 网格列数 / 留白收敛）。CSS 媒体查询无法引用 var()，配方里的断点数值是 token 的字面镜像，改 token 必须同步。

## 组件原则

- 按钮、输入框共用同一控件高度（`control.height.md`），小号用 `control.height.sm`，大号只给页面级唯一主操作与触屏。
- 待填写：按钮的层级（主 / 次要 / 文字按钮 / 危险）各用哪些角色，hover / active 怎么反馈（换填充 `color.action.primary-hover` / 换边线 / 换底 `color.bg.hover`）。
- 待填写：卡片的分层手段——边线（`color.border.default`）+ 阴影（`elevation.card.*`）还是只用其一。
- 阴影写法固定：`box-shadow: 0 var(--elevation-<层>-y) var(--elevation-<层>-blur) var(--elevation-<层>-color)`，三层 `card` / `popover` / `modal`。
- 浮层三件：`color.bg.elevated`（浮层表面）、`color.bg.overlay`（遮罩）、`color.bg.inverse` + `color.text.inverse`（Tooltip / 深色 Toast）。
- 状态色是文字色不是填充色：徽标 / 提示条 = `color.status.<x>` + `color.status.<x>-bg`。
- 待填写：图标库（`icon.library`）、尺寸档（`icon.size.*`）、描边（`icon.stroke.width`）、颜色角色（`color.icon.*`）。

## 组件配方

给普通编码 Agent 的速查表：每个组件用哪些 Token。行里写「待确认」的是本次提炼没有证据、按角色词表默认填的，接入前逐行核对。

| 组件 | 底 | 文字 | 边线 / 其他 |
| --- | --- | --- | --- |
| 主按钮 | `color.action.primary` / `-hover` / `-active` | `color.text.on-primary` | 高度 `control.height.md`，圆角 待填写 |
| 次要按钮 | `color.bg.surface`，hover `color.action.secondary-hover` | `color.text.primary` | `color.border.strong` |
| 文字按钮（quiet） | 待确认：`color.action.quiet` / `-hover` | `color.text.link` | 无边线 |
| 危险按钮 | `color.action.danger` / `-hover` / `-active` | `color.text.on-danger` | — |
| 禁用态（任何控件） | 不换色 | 不换色 | `opacity.disabled` |
| 链接 | — | `color.text.link`，hover `color.text.link-hover` | 待填写：下划线 / 字重 |
| 输入框 | `color.bg.input` | `color.text.primary`，占位符 `color.text.placeholder` | `color.border.input`；聚焦 `color.border.focus` + `color.focus.ring` × `focus.ring.width` |
| 卡片 | `color.bg.surface` | — | `color.border.default`，圆角 待填写，`elevation.card.*`，内边距 `space.card` |
| 表格 | 表头 `color.bg.subtle`；行 hover `color.bg.hover` | 表头 `color.text.secondary`，副行 `color.text.muted` | 行分隔 `color.border.default`；单元格内边距 待确认 `table.cell.padding-*` |
| 徽标 / 提示条 | `color.status.<x>-bg` | `color.status.<x>` | 徽标 `radius.full`，提示条 待填写 |
| 下拉菜单 | `color.bg.elevated`；项 hover `color.bg.hover` | `color.text.primary`；危险项 `color.text.danger` | `color.border.default`，`elevation.popover.*`，`layer.dropdown` |
| 弹窗 | 遮罩 `color.bg.overlay`；面板 `color.bg.elevated` | `color.text.primary` / `secondary` | `elevation.modal.*`，`layer.modal`，进出 `motion.duration.slow` |
| Tooltip / 深色 Toast | `color.bg.inverse` | `color.text.inverse` | `layer.toast` |
| 标签页 | — | 默认 `color.text.secondary`，选中 `color.text.primary` | 选中下划线 待确认 `color.border.current` × `border.width.active` |
| 分页 | 当前页 待确认 | 待确认 | `control.height.sm` |

## 交互与无障碍

- 动效三档：即时反馈用 `motion.duration.fast` + `motion.easing.standard`；浮层出现用 `motion.duration.normal`；弹窗 / 抽屉用 `motion.duration.slow`。系统开启「减少动态效果」时所有时长视为 0。
- 焦点必须可见：焦点环用 `color.focus.ring` × `focus.ring.width`，输入框聚焦同时把边线换成 `color.border.focus`。
- 禁用态用 `opacity.disabled` 统一表达，不另造一套灰。
- 图标类控件必须有可访问名称，命中区不小于 `control.hit-min`。
- 对比度底线见「验收基线」，检查时连底色一起算。

## 验收基线

- **对比度**：正文与 12px 小字 ≥ 4.5:1，大字（≥ 24px 或 ≥ 18.66px 加粗）与图标 ≥ 3:1，连底色一起算；亮 / 暗两种模式都要过。`check-contrast.mjs` 的报告见 `AUDIT.md`。
- **已批准的例外**：待填写（从 `AUDIT.md` 的对比度报告里把用户拍板保留的低对比配对逐条列出，写明回补路径）。
- **可访问名称**：所有按钮、链接、菜单项有名称；图片有 alt。
- **溢出与截断**：任何模式、任何页面无横向溢出；nowrap 文字无截断。
- **键盘焦点**：Tab 遍历每个可聚焦元素都有可见焦点环。
- **构建一致性**：steward `validate-system` / `build-tokens` / `guard` 三绿。

## Do / Don't

- Do：在实现前说明所选 Semantic token 表达的意图。
- Don't：为了赶工新增未命名的色值、间距、圆角或字体尺寸。
- Don't：把日常文案、数据或图片内容更新当作设计系统变更。
- Do：新增、跨页面复用或修订视觉决定前，先提出 Token／Scope／Theme／组件例外提案。
- 待填写：本系统特有的两三条 Don't（例如「hover 不出现品牌色」「白底不放品牌色文字」这类从证据里读出来的纪律）。

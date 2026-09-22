# {{NAME}} 设计系统

> 本文件记录设计意图与使用规则。对已确认纳管的设计决定，具体视觉数值的唯一来源是 `tokens/*.tokens.json`；不要在这里重复色值、尺寸或阴影参数。未迁移的旧规范仅作为审计证据，不与 Token 双重维护。
>
> 来源：从 {{SOURCES}} 实测提炼（{{DATE}}），证据、推断与缺口见 `AUDIT.md`。写着「待填写」的段落必须由人或 Agent 依据证据补齐或删除，不能留到接入。
>
> 适用类型：**{{PROFILE_LABEL}}**——{{PROFILE_ZH}}。词表里其他类型才有的角色（见 `AUDIT.md`「可选角色」）本系统不发明值；需要时先走提案。

## 先读这里（编码 Agent 速查）

做页面时只需要这一屏 + 下面的「组件配方」表；其余章节是规则的理由，遇到配方没覆盖的情况再读。

{{QUICK_RULES}}

## 视觉语言

{{VISUAL_RULES}}

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
- Scope 与 Theme 不自动组合。局部覆写遇到随 Theme 变化的 Semantic 时，先提出提案，经用户确认后再改。
{{THEME_NOTE}}

## 布局与响应式

- 待填写：页面骨架（顶栏 `layout.topbar.height` / 居中容器 `layout.container.max-width`{{LAYOUT_SHELL}}），哪些是 sticky。
- 间距走 `spacing.*` 阶梯（px 系统按 4px 命名，rem 系统按 rem×100 命名），页面级留白用四个语义间距：`space.gutter`（内容区四周）、`space.stack`（块与块之间）、`space.card`（卡片 / 弹窗内边距）、`space.inline`（同一行相邻元素）。
- 待填写：圆角有几档、按容器层级怎么递减（外层容器 → 卡片 → 控件 → 标签 → 勾选框），胶囊与圆形一律 `radius.full`。
- 层级最多四档：`layer.sticky`、`layer.dropdown`、`layer.modal`、`layer.toast`，用到哪档写哪档；不手写 z-index 数字。
- 待填写：断点（`layout.breakpoint.mobile` / `narrow`）与各档的布局变化（导航折叠 / 网格列数 / 留白收敛）。CSS 媒体查询无法引用 var()，配方里的断点数值是 token 的字面镜像，改 token 必须同步。

## 组件原则

{{COMPONENT_RULES}}

## 组件配方

给普通编码 Agent 的速查表：每个组件用哪些 Token。行里写「待确认」的是本次提炼没有证据、按角色词表默认填的，接入前逐行核对；本系统没有的组件整行删掉。

{{RECIPES}}

## 交互与无障碍

- 动效三档：即时反馈用 `motion.duration.fast` + `motion.easing.standard`；浮层出现用 `motion.duration.normal`；弹窗 / 抽屉用 `motion.duration.slow`。系统开启「减少动态效果」时所有时长视为 0。
- 焦点必须可见：焦点环用 `color.focus.ring` × `focus.ring.width`，输入框聚焦同时把边线换成 `color.border.focus`。
{{A11Y_EXTRA}}- 图标类控件必须有可访问名称，命中区不小于 `control.hit-min`。
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

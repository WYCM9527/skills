# 语义角色词表

Semantic 层的用途名。与 Citrine 种子的 `semantic.tokens.json` 对齐：同一个名字在任何按本规范提炼的系统里都指同一种用途，值不同、名字不变——这样桥接（`bridge/element-plus.css` 这类逐组件接管）、配方（`recipes.css`）、迁移角色表（`migration/roles.json`）以后才能跨系统复用。机器可读版是 `scripts/lib/roles.mjs`（draft-tokens 用它列缺口、check-contrast 用它配对、render-token-board 用它分组）；改一处要同步另一处。

共 160 个角色，分三层；哪些「必须处理」由**系统类型**决定（`scripts/lib/roles.mjs` 的 `PROFILES` / `requiredRoles` / `inferableRoles`）：

| 系统类型 | 说明 | 必须处理 | 组件库桥接 |
| --- | --- | --- | --- |
| `brand` 品牌 / 内容站 | 官网、活动页、作品集、博客、文档站：以读和看为主，交互只有导航、链接、CTA 与少量表单 | core 去掉产品专属的 24 个 = 55 | 不需要（纯 CSS 接入） |
| `product` 产品 UI | 面向用户的应用 / SaaS 前台：表单、列表、弹窗、状态反馈齐全，没有后台壳层 | core 79 | 可选 |
| `admin` 中后台 | 侧栏 + 表格 + 图表 + 弹窗尺寸的工作台 | core + shell = 107 | 建议 |

- **core（79）**：产品 UI 的基础集合。其中状态色 ×10、危险色 ×5、输入框三件（`bg.input` / `border.input` / `text.placeholder`）、`bg.elevated`、`control.height.sm / lg`、`layer.dropdown / toast`、`opacity.disabled` 是产品专属，品牌 / 内容站不必处理。
- **extended（53）**：有证据再填；选中态、骨架屏、大字等多见于产品 / 中后台。品牌 / 内容站允许按规则推断的只有品牌面 / 大字 / 链接装饰 / 浮层阴影 / 缓动。
- **shell（28）**：中后台壳层（侧栏、表格、图表、涨跌、弹窗尺寸），只有 `admin` 类型才必须处理。

角色名以外的 Semantic 也允许（站点有独特用途时），但先问自己能不能落到已有角色；新名字进 AUDIT「风险与待确认」。

## 几条命名纪律（从 Citrine 带过来）

- **填充与文字分开**：`color.action.danger`（红底）与 `color.text.danger`（红字）是两个角色——暗色下填充保持深红、文字要换亮红，合成一个就会有一个模式读不清。`status.*` 是文字色，`status.*-bg` 是浅底；实底按钮只有 primary 与 danger。
- **同值不同名**：`color.bg.brand`（大面积品牌面）与 `color.action.primary`（按钮）今天同值也要分开登记——以后品牌面想换更浅的色不该牵连按钮。`bg.surface` 与 `bg.input` / `bg.elevated` 同理（一个白在新系统里是三个语义）。
- **选中不等于品牌**：`color.action.selected` / `bg.selected*` / `text.on-selected` 是独立角色。Citrine 用深黑反转块表达选中、黄色只表达主操作；提炼别的站点时按证据填（很多站点选中就是品牌色浅调），但名字不变。
- **语义间距只有四个**：`space.inline / stack / gutter / card`，页面级留白只从这四个拿；`spacing.*` 阶梯给控件内部。
- **阴影三层**：`elevation.card / popover / modal`，每层 `y / blur / color` 三件。
- **层级四档**：`layer.sticky / dropdown / modal / toast`，不手写 z-index。

## 角色表

### 底色（`bg`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `color.bg.page` | color | core | 页面底 | body / html 背景色 | 是 |
| `color.bg.surface` | color | core | 卡片 / 面板表面 | 卡片、区块最常见的背景色（亮色站通常是白） | 是 |
| `color.bg.subtle` | color | core | 浅分区底 | 表头、分区、次级容器的浅底，比 surface 深一档 | 是 |
| `color.bg.hover` | color | core | 悬停底 | 导航项 / 次要按钮 hover 后的底色（悬停探针） | 是 |
| `color.bg.input` | color | core | 输入框底 | input / textarea / select 背景色 | 是 |
| `color.bg.elevated` | color | core | 浮层表面 | 下拉、弹窗表面；暗色下要比 surface 亮一档 | 是 |
| `color.bg.overlay` | color | core | 弹窗遮罩 | 覆盖全页的半透明深色底 | 是 |
| `color.bg.inverse` | color | core | 反色底 | Tooltip / 深色 Toast / 深色页脚的底 | 是 |
| `color.bg.selected` | color | extended | 选中底（小面积） | 筹码、批量条、当前导航项的底 | 是 |
| `color.bg.selected-subtle` | color | extended | 选中底（大面积） | 表格选中行、列表选中项 | 是 |
| `color.bg.selected-hover` | color | extended | 选中 + 悬停 | 已选中项再被悬停 | 是 |
| `color.bg.brand` | color | extended | 大面积品牌面 | 登录页品牌区、欢迎横幅 | 否 |
| `color.bg.skeleton` | color | extended | 骨架屏底 | 加载占位块 | 是 |
| `color.bg.skeleton-highlight` | color | extended | 骨架屏流光 | 骨架屏高亮扫过的颜色 | 是 |
| `color.bg.readonly` | color | extended | 只读字段底 | 可读不可改的字段 | 是 |
| `color.bg.mask` | color | extended | 局部加载遮罩 | 盖在一块卡片 / 表格上的半透明底 | 是 |
| `color.bg.sidebar` | color | shell | 侧栏底 | 中后台侧栏背景 | 是 |
| `color.bg.sidebar-hover` | color | shell | 侧栏项悬停 | — | 是 |
| `color.bg.sidebar-selected` | color | shell | 侧栏当前项 | — | 是 |

### 文字（`text`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `color.text.primary` | color | core | 正文 / 标题 | 承载最多文字量的深色文字 | 是 |
| `color.text.secondary` | color | core | 次要文字 | 说明、副标题，比正文浅一档 | 是 |
| `color.text.muted` | color | core | 弱化文字 | 帮助文字、时间戳；仍需 ≥ 4.5:1 | 是 |
| `color.text.placeholder` | color | core | 占位符 | input::placeholder 的颜色 | 是 |
| `color.text.inverse` | color | core | 反色文字 | 落在 bg.inverse / 深底上的文字 | 是 |
| `color.text.on-primary` | color | core | 主按钮文字 | 主按钮上的文字色 | 否 |
| `color.text.on-danger` | color | core | 危险按钮文字 | — | 否 |
| `color.text.link` | color | core | 内容型链接 | 正文 / 表格里的 a 颜色 | 是 |
| `color.text.link-hover` | color | core | 链接悬停 | 悬停探针里 a 的 color 变化 | 是 |
| `color.text.danger` | color | core | 危险文字 | 删除项、危险链接（暗色下要比填充色亮） | 是 |
| `color.text.brand` | color | extended | 品牌大字 | 只允许 ≥ 20px 的展示性文字用品牌色 | 是 |
| `color.text.selected` | color | extended | 选中文字 | 排序激活、当前项文字 | 是 |
| `color.text.on-selected` | color | extended | 选中块上的文字 | 落在 action.selected 上的文字 | 是 |
| `color.text.on-brand` | color | extended | 品牌面上的文字 | 落在 bg.brand 上的文字 | 否 |
| `color.text.sidebar` | color | shell | 侧栏文字 | — | 是 |
| `color.text.sidebar-strong` | color | shell | 侧栏强调文字 | — | 是 |
| `color.text.sidebar-muted` | color | shell | 侧栏弱化文字 | — | 是 |
| `color.text.sidebar-selected` | color | shell | 侧栏当前项文字 | — | 是 |

### 操作面（`action`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `color.action.primary` | color | core | 主按钮填充 | 最显眼的彩色按钮背景 | 否 |
| `color.action.primary-hover` | color | core | 主按钮悬停 | 悬停探针；无证据时同色系深一档 | 否 |
| `color.action.primary-active` | color | core | 主按钮按下 | 同 hover 或再深一档 | 否 |
| `color.action.secondary-hover` | color | core | 次要按钮悬停底 | 描边按钮 hover 的底 | 是 |
| `color.action.danger` | color | core | 危险按钮填充 | 红色实底按钮；亮暗都保持深红 | 否 |
| `color.action.danger-hover` | color | core | 危险按钮悬停 | — | 否 |
| `color.action.danger-active` | color | core | 危险按钮按下 | — | 否 |
| `color.action.selected` | color | extended | 选中态填充 | 分段选择器 / 视图切换当前项的底（Citrine 用深黑反转，不用品牌色） | 是 |
| `color.action.quiet` | color | extended | 文字按钮静息底 | quiet 按钮的浅底 | 是 |
| `color.action.quiet-hover` | color | extended | 文字按钮悬停底 | — | 是 |

### 边线（`border`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `color.border.default` | color | core | 普通边线 | 出现最多的 border-color | 是 |
| `color.border.strong` | color | core | 实边线 | 比 default 深一档：勾选框、上传虚线 | 是 |
| `color.border.input` | color | core | 输入框边线 | input 的 border-color | 是 |
| `color.border.focus` | color | core | 焦点边线 | 焦点探针 / :focus-visible 规则里的边线或 outline 色 | 是 |
| `color.border.current` | color | extended | 当前指示线 | 标签页下划线等 | 是 |
| `color.border.sidebar` | color | shell | 侧栏边线 | — | 是 |
| `border.width.default` | dimension | core | 普通边线宽 | 最常见的 border-width | 否 |
| `border.width.control` | dimension | extended | 小控件边线宽 | — | 否 |
| `border.width.active` | dimension | extended | 选中下划线 / 焦点外框宽 | — | 否 |
| `border.width.indicator` | dimension | shell | 指示条宽 | — | 否 |

### 焦点（`focus`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `color.focus.ring` | color | core | 焦点环颜色 | focus 时 box-shadow / outline 的颜色（常带透明度） | 是 |
| `focus.ring.width` | dimension | core | 焦点环粗细 | focus 时 box-shadow spread 或 outline-width | 否 |

### 状态（`status`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `color.status.success` | color | core | 成功文字色 | 根变量 --success / 徽标类名 success | 是 |
| `color.status.success-bg` | color | core | 成功浅底 | — | 是 |
| `color.status.warning` | color | core | 警示文字色 | 橙 / 黄族；与品牌色靠色相分开 | 是 |
| `color.status.warning-bg` | color | core | 警示浅底 | — | 是 |
| `color.status.error` | color | core | 错误文字色 | 红族 | 是 |
| `color.status.error-bg` | color | core | 错误浅底 | — | 是 |
| `color.status.info` | color | core | 信息文字色 | 蓝 / 青族 | 是 |
| `color.status.info-bg` | color | core | 信息浅底 | — | 是 |
| `color.status.neutral` | color | core | 中性状态文字色 | 草稿 / 已停用 | 是 |
| `color.status.neutral-bg` | color | core | 中性状态浅底 | — | 是 |

### 品牌（`brand`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `color.brand.indicator` | color | extended | 品牌指示条 | 侧栏当前项左侧竖条、数据卡左描边 | 否 |

### 图标（`icon`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `color.icon.default` | color | core | 独立图标默认色 | 工具栏 / 表格操作图标；≥ 3:1 | 是 |
| `color.icon.muted` | color | core | 装饰性图标 | — | 是 |
| `color.icon.brand` | color | extended | 品牌插图描边 | two-tone 图标描边 | 是 |
| `color.icon.two-tone` | color | extended | 品牌插图填充 | — | 否 |

### 控件（`control`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `color.control.knob` | color | extended | 开关滑块 | 亮暗都保持白 | 否 |
| `control.height.sm` | dimension | core | 小控件高 | 小按钮、分页项 | 否 |
| `control.height.md` | dimension | core | 默认控件高 | 按钮、输入框共用 | 否 |
| `control.height.lg` | dimension | core | 大控件高 | 登录按钮、触屏 | 否 |
| `control.height.xs` | dimension | extended | 行内胶囊高 | 操作胶囊、状态胶囊 | 否 |
| `control.hit-min` | dimension | extended | 图标控件最小命中区 | ≥ 24px | 否 |
| `icon.size.xs` | dimension | extended | 图标 xs | — | 否 |
| `icon.size.sm` | dimension | extended | 图标 sm | — | 否 |
| `icon.size.md` | dimension | core | 图标默认尺寸 | 出现最多的 svg 边长 | 否 |
| `icon.size.lg` | dimension | extended | 图标 lg | — | 否 |
| `icon.size.xl` | dimension | extended | 图标 xl | — | 否 |
| `icon.library` | string | extended | 图标库 | lucide / IconPark / … | 否 |
| `icon.stroke.width` | number | extended | 图标描边 | svg stroke-width | 否 |

### 图表（`chart`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `color.chart.1` | color | shell | 分类色 1 | 品牌色领衔；shadcn 站点看根变量 --chart-1…5 | 是 |
| `color.chart.2` | color | shell | 分类色 2 | — | 是 |
| `color.chart.3` | color | shell | 分类色 3 | — | 是 |
| `color.chart.4` | color | shell | 分类色 4 | — | 是 |
| `color.chart.5` | color | shell | 分类色 5 | — | 是 |
| `color.chart.6` | color | shell | 分类色 6 | — | 是 |
| `color.chart.area` | color | shell | 面积填充 | 半透明，网格线要透得出来 | 否 |

### 数据（`data`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `color.data.increase` | color | shell | 涨 | 公司约定：涨绿跌红或红涨绿跌，只改这两个别名 | 是 |
| `color.data.decrease` | color | shell | 跌 | — | 是 |
| `color.data.inactive` | color | shell | 非进行中的数据填充 | 已结束的进度条 | 是 |

### 留白（`space`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `space.inline` | dimension | core | 行内相邻元素间距 | 最常见的小 gap（≤ 12px） | 否 |
| `space.stack` | dimension | core | 块与块的纵向间距 | 卡片之间 / 网格 gap（12～32px） | 否 |
| `space.gutter` | dimension | core | 内容区四周留白 | section / 容器的左右 padding | 否 |
| `space.card` | dimension | core | 卡片内边距 | 卡片 / 弹窗 / 抽屉的 padding | 否 |

### 字体（`font`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `font.family.body` | fontFamily | core | 正文字体栈 | body 的 font-family | 否 |
| `font.family.code` | fontFamily | extended | 等宽字体栈 | code / pre / 单号 | 否 |
| `font.family.heading` | fontFamily | extended | 标题字体栈 | 标题字体与正文不同时才有 | 否 |

### 字号阶梯（`typography`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `text.caption.size` | dimension | core | 最小字号 | 国内中后台下限 12px | 否 |
| `text.small.size` | dimension | core | 小字 | — | 否 |
| `text.body-sm.size` | dimension | core | 小正文 | — | 否 |
| `text.body.size` | dimension | core | 正文 | 承载最多文字量的字号 | 否 |
| `text.body.line-height` | number | core | 正文行高 | — | 否 |
| `text.title-sm.size` | dimension | core | 小标题 | — | 否 |
| `text.title.size` | dimension | core | 标题 | — | 否 |
| `text.heading.size` | dimension | core | 页头标题 | h2 一级 | 否 |
| `text.heading.line-height` | number | core | 标题行高 | 紧行高 | 否 |
| `text.display.size` | dimension | extended | 数据大字 / 展示字号 | h1 / 统计数字 | 否 |
| `text.display.weight` | fontWeight | extended | 数据大字字重 | — | 否 |
| `text.display.line-height` | number | extended | 数据大字行高 | — | 否 |
| `text.display.tracking` | dimension | extended | 数据大字字距 | 负字距 | 否 |
| `text.hero.size` | dimension | extended | 结果页 / 登录页大字 | — | 否 |
| `text.hero.line-height` | number | extended | 大字行高 | — | 否 |
| `text.paragraph.line-height` | number | extended | 成段说明行高 | — | 否 |
| `text.weight.label` | fontWeight | core | 标签类字重 | 按钮 / 表头 / 表单标签 | 否 |
| `text.weight.strong` | fontWeight | core | 强调字重 | — | 否 |
| `text.weight.brand` | fontWeight | extended | 品牌字重 | — | 否 |
| `text.tracking.caps` | dimension | extended | 全大写小字字距 | — | 否 |
| `text.link.decoration` | string | extended | 链接装饰 | underline / none | 否 |
| `text.numeric.variant` | string | extended | 数字变体 | tabular-nums | 否 |

### 布局（`layout`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `layout.topbar.height` | dimension | core | 顶栏高度 | header 高度 | 否 |
| `layout.sidebar.width` | dimension | shell | 侧栏宽度 | — | 否 |
| `layout.sidebar.collapsed-width` | dimension | shell | 侧栏折叠宽度 | — | 否 |
| `layout.container.max-width` | dimension | extended | 内容容器最大宽 | 居中容器的 max-width | 否 |
| `layout.breakpoint.mobile` | dimension | core | 手机断点 | 样式表 @media 里最常见的小断点 | 否 |
| `layout.breakpoint.narrow` | dimension | core | 窄屏断点 | — | 否 |
| `layout.root.font-size` | dimension | extended | html 根字号 | vw 缩放的 rem 站点才有：桌面视口下 html 的 font-size，所有 rem 尺寸的基准 | 否 |
| `layout.form.label-width` | dimension | shell | 横向表单标签列宽 | — | 否 |
| `layout.form.max-width` | dimension | shell | 单列表单最大宽 | — | 否 |
| `layout.modal.width.sm` | dimension | shell | 确认弹窗宽 | — | 否 |
| `layout.modal.width.md` | dimension | shell | 表单弹窗宽 | — | 否 |
| `layout.drawer.width` | dimension | shell | 抽屉宽 | — | 否 |

### 层级阴影（`elevation`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `elevation.card.y` | dimension | core | 卡片阴影 y | 写法：box-shadow: 0 var(--elevation-card-y) var(--elevation-card-blur) var(--elevation-card-color) | 否 |
| `elevation.card.blur` | dimension | core | 卡片阴影模糊 | — | 否 |
| `elevation.card.color` | color | core | 卡片阴影色 | 暗色下常改为透明，靠边线分层 | 是 |
| `elevation.popover.y` | dimension | extended | 浮层阴影 y | — | 否 |
| `elevation.popover.blur` | dimension | extended | 浮层阴影模糊 | — | 否 |
| `elevation.popover.color` | color | extended | 浮层阴影色 | — | 是 |
| `elevation.modal.y` | dimension | extended | 弹窗阴影 y | — | 否 |
| `elevation.modal.blur` | dimension | extended | 弹窗阴影模糊 | — | 否 |
| `elevation.modal.color` | color | extended | 弹窗阴影色 | — | 是 |

### 动效（`motion`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `motion.duration.fast` | duration | core | 即时反馈时长 | hover / active | 否 |
| `motion.duration.normal` | duration | core | 浮层出现时长 | — | 否 |
| `motion.duration.slow` | duration | core | 弹窗 / 抽屉时长 | — | 否 |
| `motion.easing.standard` | cubicBezier | core | 标准缓动 | 最常见的 timing-function | 否 |
| `motion.easing.enter` | cubicBezier | extended | 进场缓动 | ease-out 类 | 否 |
| `motion.easing.exit` | cubicBezier | extended | 退场缓动 | ease-in 类 | 否 |

### 透明度（`opacity`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `opacity.disabled` | number | core | 禁用态透明度 | 带 disabled 的元素 opacity | 否 |

### z 层（`layer`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `layer.sticky` | number | core | 吸顶层 | z-index 最小的一档 | 否 |
| `layer.dropdown` | number | core | 下拉 / Tooltip 层 | — | 否 |
| `layer.modal` | number | core | 弹窗层 | — | 否 |
| `layer.toast` | number | core | 通知层 | 最高 | 否 |

### 表格（`table`）

| 角色 | 类型 | 层 | 含义 | 找证据的位置 | 暗色常覆写 |
| --- | --- | --- | --- | --- | --- |
| `table.cell.padding-y` | dimension | shell | 单元格纵向内边距 | td 的 padding-top | 否 |
| `table.cell.padding-x` | dimension | shell | 单元格横向内边距 | — | 否 |

## 对比度配对（check-contrast.mjs）

| 前景 | 底色 | 底线 | 说明 |
| --- | --- | --- | --- |
| `color.text.primary` | `color.bg.page` | ≥ 4.5 | 正文 / 页面底 |
| `color.text.primary` | `color.bg.surface` | ≥ 4.5 | 正文 / 卡片 |
| `color.text.secondary` | `color.bg.surface` | ≥ 4.5 | 次要文字 / 卡片 |
| `color.text.secondary` | `color.bg.page` | ≥ 4.5 | 次要文字 / 页面底 |
| `color.text.muted` | `color.bg.surface` | ≥ 4.5 | 弱化文字 / 卡片 |
| `color.text.muted` | `color.bg.page` | ≥ 4.5 | 弱化文字 / 页面底 |
| `color.text.muted` | `color.bg.subtle` | ≥ 4.5 | 弱化文字 / 浅分区 |
| `color.text.link` | `color.bg.surface` | ≥ 4.5 | 链接 / 卡片 |
| `color.text.placeholder` | `color.bg.input` | ≥ 3 | 占位符 / 输入框（已知例外，≥ 3 即记录） |
| `color.text.on-primary` | `color.action.primary` | ≥ 4.5 | 主按钮文字 / 填充 |
| `color.text.on-danger` | `color.action.danger` | ≥ 4.5 | 危险按钮文字 / 填充 |
| `color.text.inverse` | `color.bg.inverse` | ≥ 4.5 | 反色文字 / 反色底 |
| `color.text.on-selected` | `color.action.selected` | ≥ 4.5 | 选中块文字 / 选中底 |
| `color.status.success` | `color.status.success-bg` | ≥ 4.5 | 成功胶囊 |
| `color.status.warning` | `color.status.warning-bg` | ≥ 4.5 | 警示胶囊 |
| `color.status.error` | `color.status.error-bg` | ≥ 4.5 | 错误胶囊 |
| `color.status.info` | `color.status.info-bg` | ≥ 4.5 | 信息胶囊 |
| `color.status.neutral` | `color.status.neutral-bg` | ≥ 4.5 | 中性胶囊 |
| `color.text.danger` | `color.bg.surface` | ≥ 4.5 | 危险文字 / 卡片 |
| `color.icon.default` | `color.bg.surface` | ≥ 3 | 独立图标 / 卡片 |
| `color.icon.muted` | `color.bg.surface` | ≥ 3 | 装饰图标 / 卡片 |
| `color.border.default` | `color.bg.page` | ≥ 1.3 | 卡片边线 / 页面底（可辨即可） |
| `color.border.input` | `color.bg.surface` | ≥ 1.3 | 输入框边线 / 卡片（可辨即可；WCAG UI 组件 3:1 是业界普遍不达的已知例外，Citrine 同样登记为例外） |
| `color.border.focus` | `color.bg.surface` | ≥ 3 | 焦点边线 / 卡片 |
| `color.action.primary` | `color.bg.surface` | ≥ 3 | 主按钮填充 / 卡片（UI 组件 3:1） |

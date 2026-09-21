# 证据 → token 的归档规则

`draft-tokens.mjs` 按这里的规则机械起草；Agent 核对草稿时也按这里判断「机器填对了没」。每条规则都要能回答：证据在哪、为什么这么命名、没证据时怎么办（推断必须标 `[推断]`）。

## 颜色

### Primitive 命名：色族 × 明度档

1. 浏览器算出的任何颜色（rgb / rgba / oklch / color(srgb)…）先归一成 hex；OKLab ΔE < 0.012 的近似色并入更常见的那个（抗锯齿、圆整产生的噪声）。
2. 按 OKLCH 分族：色度低于阈值算 **neutral**（阈值随明度分段：L > 0.9 → 0.025，> 0.6 → 0.04，> 0.3 → 0.05，其余 0.065——近白的状态浅底要和真正的浅灰分开，深端的冷灰又要和藏青分开）；其余按色相分 red / orange / yellow / green / cyan / blue / purple / pink。近白（L ≥ 0.985）叫 `color.white`，近黑（L ≤ 0.12）叫 `color.black`。
3. **品牌族**：在按钮填充（×4）、链接（×2）、边线 / 有彩色底上得分最高的有彩色族改名 `brand`。用户给了 `--brand #hex` 就以它所在族为准。单色站点（Vercel 式黑白）没有品牌族，`action.primary` 直接别名到 neutral 的深档。
4. 明度档：OKLCH L → 50～950（用 Tailwind gray 阶梯标定）；同族撞档往 ±50 挪。品牌族只有一个颜色时叫 `500`（Citrine 的「以品牌色为 500 锚点」）。
5. 半透明颜色按本色分族，按用途命名：阴影色 `shadow-N`、遮罩 `scrim`、焦点环 `ring`、局部遮罩 `mask`，其余 `<档>-a<百分比>`。
6. 渐变不进 token（记 AUDIT「未纳管」）。

### Semantic 角色（按证据强弱排序）

| 角色 | 观察规则 | 没证据时 |
| --- | --- | --- |
| `bg.page` | body / html 背景；都透明则取面积最大的底 | 报警 |
| `bg.surface` | 与页面底不同、面积 ≥ 1% 视口或出现 ≥ 3 次的中性底，卡片 / 区块 / 输入框加权 | 同 `bg.page` |
| `bg.subtle` | 中性底，对 surface 的对比在 1.02～1.35 之间（表头、分区） | 借 `bg.page`（页面底与卡片不同时） |
| `bg.inverse` / `text.inverse` | 与页面明暗相反的中性底 + 落在它上面最常见的文字色 | 深底取正文色 / 反色文字取白 |
| `bg.input` / `border.input` / `text.placeholder` | 输入框样本的背景 / 边线 / `::placeholder` | 底同 surface；边线借 `border.strong` |
| `bg.hover` | 悬停探针里 hover 后出现的中性底 | 比 surface 深一档的中性色 |
| `bg.overlay` | 面积 ≥ 30% 视口、alpha 0.2～0.9 的深色半透明底 | 缺口（弹窗没打开就取不到） |
| `text.primary` | 承载文字量最多的中性色（对 surface ≥ 2.2:1） | 报警 |
| `text.secondary` / `text.muted` | 其余中性文字色按对比度排：最深的一档是 secondary，最浅但 ≥ 3:1 的是 muted | 与上一档同值 |
| `text.link` / `link-hover` | 正文内 `a` 的颜色（没有就取非导航链接）；悬停探针里 `a` 变色 | 正文色 / 同族深一档 |
| `action.primary` / `text.on-primary` | 品牌族实底按钮的填充 + 上面的文字；没有实底按钮 → 根变量 `--primary` 等 → 品牌族最常见色 | 文字按对比度选白或正文色 |
| `action.primary-hover` / `-active` | 悬停探针里主按钮填充变化 | 同族相邻一档；active 同 hover |
| `action.danger` / `text.on-danger` | 红族实底按钮；根变量 `--destructive` / `--danger` / `--error` | 缺口 |
| `text.danger` | — | 同 `action.danger`，并提醒暗色要换亮红 |
| `border.default` / `border.strong` | 最常见的中性边线；比它对比更高的下一档 | 同族深一档 |
| `border.focus` / `focus.ring` / `focus.ring.width` | 焦点探针 / 样式表 `:focus-visible` 规则里的边线色、outline 色、`box-shadow` 环色与 spread。`outline: auto` 是浏览器默认，不算 | 主色（并提醒 Citrine 用近黑） |
| `status.success / warning / error / info`（+ `-bg`） | 徽标类名 / 文案含 success·error·warning·info；根变量 `--success` 等（`-bg` / `-light` / `-soft` 后缀是浅底）；error 可借危险按钮 | 缺口——**不按色相族猜**；用户可用公司调色板补，标 `[推断]` |
| `status.neutral` / `-bg` | — | 借 `text.secondary` / `bg.subtle` |
| `icon.default` / `icon.muted` | — | 借 `text.secondary` / `text.muted` |
| `chart.1…6` | 根变量 `--chart-N`（shadcn 风格） | 缺口 |
| `brand.indicator` / `bg.brand` / `text.on-brand` | — | 同 `action.primary` / `text.on-primary` |
| `bg.elevated / skeleton / skeleton-highlight / readonly` | — | 借 surface / subtle |
| `action.selected` / `bg.selected*` / `text.selected` / `on-selected` | 需要页面上有选中态样本（当前导航项、选中行）；本版探针不专门取 | 缺口——是品牌决定，问用户 |
| `data.increase / decrease` | — | 缺口——公司约定（涨绿跌红 or 反之），问用户 |

## 排版

- **字体栈**：body 的 `font-family` → `font.family.sans` → `font.family.body`；出现等宽栈 → `font.family.mono` → `font.family.code`；标题首选字体与正文不同 → `font.family.display` → `font.family.heading`。
- **字号阶梯**：承载最多文字（按字数 × 元素类型加权）的字号是 `font.size.md` = `text.body.size`；比它小的依次 `sm / xs / 2xs`，大的依次 `lg / xl / 2xl / 3xl…`；相差 < 1px 的合并；只保留出现 ≥ 2 次或被标题用到的。语义映射：`text.body-sm` = 下一档，`text.caption` = 最小档，`text.title-sm / title` = 上一档 / 上两档，`text.heading` = 最接近 h2 的档，`text.display` = 最接近 h1 的档，`text.hero` = 最大档。中文系统下限 12px 的规则写进 DESIGN，不由脚本强制。
- **字重**：出现过的值都收成 `font.weight.<名>`；`text.weight.label` 取 500（没有则 600 / 400），`strong` 取 600（没有则 700），`brand` 取 700；h1 的字重 → `text.display.weight`。
- **行高**：比值（line-height / font-size）；最常见 → `normal` = `text.body.line-height`，最小（比 normal 小 0.05 以上）→ `tight` = 标题 / 大字行高，最大 → `relaxed` = `text.paragraph.line-height`。
- **字距**：负值 → `letter-spacing.tight` = `text.display.tracking`；正值 → `wide` = `text.tracking.caps`。
- `text-transform: uppercase` 只记警告：中文系统通常不套用。

## 尺寸与形状

- **间距**：`padding` / `gap` / `margin` 的 px 值，只收 ≤ 160、在 2px 网格上、出现 ≥ 2 次的；**一律按 4px 阶梯命名** `spacing.<px/4>`（6 → `1-5`、10 → `2-5`、14 → `3-5`、2 → `0-5`），与 Citrine 一致，配方 / 桥接里的 `--spacing-4` 才永远是 16px。奇数值记警告（漂移）。语义留白：`space.inline` = 最常见的 ≤ 12px gap，`space.stack` = 12～40px 里最常见的 gap，`space.gutter` = 区块左右 padding，`space.card` = 卡片 padding；没证据取阶梯里最接近 8 / 16 / 24 / 24 的值并标 `[推断]`。表格 `td` 的 padding → `table.cell.padding-y / -x`。
- **圆角**：出现 ≥ 2 次的值从小到大按档数命名（1 档 = `md`；2 = `sm md`；3 = `sm md lg`；4 = `xs sm md lg`；5 = `+xl`；6 = `+2xl`）；百分比 / ≥ 999 / 高度一半 → `radius.full` = 999px。`$description` 里写用在哪类元素上，DESIGN「按容器层级递减」由人校。
- **线宽**：从小到大 `thin / medium / thick / bar`；最常见 → `border.width.default`；更粗一档 → `border.width.active` 与 `control`（推断）。焦点环 spread / outline 宽 → `focus.ring.width`（阶梯里没有就新建 `border.width.ring`）。
- **阴影**：每个 `box-shadow` 原式解析为多层，取模糊最大的一层作代表；按 `|y| + blur` 去重（差 ≤ 2 视为同档）并从浅到深排，前三档 → `card / popover / modal`：`shadow.y.N` / `shadow.blur.N`（有 spread 再加 `shadow.spread.N`）+ `color.<族>.shadow-N`；原式写进 `$description`。超过三档记警告。
- **动效**：`transition-duration` / `animation-duration`（50～1200ms）最常见 → `duration.normal`，最短 → `fast`，最长 → `slow`；`timing-function` 最常见 → `easing.standard`，另有 ease-out 形态 → `enter`、ease-in 形态 → `exit`（关键字先换成四点）。
- **z-index**：非 static 元素上的正值全部收成 `z.<value>`；≥ 4 个时最小 / 次小 / 次大 / 最大 → `layer.sticky / dropdown / modal / toast`，不足 4 个按顺序填前几档，其余缺口。
- **透明度**：带 `disabled` 的元素 opacity → `opacity.<pct>` = `opacity.disabled`；没有就取 0.3～0.7 之间最常见的值（推断）。
- **控件高度**：按钮 + 输入框高度（取偶数）最常见 → `size.control.md` = `control.height.md`；小 ≥ 4px 的 → `sm`，大 ≥ 4px 的 → `lg`。
- **图标**：正方形 svg 边长最常见 → `size.icon.md`，其余按大小落到 `xs / sm / lg / xl`；`stroke-width` → `icon.stroke.width`；类名里的库名（lucide / iconpark / anticon…）→ `icon.library`。
- **布局**：header 高 → `size.topbar` = `layout.topbar.height`；侧栏（≥ 50% 视口高、宽 48～420、贴左或 fixed）→ `layout.sidebar.width`；居中容器 `max-width` → `layout.container.max-width`；样式表 `@media` 里 ≤ 820px 最常见的断点 → `layout.breakpoint.mobile`，820～1400 → `narrow`。CSS 媒体查询无法引用 var()，配方里的断点是字面镜像。

## 另一模式（暗 / 亮）

1. 取证脚本先看首屏明暗，再试两条路：`set media <另一模式>` + reload（系统偏好），和样式表里有 `.dark` / `[data-theme]` 这类选择器时直接给 `<html>` 加类 / 属性。页面底色明暗**真的翻转**才算拿到。
2. 拿到了 → 另一模式的颜色也进同一套调色板；Theme delta 只覆写有证据的用途：`bg.page / surface / subtle / hover / elevated`、`text.primary / secondary / muted / inverse`、`bg.inverse`、`border.default / input`、`text.link`。其余随模式变化的角色（`THEME.md` 里列出）接入前逐条确认。
3. `theme-map.json`：class 切换 → `{ kind: "class" }`（选择器 `:root.dark`）；data 属性 → `{ kind: "data-attribute", attribute }`；只有系统偏好一条路 → `{ kind: "media" }`（此时 id 只能是 light / dark）。`defaultTheme` = 首屏模式；首屏是暗色的站点，Core 就是暗色、delta 叫 `light`。`runtimeOwner` 先写「待确认：目标站点通过 … 切换」。
4. 没拿到 → 不建 themes/，不反相。

## 缺口怎么补

按 `audit-summary.md`「缺口」表逐行决定，三选一，都要写进 AUDIT：

1. **补证据**：换一个页面再取证（表单页补输入框 / 状态色，列表页补表格 / 选中行，打开弹窗补遮罩），`extract-evidence.mjs` 支持多 URL。
2. **按规则推断**：用上表「没证据时」一栏的规则手写 alias，`$description` 以 `[推断]` 开头写清依据。状态色可借公司调色板或 Citrine 的色相参考（success 绿 / warning 橙 / error 红 / info 青），但值要按目标系统的中性色调性重算对比度。
3. **本系统不需要**：shell 层（侧栏、表格、图表）对营销站可以整组不填，在 AUDIT 写一句理由；core 层不允许这样处理。

## 对比度基线

`check-contrast.mjs` 按 [semantic-roles.md](semantic-roles.md) 末尾的配对表算：正文与 12px 小字 ≥ 4.5:1，大字 / 图标 / UI 组件 ≥ 3:1，边线可辨 ≥ 1.3:1；底色半透明时先叠到页面底上。默认模式与每个 Theme 都算。低于底线的配对：改值（同色相压深，写进 `$description`）或由用户拍板登记为例外（AUDIT + DESIGN「已批准的例外」，附回补路径）——Citrine 就是这样处理三个状态色与占位符的。

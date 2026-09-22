# 网站读取清单（面向 token）

原 web-to-design-md 的清单是为写一份「设计语言散文」准备的；这一份是为「能过校验的 token 文件」准备的：每一项都对应 `draft-tokens.mjs` 里的一条归档规则，读不到就会变成缺口。

## 0. 选页面

一个 URL 通常不够。按**系统类型**挑 2～4 个页面一起取证（`extract-evidence.mjs <url1> <url2> …`）；每个类型定义里的 `pages` 字段就是这句推荐（`list-types.mjs` 会打印，自定义类型自己写）。内置三类：

- **website（通用网站）**：首页（hero、导航、CTA、页脚）+ 一个内容页（正文、标题阶梯、图文卡片、链接）+ 联系 / 订阅页（输入框、焦点）；有作品 / 文章列表再加一页。不去找表格与状态胶囊——它们不是这类系统的角色。
- **product（产品应用）**：首页 / 落地页 + 表单页（登录 / 设置）+ 列表页；能点开弹窗就点开再取。
- **admin（中后台）**：工作台（侧栏 + 顶栏）+ 表格页（表头、选中行、分页、状态胶囊）+ 表单页 + 弹窗 / 抽屉。

SPA 的路由：`snapshot -i` 看菜单项，点一遍记 `location.hash`；各路由节点数一样的是兜底页，不要。

| 想拿到 | 去哪个页面 |
| --- | --- |
| 正文 / 标题 / 链接 / 主按钮 / 卡片 | 首页、落地页 |
| 输入框、占位符、焦点样式、表单标签 | 登录 / 注册 / 搜索 / 设置页 |
| 表格、状态胶囊、分页、选中行（product / admin） | 列表页、工作台 |
| 弹窗遮罩、浮层阴影、Toast | 能触发弹窗的页面（取证前用 agent-browser 点开再 eval；本版脚本不自动点） |
| 暗色 | 任意页（脚本自动试系统偏好与 class / data 切换） |
| 空状态、结果页、危险操作 | 有对应场景的页面 |

登录墙后的页面：先 `agent-browser --session <name> --restore open …` 手动登录，再用同一个 `--session` 跑脚本（脚本接受 `--session`）。

## 1. 首次加载时脚本读了什么

- **颜色**：每个可见元素的 `color`（只算自己有文字节点的）、`background-color`（不透明的）、`border-*-color`（有边线宽度的）；同时记录文字落在哪个「有效底色」上（向上找第一个不透明背景），这就是对比度证据。
- **排版**：`font-size` / `font-weight` / `line-height`（换算成比值）/ `letter-spacing`（换算成 em）/ `font-family` / `text-decoration` / `text-transform`，按元素类型（heading / text / button / link / badge / table…）计数。
- **尺寸**：`padding` 四边、flex / grid 的 `gap`、上下 `margin`、`border-radius`（百分比与 ≥ 999 记成 full）、`border-width`、`box-shadow` 原式、`transition-duration` / `timing-function` / `animation-duration`、非 static 元素的 `z-index`、`opacity`（并记录是否带 disabled）、居中容器的 `max-width`。
- **组件样本**（各取前若干个）：按钮（文字、高度、内边距、圆角、字号、字重、填充、文字色、边线、阴影、所落底色）、输入框（高度、边线、圆角、底、文字、`::placeholder` 色）、标题 h1～h6、链接（是否在正文段落里 / 导航里）、卡片、徽标、表格单元格。
- **图标**：svg 边长分布、`stroke-width`、类名里的图标库线索、线性 / 面性。
- **布局**：header 高度与定位、侧栏宽度、区块的上下左右 padding、body / html 的底色、字体、根字号、`-webkit-font-smoothing`。
- **样式表**：`@media` 里的断点、`prefers-color-scheme` / `prefers-reduced-motion`、`.dark` / `[data-theme]` 这类主题选择器、`:focus-visible` 规则的 outline / box-shadow / border-color；跨域样式表读不到时记数。
- **根变量**：`:root` 上全部 `--*`（最多 400 个）；shadcn / Element / Ant 的变量名会成为状态色、图表色的强证据。
- **主题线索**：html / body 的 class 与 data-*、`color-scheme`、`<meta name=theme-color>`、疑似主题切换控件。
- **文案**：h1 / h2 与 CTA 文案（写 DESIGN「视觉语言」时用；虚拟项目拿它们填 hero / 导航 / 区块标题）。
- **首屏截图**：桌面、手机、另一模式（拿到时）各一张，存到 `<out>-screens/`，只给虚拟项目的对照页用，不是取证证据；`--no-screens` 关掉。

## 2. 另一模式探测

先按首屏底色判断明暗，再：`set media dark|light` + `reload` 重读颜色 → 样式表有主题选择器时给 `<html>` 加类 / 属性重读颜色。页面底色明暗真的翻转才记为「拿到」，两条路都记进 `modes`。

## 3. 悬停 / 焦点探针

挑最多 8 个有文字的交互元素（先按钮，再导航链接，再其它链接），去掉过渡动画后逐个 `hover` / `focus`，读 color / background / border-color / box-shadow / outline / text-decoration 的前后差。结果决定 `action.primary-hover`、`bg.hover`、`text.link-hover`、`border.focus`、`focus.ring`。浏览器默认的 `outline: auto` 不算站点的焦点样式。

## 4. 窄屏 / 手机视口

同一页面切到 1024 与 390 宽再读一遍排版与布局（不重读颜色），给 DESIGN「布局与响应式」和断点核对用。

## 5. 读完之后先看什么

`draft-tokens.mjs` 写出的 `audit-summary.md` 开头四行：来源、首屏模式与另一模式、品牌族判定、角色覆盖（观察 / 推断 / 缺口）。品牌族判错（比如把状态红当品牌）→ 加 `--brand #hex` 重跑；系统类型判错 → `--type` 重跑；「必须处理的缺口」有项 → 回到「0. 选页面」补证据，或按 [mapping-rules.md](mapping-rules.md)「缺口怎么补」处理；「可选角色未填」不管。

## 6. 什么不取

- 不截图当主证据（只在 DOM 证据自相矛盾时人工看一眼）。
- 不抓静态 HTML / CSS 源文件当主证据——hydration、响应式、hover 都只在运行时成立。
- 不读 iframe 内容、不越过登录墙、不发明看不见的页面。

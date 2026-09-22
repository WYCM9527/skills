1. 待填写：品牌色只做什么（hero 大字 / 主 CTA / 指示条 / 链接 / 光效？），不做什么（导航当前项？大面积底？正文？）。一句话写清「品牌色出现的地方就是该被注意的地方」还是「品牌色随处可见」。
2. 待填写：导航当前项、hover、强调用什么表达（下划线 / 反转块 / 换字重 / 品牌色）。
3. 待填写：链接怎么识别（色相 / 下划线 / 字重），正文里的链接与导航 / CTA 是否分开表达。
4. 尺寸只从 token 拿：区块留白 `space.gutter`（左右）/ `space.stack`（上下），行内 `space.inline`，卡片内边距 `space.card`；字号走 `text.*.size` 阶梯（正文 `text.body.size`，标题 `text.heading.size`，展示大字 `text.display.size` / `text.hero.size`）；圆角 `radius.*`；不在阶梯之外取值。
5. 待填写：字重归属（正文 / 标题 / 展示大字 / 导航与按钮各用哪一档）。
6. 表单只有联系 / 订阅这一类：输入框 `color.bg.input` + `color.border.input`，聚焦 `color.border.focus` + `color.focus.ring` × `focus.ring.width`，提交按钮就是主 CTA。本系统没有的产品控件（状态胶囊、危险按钮、表格、骨架屏）不要从别处借值——需要时先走提案。
7. 图片 / 视频上的文字用 `color.text.inverse` 压在 `color.bg.overlay` 遮罩上；全屏菜单、灯箱用 `layer.modal`，吸顶导航用 `layer.sticky`。所有颜色和尺寸都必须能在 `dist/tokens.css` 里找到名字。
8. 改完跑 steward `guard`（构建与登记一致）和 `status`（页面字面量清零）。

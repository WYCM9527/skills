1. 待填写：品牌色只做什么（主按钮 / 进度 / 指示条 / 链接？），不做什么（选中态？大面积底？文字？）。一句话写清「品牌色出现的地方就是该被注意的地方」还是「品牌色随处可见」。
2. 待填写：选中、当前、强调用什么表达（品牌色 / 反转块 / 边线）。
3. 状态色只做「文字 + 同色浅底」胶囊（`color.status.*` / `*-bg`）；实底按钮只有主（`color.action.primary`）与危险（`color.action.danger` + `color.text.on-danger`）。
4. 待填写：链接怎么识别（色相 / 下划线 / 字重），内容型与操作型链接是否分开。
5. 尺寸只从 token 拿：控件高 `control.height.*`，间距 `space.* / spacing.*`，圆角 `radius.*` 按容器层级递减，字号走 `text.*.size` 阶梯；不在阶梯之外取值。
6. 待填写：字重归属（正文 / 标签 / 强调 / 大字各用哪一档）。
7. 禁用 = `opacity.disabled`；只读 = `color.bg.readonly`；加载 = 骨架屏 `color.bg.skeleton*`，不用禁用态假装。
8. 图标类控件必须有 `aria-label`、命中区 ≥ `control.hit-min`；所有颜色和尺寸都必须能在 `dist/tokens.css` 里找到名字。
9. 改完跑 steward `guard`（构建与登记一致）和 `status`（页面字面量清零）。

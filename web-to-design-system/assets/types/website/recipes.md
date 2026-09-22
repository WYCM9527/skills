| 组件 | 底 | 文字 | 边线 / 其他 |
| --- | --- | --- | --- |
| 顶栏 / 导航 | 透明或 `color.bg.page` | `color.text.primary`；当前项 待填写 | 高 `layout.topbar.height`，`layer.sticky` |
| 全屏菜单 / 遮罩 | `color.bg.overlay` | `color.text.inverse` 或 `color.text.primary`（按遮罩明暗） | `layer.modal`，进出 `motion.duration.slow` |
| Hero | `color.bg.page` 或媒体 + `color.bg.overlay` | 大字 `text.hero.size` × `text.hero.line-height`；品牌大字 `color.text.brand` | 副标题 `color.text.secondary`，CTA 见下 |
| 区块（默认 / 浅分区 / 反色） | `color.bg.page` / `color.bg.subtle` / `color.bg.inverse` | `color.text.primary` / `color.text.inverse` | 上下 `space.stack`，左右 `space.gutter`，容器 `layout.container.max-width` |
| 主 CTA | `color.action.primary` / `-hover` / `-active` | `color.text.on-primary` | 高度 `control.height.md`，圆角 待填写 |
| 次要按钮 | 透明，hover 待填写 | `color.text.primary` | `color.border.strong` × `border.width.default` |
| 链接 | — | `color.text.link`，hover `color.text.link-hover` | 待填写：下划线 / 字重 |
| 卡片 / 作品卡 | `color.bg.surface` | 标题 `text.title.size`，说明 `color.text.secondary` | 分层 待填写，圆角 `radius.*`，内边距 `space.card` |
| 图片上的文字 | 媒体 + `color.bg.overlay` | `color.text.inverse` | 对比连遮罩一起算 |
| 内容标签 / 胶囊 | `color.bg.subtle` 或 `color.bg.selected` | `color.text.secondary` | `radius.full`，高度 `control.height.sm`（如果有这一档） |
| 输入框（联系 / 订阅） | `color.bg.input` | `color.text.primary`，占位符 `color.text.placeholder` | `color.border.input`；聚焦 `color.border.focus` + `color.focus.ring` × `focus.ring.width` |
| 分隔线 | — | — | `color.border.default` × `border.width.default` |
| 页脚 | 待填写 | `color.text.secondary` / `muted`，链接 `color.text.link` | 上下 `space.stack` |

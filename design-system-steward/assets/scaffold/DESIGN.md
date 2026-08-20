# 设计系统

> 本文件记录设计意图与使用规则。对已确认纳管的设计决定，具体视觉数值的唯一来源是 `tokens/*.tokens.json`；不要在这里重复色值、尺寸或阴影参数。未迁移的旧规范仅作为审计证据，不与 Token 双重维护。

## 视觉语言

- 待根据已确认的设计证据填写。

## 设计原则

- 优先复用已批准的 Semantic token。
- 需要新值时先提出 token 提案，不在组件里临时硬编码。
- Component token 只用于经确认的组件例外。

## Token 使用规则

- Primitive token 表示值本身。
- Semantic token 表示用途。
- `dist/tokens.css` 是生成物，禁止手改。

## 局部规范／生效范围

- Core 规范默认作用于整个项目；局部差异必须登记在 `scope-map.json`，不能靠零散选择器或目录名称猜测。
- Scope 只记录相对父级的差异；页面需要完整的 `data-ds-scope` 继承链才会消费对应的运行时 CSS。
- Theme、单个组件例外和未登记硬编码分别按 Theme、Component Token、Drift 管理，不把它们误建成 Scope。

## Theme

- Core 默认作用于确认的默认 Theme；已有或经确认新增的模式登记在 `theme-map.json`，其相对 Core 的差异位于 `themes/<id>/`。
- Theme 只覆写已批准的 Semantic token 和 Component 例外；不复制 Core，也不手写任意选择器。
- Scope 与 Theme 不自动组合。局部覆写遇到随 Theme 变化的 Semantic 时，先提出提案并等待确认。

## 布局与响应式

- 待根据项目证据填写。

## 组件原则

- 待根据项目证据填写。

## 交互与无障碍

- 待根据项目证据填写。

## Do / Don't

- Do：在实现前说明所选 Semantic token 表达的意图。
- Don't：为了赶工新增未命名的色值、间距、圆角或字体尺寸。
- Don't：把日常文案、数据或图片内容更新当作设计系统变更。
- Do：新增、跨页面复用或修订视觉决定前，先提出 Token／Scope／Theme／组件例外提案。

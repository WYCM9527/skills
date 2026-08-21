# 局部规范／生效范围

Scope 表达同一个项目内“哪些页面在 Core 之上使用一组明确、可维护的设计差异”。它不增加第四层 Token：Primitive、Semantic、Component 仍描述设计决定；Scope 只描述这些决定在哪里覆写父级。

## 先分类

| 情况 | 管理方式 |
| --- | --- |
| 全站共享的视觉语义 | Core |
| 多个有共同入口／维护目的的子页面 | `section` Scope |
| 长期独立、边界和理由明确的单页 | `page` Scope |
| 单页没有 Token delta | 页面说明或 `reference-only` Scope，不生成 CSS |
| 亮／暗或无障碍模式 | Theme，不建 Scope |
| 已批准的单组件例外 | Component Token |
| 无边界的偶发硬编码 | Drift，先报告或试验 |
| 独立品牌、入口／发布节奏和组件契约都独立 | 独立设计系统候选；停止请用户确认 |

“看起来不同”不是充分条件。建立 Scope 前必须能回答：为什么不同、哪些页面使用、从谁继承。一个颜色或尺寸偏差不能单独作为 Scope 证据。

## 登记册与边界

`design-system/scope-map.json` 是唯一机器登记册；不要为每个 Scope 创建第二份 map。每项必须有 `id`、`kind`（`section`／`page`）、`parent`、至少一个非空 `appliesTo.routes` 或 `appliesTo.sourceGlobs`，以及 `reason`。`status` 默认为 `active`，也可为 `reference-only`。

Scope 目录只保存 delta：

```text
design-system/
├── scope-map.json
├── tokens/
└── scopes/<id>/
    ├── SCOPE.md
    └── tokens/
```

选择器由 ID 和完整父级链推导，不能手写。页面使用完整继承链，例如：

```html
<main data-ds-scope="showcase case-study">
```

这样 `case-study` 不会误命中同级 Scope。没有有效 Token delta 或 `reference-only` Scope 不生成空运行时 CSS。

## 允许的覆写方向

- Scope 可以使用 Core 与祖先 Scope 的 Token，并覆写父级 Semantic。
- Scope 的 Component 覆写必须是已批准例外。
- 新局部 Primitive 必须使用 `scope.<scope-id>.*` 命名空间。

禁止 Core 引用子 Scope、Scope 引用子级或兄弟、Scope 覆写 Core Primitive、同级 Scope 边界重叠或父级循环。

有已登记 Theme 时，Scope 覆写一个随 Theme 变化的 Semantic 需要人重新决定：当前版本不自动创建 Scope × Theme delta。Guard 会报告这个交互，不能靠 CSS 排序猜测结果。

## 构建与接入

构建 Scope 时，Core 与祖先 Scope 作为 `include`，当前 Scope 作为 `source`；生成 CSS 只输出当前 Scope 的有效 delta。`dist/index.css` 按父→子顺序聚合，禁止手改。

先 `audit`／`propose`，再 `apply --scope <id>`；仅当用户需要运行时效果时，再 `integrate --scope <id>` 并经过预览后的第二次确认。详见 [integrate.md](integrate.md)。

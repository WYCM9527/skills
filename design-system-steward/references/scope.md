# 局部规范／生效范围

本 Skill 用 Scope 表达“同一个项目内，哪些页面应在 Core 之上使用一组明确、可维护的设计差异”。中文统一称为**局部规范／生效范围**。

它不改变 Token 的三层含义：Primitive、Semantic、Component 仍然描述设计决定本身；Scope 只描述这些决定在何处覆盖父级。

## 先分类，再建目录

| 情况 | 应该怎样管理 |
| --- | --- |
| 主站共用的视觉语义 | Core |
| 多个有共同入口／路由／维护目的的子页面，视觉语义不同 | `section` Scope |
| 一个页面长期独立、边界和设计理由明确 | `page` Scope |
| 只是特殊内容排版、插图或一次性页面，没有 Token delta | 记录页面说明或 `reference-only` Scope，不生成 CSS |
| light/dark、品牌模式或无障碍模式 | Theme，不新建 Scope |
| 单个组件的确认例外 | Component Token，不新建 Scope |
| 未登记、偶发的硬编码差异 | Drift，先报告，不新建 Scope |
| 独立品牌、入口／发布节奏和组件契约均独立 | 独立设计系统候选；停止并请用户确认 |

“某页看起来不同”不是充分条件。建 Scope 前至少要能回答：它为什么不同、哪些页面使用、从谁继承。多人协作或临时活动时，再补充谁维护它和复审时间。

## 目录与唯一登记册

Core 的 Token 位于 `design-system/tokens/`。每个 Scope 仅保存相对父级的 delta：

```text
design-system/
├── scope-map.json
├── tokens/
└── scopes/
    └── showcase/
        ├── SCOPE.md
        └── tokens/
```

不要创建第二份 `scope.json`。`design-system/scope-map.json` 是唯一机器登记册：

```json
{
  "version": 1,
  "scopes": [
    {
      "id": "showcase",
      "kind": "section",
      "parent": "core",
      "appliesTo": {
        "routes": ["/showcase/**"],
        "sourceGlobs": ["src/showcase/**"]
      },
      "reason": "Showcase 使用独立的编辑风格与内容节奏。",
      "status": "active"
    },
    {
      "id": "case-study",
      "kind": "page",
      "parent": "showcase",
      "appliesTo": {
        "routes": ["/showcase/case-study"]
      },
      "reason": "该长期案例页需要独立的叙事层级。"
    }
  ]
}
```

必填字段为 `id`、`kind`（`section` 或 `page`）、`parent`、`appliesTo`（非空 `routes` 或 `sourceGlobs`）和 `reason`。`status` 可省略，默认 `active`；可设为 `reference-only`。不能手写 CSS selector：构建器从 `id` 与完整祖先链推导它。

`routes` 表达页面范围，`sourceGlobs` 表达可审计／可接入的源码范围。它们不能代替运行时属性，也不能授权 Agent 自动跨范围改 UI。

## 继承与覆写

一页只解析一条清楚的祖先链。下面的页面明确先应用 `showcase`，再应用 `case-study`：

```html
<main data-ds-scope="showcase case-study">
```

Core 输出到 `:root`。Scope CSS 只覆盖自身 delta，选择器由整条链生成，因此兄弟 Scope 不会误命中。没有运行时 Token delta 的 Scope、或 `reference-only` Scope，不生成空 CSS。

允许的方向：

- Scope 可使用 Core 与祖先 Scope 的 Token；
- Scope 可以覆写父级 Semantic；
- Scope 的 Component 覆写必须是已批准的组件例外；
- Scope 新增的 Primitive 必须位于 `scope.<scope-id>.*` 命名空间。

禁止的方向：

- Core 引用任何子 Scope；
- Scope 引用子级或兄弟 Scope；
- Scope 覆写 Core Primitive；
- 同级 Scope 具有重叠边界或循环父级关系。

如果例外不符合这些方向，不要用“更深一层目录”掩盖问题；应提出新的 Core Semantic、Component Token，或独立设计系统候选。

## Style Dictionary 构建组合

固定使用 Style Dictionary `5.5.2`。构建 Core 时只读 Core Token；构建一个 Scope 时，把 Core 与祖先 Scope 作为 `include`，只把当前 Scope 的 Token 作为 `source`。这能解析父级 alias，同时避免兄弟 Scope 的同名 Semantic 在同一输入集里相互覆盖。

构建器保留可用的 CSS alias 引用，但 Scope 输出只包含该 Scope 的实际 delta。`dist/index.css` 按父→子拓扑顺序聚合可运行 CSS；不要手改任一 `dist/*.css` 文件。

## 建立与接入顺序

1. 用 `audit` 收集候选证据；用 `propose` 让用户确认边界、父级、理由和来源。
2. 用 `apply --scope <id>` 只创建目录和登记信息。这个动作不接入页面。
3. 仅当 Scope 是 `active` 且用户需要运行时效果时，用 `integrate --scope <id>` 先查看只读预览，再获得第二次确认。
4. 在 `experiment` 中仅验证当前 Scope；用 `guard` 检查范围、引用与生成物。

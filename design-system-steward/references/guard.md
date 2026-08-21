# Guard：检查，不自动修复

`guard` 的职责是发现不一致、边界错误和生成物漂移；它不会修改 Token、地图、页面或 CSS。

它检查：

1. Core、Scope 与 Theme Token 的类型、alias 目标和循环；
2. 当前 DTCG CSS Profile 不支持的已批准类型；
3. Scope 树的父级、循环、ID、边界与同级重叠；
4. Theme Map 的默认模式、受控激活信息和 Theme 目录／引用关系；
5. 覆写方向：Core 不引用子级，Scope 不引用子级／兄弟且不覆写 Core Primitive，Theme 只覆写允许的 Semantic 或批准的 Component 例外；
6. Scope 覆写与 Theme delta 同时涉及同一 Semantic 时的待决交互；当前版本不自动制造 Scope × Theme 输出；
7. `dist/tokens.css`、`dist/themes/*.css`、`dist/scopes/*.css` 与 `dist/index.css` 是否缺失、陈旧或多余。

```text
node scripts/guard.mjs --project /absolute/project/path
```

Guard 在系统临时目录中构建、比对并报告，不会覆盖目标项目的生成物。发现漂移时，建议运行项目的正式构建命令或回到提案；不要擅自重建或改 Token。

如需复核**本次已改动的文件**是否引入了未分类的视觉字面量，可额外传入明确文件清单：

```text
node scripts/guard.mjs --project /absolute/project/path --changed 'src/Page.tsx,src/page.css'
```

这只扫描名单中的 UI／样式文件，并把颜色、尺寸、任意值 utility、Scope／Theme 标记报告为 `needs-steward-review` 候选；候选不会令 Guard 失败，也不会自动创建 Token。脚本无法可靠判断两个相同数值是否表达同一设计意图，最终由人分类为复用、Drift 或新提案。

可以在 Token、Scope Map 或 Theme Map 变更的 CI 中运行 Guard。是否接入 CI、使用何种 CI 及何时将警告升为失败，由项目维护者决定。

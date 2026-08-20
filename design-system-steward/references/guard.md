# Guard：检查漂移，不自动修复

`guard` 的职责是发现问题，而不是替项目修改 Token、Scope Map、页面或生成物。

它检查：

1. Core 与 Scope Token 的类型、alias 目标或 alias 循环错误；
2. 当前 DTCG CSS Profile 不支持的已批准类型；
3. Scope Map 的父级存在性、循环、非法 ID、缺失边界或同级范围重叠；
4. Token 覆写方向：Core 不能引用子 Scope，Scope 不能引用子级／兄弟，Scope Primitive 不能覆盖 Core Primitive，Component 覆写必须已批准；
5. `dist/tokens.css`、`dist/scopes/*.css` 和 `dist/index.css` 是否与临时构建一致，是否缺失、陈旧或多余。

运行：

```text
node scripts/guard.mjs --project /absolute/project/path
```

Guard 在系统临时目录中构建并比对，不会覆盖目标项目的生成物。发现漂移时，应报告差异并建议运行正式构建命令；不能擅自重建或改 Token。

建议在 Token 或 Scope Map 变更的 CI 中运行验证与 Guard。是否接入 CI、使用何种 CI、以及失败阈值，留给项目维护者决定。

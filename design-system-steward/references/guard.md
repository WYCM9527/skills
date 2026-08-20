# Guard：检查漂移，不自动修复

`guard` 的职责是发现三类问题：

1. token 的类型、alias 目标或 alias 循环错误；
2. 当前 DTCG CSS profile 不支持的已批准类型；
3. `dist/tokens.css` 与基于 tokens 的临时构建不一致。

运行：

```text
node scripts/guard.mjs --project /absolute/project/path
```

Guard 在系统临时目录中构建并比对，不会覆盖目标项目的生成物。发现漂移时，应报告差异并建议运行正式构建命令；不能擅自重建或改 token。

建议在 token 变更的 CI 中运行验证和 Guard。是否把它接入 CI、使用哪种 CI、以及失败阈值，留给项目维护者决定。

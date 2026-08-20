# 设计系统试验

本文件用于新分支、demo 或可回滚的试验；不要直接把它当作改造生产 UI 的授权。

## 可复制 Prompt

```text
请只在 [试验范围] 验证本项目的设计系统，不修改生产页面。

先阅读 design-system/DESIGN.md，并且只使用 design-system/tokens/ 中已批准的 token。
不要手改 design-system/dist/tokens.css，也不要新增未命名的视觉数值。
如果 token 不足，停止实现，列出需要确认的 Primitive / Semantic / Component token 提案及理由。
```

## 验收

- [ ] 范围仅限于预先约定的试验位置。
- [ ] 没有手改生成的 CSS。
- [ ] 没有未经确认的硬编码视觉值。
- [ ] 每个 Semantic token 的用途可解释。
- [ ] 失败时可以只回滚试验提交。

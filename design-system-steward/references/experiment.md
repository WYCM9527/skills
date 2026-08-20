# Experiment：中文 Prompt 与可回滚的范围试验

`experiment` 不改生产页面。它的目标是让团队在明确边界下试用已确认的 Core 或局部规范，再决定是否单独发起代码迁移任务。

## 推荐 Prompt 骨架

```text
请只在 [试验页面、独立 demo 或新分支] 验证 design-system/ 的设计语言，不修改现有生产组件。

本次范围：
- Core / 局部规范：[填写 scope-id；如只用 Core 请写 core]
- 已登记页面边界：[填写 routes 或 source globs]

必须：
1. 阅读 design-system/DESIGN.md；如使用局部规范，再阅读 design-system/scopes/[scope-id]/SCOPE.md；
2. 只使用 Core 与该 Scope 祖先链中已经定义的 Token；
3. 不新增未命名的色值、间距、圆角、阴影或字体尺寸；
4. 报告每个使用到的 Semantic Token 与它表达的意图；
5. 如果现有 Token 不能表达需求，停止并提出 Token 提案，不要临时硬编码；
6. 不修改父级页面、同级 Scope 页面或 design-system/dist/ 中的生成物。

任务：[填写一个小范围组件或页面试验]
```

## 验收清单

- 试验范围是否只有预先指定的组件、临时页面或 Scope？
- Scope 是否使用完整的 `data-ds-scope` 继承链，而没有只写子级 ID？
- 是否没有直接写入 `dist/*.css`、新增未经确认的视觉数值或改动 Scope Map？
- Semantic Token 名称是否表达用途，而不是颜色或像素？
- 如果出现组件例外，是否提出 Component Token 提案，而不是复制值？
- 目标 Scope 是否生效，同时父级和同级页面没有变化？
- 视觉是否满足 `DESIGN.md`／`SCOPE.md` 的 Do/Don't、对比度和响应式规则？

## 回滚

试验必须放在独立分支、独立 demo 或可单独删除的提交中。验收失败时，只回滚试验代码或这次 Scope 接线；不要回滚已确认的 Token 真相源，除非用户重新确认设计决策本身。

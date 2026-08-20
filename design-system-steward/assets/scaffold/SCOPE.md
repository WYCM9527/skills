# 局部规范：{{SCOPE_ID}}

> 本文件只记录相对父级规范的设计意图和边界。具体数值仍只写在本目录 `tokens/*.tokens.json`；不要复制父级 Token，也不要手改生成的 CSS。

## 生效范围

- 父级：`{{PARENT}}`
- 类型：`{{KIND}}`
- 状态：`{{STATUS}}`
- 设计理由：{{REASON}}

### 路由

{{ROUTES}}

### 源码边界

{{SOURCE_GLOBS}}

## 相对父级的设计差异

- 待根据已确认的证据填写。优先覆写父级的 Semantic token。
- 只有确实无法复用父级值时，才在 `tokens/primitives.tokens.json` 添加以 `scope.{{SCOPE_ID}}.*` 开头的局部 Primitive。
- Component token 仅用于已批准且不应提升为通用 Semantic token 的局部组件例外。

## 不属于本 Scope 的内容

- 浅色／深色等同一界面的主题映射仍由 Theme 管理，不新建 Scope。
- 如本 Scope 覆写的 Semantic 在 Theme 间也变化，先记录为待确认交互；不要自动创建 Scope × Theme CSS。
- 无页面边界、只有零星硬编码的差异属于 Drift，先修正或提出提案，不升级为规范。

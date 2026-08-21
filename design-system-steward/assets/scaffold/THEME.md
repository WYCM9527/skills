# Theme：{{THEME_ID}}

> Core Token 是确认的默认 Theme。本文件只记录当前 Theme 相对 Core 的意图、适用范围和运行时约束；具体值只写在本目录 `tokens/*.tokens.json`，不要复制 Core 或手改生成 CSS。

## 映射

- 默认 Theme：`{{DEFAULT_THEME}}`
- 当前 Theme：`{{THEME_ID}}`
- 状态：`{{STATUS}}`
- 激活方式：`{{ACTIVATION}}`
- 权威来源：`{{SOURCE}}`
- 运行时所有者：`{{RUNTIME_OWNER}}`
- 设计理由：{{REASON}}

## 相对 Core 的设计意图

- 待根据已确认的证据填写。
- 优先覆写 Core Semantic token；Component token 仅用于已批准的组件例外。
- 不覆写 Core Primitive，也不在此处创建主题开关、持久化或系统偏好逻辑。

## 与 Scope 的关系

- Theme 是同一界面的模式，Scope 是页面边界；二者不自动组合。
- 若当前 Theme 与某个 Scope 需要同时覆写同一 Semantic，先提出提案并获得确认；不要添加猜测性 CSS。

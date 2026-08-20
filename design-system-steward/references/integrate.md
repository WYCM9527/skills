# Integrate：双确认的最小页面接入

`integrate` 是唯一可能改 UI 源码的模式。它不是 `apply` 的附带动作，也不是全仓 Token 迁移器。

## 共同的两道确认

第一道确认发生在相应的 `apply`：用户先确认 Scope／Theme 的来源、登记与目录创建。第二道确认发生在 `integrate`：先只读生成预览，用户再明确同意修改预览列出的**确切页面、Layout 或样式入口**，才允许最小编辑。

预览必须说明：当前对象、完整 Scope 链或 Theme 受控选择器、要消费的生成 CSS、唯一候选入口、范围理由和不确定性。若入口无法安全定位、跨出登记边界、`reference-only` Scope 没有运行时 CSS，或 Theme 的运行时所有者不清楚，停止并给出中文可复制 Prompt；不能猜测。

## 接入 Scope

`integrate --scope <id>` 的预览必须展示完整 `data-ds-scope` 值，例如 `showcase case-study`。第二次确认后，只可以：

- 在用户确认的页面根或 Layout 根增加该完整属性链；
- 在用户确认的既有样式入口导入已生成 CSS；
- 添加验证该 Scope 必需的最小局部接线。

不可以批量补属性、替换硬编码、修改 Token、改兄弟 Scope，或手改 `dist/`。编辑后构建、运行 Guard，并在可回滚范围确认该 Scope 生效而父级和同级页面不变。

## 接入 Theme

`integrate --theme <id>` 的预览必须展示 `theme-map.json` 中已确认的根级激活方式、要使用的 `dist/themes/<id>.css`，以及唯一的样式或根入口。第二次确认后，只可以在该入口消费生成 CSS，或接入已确认的根级属性／class。

不能自动创建主题开关、`localStorage`、状态 provider、系统偏好监听或新的 Theme selector；这些都属于运行时产品行为，必须由用户另行明确选择。既有切换机制不清楚、多个机制相互冲突或预览会影响未登记页面时停止。

## 无法安全定位时的 Prompt

```text
请只定位 [scope-id 或 theme-id] 的唯一页面、Layout 或样式入口，不修改任何文件。

已登记边界／Theme 映射：
- [填写 route、source glob 或受控根级激活方式]

请输出：
1. 最小且唯一的入口文件；
2. 它为什么只覆盖已登记范围；
3. 完整 data-ds-scope 链或 Theme 根级选择方式；
4. 需要消费的生成 CSS；
5. 若不能唯一定位，缺少什么信息并停止。
```

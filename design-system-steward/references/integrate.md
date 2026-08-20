# Integrate：双确认的最小页面接入

`integrate --scope <id>` 是唯一可能修改 UI 源码的模式。它不是 Scope Scaffold 的附带动作，也不是全仓 Token 迁移器。

## 两道确认闸门

第一道确认已在 `apply --scope <id>` 中完成：用户确认这个 Scope 的父级、边界、理由、来源与目录创建。

第二道确认发生在本模式：先只读生成预览，用户明确同意修改预览里列出的**确切页面或 Layout 入口**后，才允许做最小编辑。

如果 Scope 是 `reference-only`，没有已生成的运行时 CSS、找不到安全入口、候选入口跨出已登记 `sourceGlobs`，或改动会影响未登记页面，停止；不要猜测。给出中文可复制 Prompt，让用户或维护者确认入口与范围。

## 先只读预览

读取 `scope-map.json` 并运行：

```text
node scripts/plan-integration.mjs --project <absolute-project-root> --scope <id>
```

预览至少应包含：

1. 当前 Scope 的完整祖先链；
2. 预期的 `data-ds-scope` 属性值，例如 `showcase case-study`；
3. 要消费的已生成 CSS 文件或聚合入口；
4. 根据登记边界找到的最小、可验证入口；
5. 将改动限制在该 Scope 的理由、风险和不确定性。

预览仅用于说明，不能因为脚本找到候选文件就自动写入。

## 经第二次确认后的最小编辑

确认时应复述目标 Scope、文件路径和具体变更。只可以：

- 在用户确认的页面根或 Layout 根增加完整的 `data-ds-scope` 属性链；
- 在用户确认的既有样式入口导入已经生成的 CSS；
- 添加为了验证该 Scope 而必需的最小、局部接线。

不可以：

- 修改或重命名 Token；
- 直接编辑 `design-system/dist/*.css`；
- 在其他页面补属性、批量替换硬编码、重构组件或改变兄弟 Scope；
- 通过猜测路由框架扩大影响范围。

编辑后先运行 Token 验证与构建，再用 `experiment` 的范围验收清单确认：目标 Scope 生效、父级保持原样、同级 Scope 不受影响。若失败，只回滚这次最小接线，不回滚已经确认的 Token 真相源，除非用户重新确认设计决定。

## 无法安全定位时的中文 Prompt

```text
请只定位 [scope-id] 的页面或 Layout 入口，不修改任何文件。

已登记边界：
- 路由：[routes]
- 源码范围：[source-globs]

请输出：
1. 最小、唯一的入口文件；
2. 该入口为什么只覆盖这个 Scope；
3. 应使用的完整 data-ds-scope 属性链；
4. 需要导入的已生成 CSS；
5. 若无法唯一定位，明确说明缺少什么信息并停止。
```

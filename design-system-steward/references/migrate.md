# Migrate：把存量代码统一到已批准的设计系统

`migrate` 解决「系统建好了，但项目 90% 还是旧写法」的断层。它只在 Core 已建立（`setup`／`apply` 完成）后使用；没有已批准 Token 时无从统一，脚本会直接停下。

孤儿规范的治理原则：**要么收编、要么正式豁免，不允许无名氏长期存在。** 收编靠 adopt／replace，豁免靠 settle 写入登记册。

## 三个阶段 = 三层置信度

```text
node scripts/migrate.mjs --project /absolute/project/path --phase adopt|replace|settle [--apply]
```

默认**只读输出计划**；加 `--apply` 才写文件。每次只跑一个阶段，改完提交一次。

| 阶段 | 置信度 | 做什么 |
| --- | --- | --- |
| `adopt` | 高 | 旧 CSS 变量定义的值命中已批准 Token 时，把定义桥接为 `--brand: var(--color-action-primary)`。旧变量名的所有引用者不用动，运行时立即由 Token 接管。 |
| `replace` | 中 | 样式表里的硬编码字面量、className 里的 Tailwind 任意值（如 `bg-[#2563eb]`），命中**唯一 Semantic** Token 时替换为 `var(--…)`。逐文件出对照表。 |
| `settle` | 低 | 汇总前两段拒绝自动处理的所有待决项，让人逐组决定：归并（merge）、升级（promote）或豁免（exempt）。`--apply` 只写豁免登记册。 |

## 匹配规则（为什么有些值不会被自动替换）

- **Semantic 优先**：治理模型要求消费端用用途层 Token。值只命中 Primitive（调色盘）时不静默降级，进待决清单请人先命名用途（`primitive-only`）。
- **撞值即停**：同一个值对应多个 Semantic Token（如「主按钮蓝」和「链接蓝」同值）时列为 `ambiguous-semantic`，由人按上下文分派。
- **值归一化**：`#2563EB`、`#2563eb`、`#25e`（三位缩写）、`rgb(37, 99, 235)`、`rgba(37,99,235,1)` 视为同一个颜色。`hsl()`／`oklch()` 不解析。尺寸只匹配 `px`／`rem`；`--rem-in-px 16` 可选开启 rem→px 换算（根字号可能被改过，默认关）。`0px` 一类结构性零值不替换。
- **v1 边界**：JS/TS 内联样式与 styled-components 里的字面量只报告为 `js-literal` 待决，不改写；`%`、`vw`、`em` 不替换。

## 写入前的安全网

`--apply` 前脚本检查 git 状态：

- 不是 git 仓库 → 拒绝写入（无法回滚），除非用户明确接受风险并加 `--force`；
- 工作区有未提交改动 → 拒绝写入（混在一起无法单独回滚），除非加 `--allow-dirty`。

写入后生成 `design-system/MIGRATION.md`：逐文件「原值 → 现在」对照、回滚命令原文（未提交用 `git restore`，已提交用 `git revert`）、建议的提交信息、受影响路由的肉眼验收清单、`guard --changed` 复核命令。报告只保留最近一次，历史看 git。

## 迁移问卷（对用户只问这一份）

按 [communication.md](communication.md) 呈现，第一题固定为档位选择：

```text
## 我准备统一存量代码
只读扫描结果：可无风险桥接 X 处旧变量定义；可替换 Y 处与已批准 Token 同值的硬编码；
另有 Z 处需要你拍板（语义不明、撞值、或写在 JS 里）。

## 需要你拍板
1. 选一个档位（不确定就选推荐项）：
   - 保守：只做桥接（adopt），页面样式文件一行不改。
   - 推荐：桥接 + 替换命中唯一用途 Token 的硬编码（adopt + replace）。
   - 激进：在推荐基础上，把只命中调色盘的值也逐个问你命名后替换。
2. （证据触发时才出现）具体撞值/语义题，每题带推荐项。

## 你确认后我会做／不会做
- 会：按档位分阶段改写，每阶段单独提交；生成 MIGRATION.md 对照与回滚指引；跑 guard 复核。
- 不会：动 JS 内联样式；不会在 git 不干净时写入；不会碰豁免登记册里的路径和值。
```

## settle 与豁免登记册

`settle` 输出按类型分组的待决清单，每组三个出路：

1. **merge**：这个值其实就是某个已批准 Token → 回到 propose 记录选择后由 replace 替换；
2. **promote**：这是还没命名的真规范 → 走 propose 建 Token，批准后再迁移；
3. **exempt**：有意保留原样 → 写入 `design-system/exemptions.json`，必须写明理由。

豁免登记册格式（每条 `path` 必填，可选 `value` 把豁免收窄到一个字面量；`reason` 必填）：

```json
{
  "exemptions": [
    { "path": "src/vendor/**", "reason": "第三方库样式，随依赖升级" },
    { "path": "src/promo.css", "value": "#ff00ff", "reason": "活动专用色，随活动整体下线" }
  ]
}
```

登记后 `audit`、`guard --changed` 与 `migrate` 都会静默跳过命中的路径或值，不再反复盘问。没有复审日期：临时内容由你主动下线，guard 发现豁免指向的文件已不存在时，只提示可以顺手清掉这条死登记，不催任何业务决定。

用户在问卷里确认豁免后，Agent 把确认条目写成一个 JSON 文件再执行：

```text
node scripts/migrate.mjs --project /absolute/project/path --phase settle --apply --exemptions-file /tmp/confirmed-exemptions.json
```

## 随时看进度

```text
node scripts/status.mjs --project /absolute/project/path
```

只读输出：Token／Scope／Theme 计数、可桥接与可替换的剩余数、待决数、豁免数、`var(--…)` 使用率（统一进度百分比），以及**基于当前状态的下一步建议**。跑完不知道下一步干什么时，先看它。

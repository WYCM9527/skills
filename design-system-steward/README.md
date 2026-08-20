# Design System Steward

一个可免费安装、可 Git 版本化的 Agent Skill：把现有 Web 项目中分散的设计证据整理成**可解释、可验证、可演进**的设计系统，而不是把任何旧项目一键硬改成三层 Token。

v0.2 新增“局部规范／生效范围”治理：一个项目可以有 Core 规范 A、`showcase` 专区规范 B，以及某个页面规范 C；它们是继承树中的不同生效范围，不是把整套规范复制三遍。

它使用 DTCG 2025.10 的 token 与 alias 语义；`Primitive → Semantic → Component` 是本 Skill 的治理约定，Component 层按需创建，并不是 DTCG 强制标准。

## 它会做什么

```text
指定一个项目根目录
  → 只读 Audit
  → 证据化 Propose / 冲突停点
  → 用户确认 Apply 建立 Core
  → 按确认创建局部规范树
  → 构建 Core 与局部 CSS
  → 二次确认后才接入指定页面
  → 中文 Prompt 驱动的小范围 Experiment
  → Guard 检查漂移
```

- 只自动化事实、候选、校验和生成；不会替人决定语义命名、合并逻辑、权威来源或页面边界。
- DTCG JSON 是数值唯一真相源；`DESIGN.md` 只写意图；所有 `dist/*.css` 只由构建生成。
- `Scope` 在中文文档中称为“局部规范／生效范围”：它回答“差异在哪里生效”，不增加第四层 Token。
- 不会因为一个页面颜色不同就新建 Scope；必须有明确边界、设计理由和持续性证据。
- Theme 是同一界面的模式，Component Exception 是组件级例外，Drift 是无边界的偶发硬编码；它们都不自动变成局部规范。
- `audit`、`propose` 与 `guard` 默认只读。Core `apply`、`apply --scope` 与页面 `integrate` 都需要明确确认；`integrate` 还要求预览后的第二次确认。
- 不会批量改 UI、发明 dark mode、连接或双向同步 Figma、覆盖旧文档；如果独立品牌、入口／发布节奏和组件契约都显示它应是另一套设计系统，会停下请用户确认。

## 安装

这个仓库是源码包，不是 Codex Plugin，也不需要 Plugin manifest。请安装到**项目级** Skill 路径；以下路径必须替换成你的真实绝对路径。

先取得源码：

```bash
git clone https://github.com/WYCM9527/skills.git /tmp/wycm9527-skills
```

### Codex

```bash
node /tmp/wycm9527-skills/design-system-steward/scripts/render-install.mjs \
  --host codex \
  --out /absolute/project/.agents/skills/design-system-steward
```

### Cursor

```bash
node /tmp/wycm9527-skills/design-system-steward/scripts/render-install.mjs \
  --host cursor \
  --out /absolute/project/.agents/skills/design-system-steward
```

### Claude Code

```bash
node /tmp/wycm9527-skills/design-system-steward/scripts/render-install.mjs \
  --host claude \
  --out /absolute/project/.claude/skills/design-system-steward
```

安装脚本只会写入你通过 `--out` 明确指定的空目录。它不会自动创建任何用户级、组织级或项目规则文件。Codex 安装副本包含 `agents/openai.yaml`；Claude Code 与 Cursor 安装副本会在 `SKILL.md` 前置字段加入各自支持的 `disable-model-invocation: true`。三端都保留显式调用策略。

## 调用

```text
$design-system-steward audit
$design-system-steward propose
$design-system-steward apply
$design-system-steward apply --scope showcase
$design-system-steward integrate --scope showcase
$design-system-steward experiment
$design-system-steward guard
```

每次都要给出一个绝对项目根目录；在 monorepo 中要明确到具体 package。不要让 Skill 自行跨包猜测。

## Core 与局部规范

Core 是全站共享的基础；Scope 是只覆盖某个专区或页面的继承 delta。典型结构：

```text
design-system/
├── DESIGN.md
├── scope-map.json                  # 唯一机器登记册
├── tokens/                         # Core 的三层 Token
├── scopes/
│   └── showcase/
│       ├── SCOPE.md                # 只记录与父级不同的意图和规则
│       └── tokens/                 # 只记录与父级不同的值／alias
└── dist/
    ├── tokens.css                  # Core CSS
    ├── index.css                   # 按继承顺序聚合
    └── scopes/showcase.css         # Scope delta CSS
```

`scope-map.json` 的每个 Scope 都必须有：

- `id`、`kind`（`section` 或 `page`）、`parent`；
- `appliesTo.routes` 或 `appliesTo.sourceGlobs` 至少一个非空边界；
- `reason`；可选 `status`（`active` 或 `reference-only`）。

选择器不手写，由 Scope 的 ID 与父级链推导。页面通过完整继承链声明生效范围，例如：

```html
<main data-ds-scope="showcase case-study">
```

因此 `case-study` 不会误使用其他同级 Scope 的 CSS。单页 Scope 若没有运行时 Token delta，可以只保留 `SCOPE.md`、边界和登记信息；不会生成空 CSS。

### 何时该建 Scope？

适合：一个长期运营的专区、一组共享另一套视觉语义的子页面、或一个有明确边界和维护理由的独立页面。

不适合：一次性的插图、单个按钮临时颜色、尚未确认的页面草稿，或只是一个组件例外。先把这些作为 Drift／Component Token 候选记录，避免把目录越分越碎。

## Apply 与接入页面

首次 `apply` 只创建 Core。后续 `apply --scope <id>` 在用户确认 Scope 的父级、边界、理由和权威来源后，才创建局部目录并更新登记册；它绝不修改页面。

`integrate --scope <id>` 是唯一会接触页面源码的模式：先只读预览完整属性链、CSS 引入与最小入口，再让用户明确确认这一次确切改动。无法安全判断页面或 Layout 入口时，它会停止并给出中文可复制 Prompt，而不是猜测或扩大改动范围。

## 构建与校验

Style Dictionary 固定为 `5.5.2`。Core 先构建到 `:root`；每个 Scope 再独立读取 Core 与祖先 Scope，并只输出自己的 CSS delta。这样 Scope 可以继续引用父级 alias，兄弟 Scope 却不会在同一个构建输入中相互覆盖。

Skill 使用经过验证的 DTCG 2025.10 CSS Profile，**不是完整官方 JSON Schema 校验器**。当前支持的 CSS-safe 子集与限制见 [references/dtcg-profile.md](references/dtcg-profile.md)。

`guard` 会验证 Scope 树、边界重叠、alias、允许的覆写方向和全部生成 CSS 的漂移；它在临时目录重建对比，不手改任何文件。

## 本地验证与开发

需要 Node.js 22+：

```bash
cd design-system-steward
npm install
npm run test:all
```

测试覆盖只读审计、冲突停点、monorepo 边界、Core 与局部规范树、单页 Scope、范围重叠、alias 错误、稳定 CSS 构建、生成物漂移、接入预览与三端安装材料化。它不会调用 Figma，也不会在没有确认时改造 UI。

## 许可证与来源

本项目采用 [MIT](LICENSE)，版权为 `WYCM9527`。它从头实现，不复制 `ilikescience/design-tokens-skill` 的文字或脚本；如未来引入任何第三方 MIT 代码，必须保留其版权与许可证通知。

## 参考

- [DTCG Format 2025.10](https://www.designtokens.org/tr/2025.10/format/)
- [Agent Skills specification](https://agentskills.io/specification)
- [Codex Skills](https://developers.openai.com/codex/skills)
- [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [Cursor Skills](https://cursor.com/docs/skills)
- [Style Dictionary formats](https://styledictionary.com/reference/hooks/formats/)

# Design System Steward

一个可免费安装、可 Git 版本化的 Agent Skill：把现有 Web 项目中分散的设计证据整理成**可解释、可验证、可演进**的设计系统，而不是把任何旧项目一键硬改成三层 Token。

它使用 DTCG 2025.10 的 token 与 alias 语义；`Primitive → Semantic → Component` 是本 Skill 的治理约定，Component 层按需创建，并不是 DTCG 强制标准。

## 它会做什么

```text
指定一个项目根目录
  → 只读 Audit
  → 证据化 Propose / 冲突停点
  → 用户确认 Apply
  → 建立 design-system/ 与生成 CSS
  → 中文 Prompt 驱动的小范围 Experiment
  → Guard 检查漂移
```

- 只自动化事实、候选、校验和生成；不会替人决定语义命名、合并逻辑或权威来源。
- 不会改 UI 源码、批量替换硬编码、发明 dark mode、连接 Figma 或覆盖旧文档。
- DTCG JSON 是数值唯一真相源；`DESIGN.md` 只写意图；`dist/tokens.css` 只由 Style Dictionary 生成。
- `audit` 与 `guard` 默认只读。`apply` 需要用户明确确认项目根、权威来源和创建目录。

## 安装

这个仓库是源码包，不是 Codex Plugin，也不需要 Plugin manifest。请将它安装到一个**项目级** Skill 路径；以下命令的路径都应替换成你的真实绝对路径。

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

安装脚本只会写入你通过 `--out` 明确指定的空目录。它不会自动创建任何用户级、组织级或项目规则文件。Codex 使用 `agents/openai.yaml`，Claude Code 和 Cursor 使用各自支持的 `disable-model-invocation: true` 前置字段；三者都需要显式调用完整 Skill。

## 调用

```text
$design-system-steward audit
$design-system-steward propose
$design-system-steward apply
$design-system-steward experiment
$design-system-steward guard
```

每次都要给出一个绝对项目根目录；在 monorepo 中要明确到具体 package。不要让 Skill 自行跨包猜测。

## Apply 产物

经确认后，在目标项目内创建：

```text
design-system/
├── DESIGN.md
├── AUDIT.md
├── TRY.md
├── tokens/
│   ├── primitives.tokens.json
│   ├── semantic.tokens.json
│   └── components.tokens.json  # 仅在确认组件例外时创建
├── themes/                     # 仅在发现并确认已有主题时创建
├── style-dictionary.config.mjs
└── dist/tokens.css             # 首次成功构建后生成
```

Style Dictionary 固定为 `5.5.2`，并输出稳定的 CSS variables。V1 支持经过构建验证的 DTCG CSS 子集：结构化 sRGB color、dimension、duration、number、fontWeight、fontFamily、cubicBezier、string、boolean 与 alias。复合类型会被清楚拒绝，不会静默错误转换。

## 本地验证与开发

需要 Node.js 22+：

```bash
cd design-system-steward
npm install
npm run test:all
```

测试覆盖只读审计、冲突停点、monorepo 边界、空白 scaffold、alias 错误、稳定 CSS 构建、生成物漂移，以及三端安装材料化。它不会调用 Figma 或改造 UI。

## 许可证与来源

本项目采用 [MIT](LICENSE)，版权为 `WYCM9527`。它从头实现，不复制 `ilikescience/design-tokens-skill` 的文字或脚本；如未来引入任何第三方 MIT 代码，必须保留其版权与许可证通知。

## 参考

- [DTCG Format 2025.10](https://www.designtokens.org/tr/2025.10/format/)
- [Agent Skills specification](https://agentskills.io/specification)
- [Codex Skills](https://developers.openai.com/codex/skills)
- [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [Cursor Skills](https://cursor.com/docs/skills)
- [Style Dictionary formats](https://styledictionary.com/reference/hooks/formats/)

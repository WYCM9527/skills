# Design System Steward

`design-system-steward` 是一个可 Git 版本化的 Agent Skill。它帮助你把一个**指定的 Web 项目**整理成可持续维护的 `design-system/`：先取证，再经人确认把设计决定写入 DTCG Tokens，并让后续 AI 有一条清楚的消费路径。

它不会不经确认改任何东西：不自动改页面、不发明 dark mode、不同步 Figma。想一次性统一存量硬编码时，走 `migrate` 的分层计划——先看只读报告，你确认档位后才动手，且要求 git 可回滚。

## 适合什么场景

- 项目已有 CSS variables、Tailwind、旧 Token、设计文档或多种遗留规范，想先弄清谁是权威来源。
- 主站有一个 Core 规范，专区或长期独立页面只在局部继承并覆写差异。
- 项目已有亮／暗模式，或明确要把一个已确认的模式纳入设计系统。
- 想让后续 AI 复用已批准的设计决定，并在真正出现新规则时先提出提案，而不是偷偷加一堆 Token。

## 安装

这是 Skill 源码包，不是 Codex Plugin，也不需要 Plugin manifest。先取得源码，再把它材料化到**项目级**目录；把下面路径替换为你的真实绝对路径。

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

安装器只写入通过 `--out` 指定的空目录。三端安装副本都保持显式调用：源码与渲染结果都带 `disable-model-invocation: true`；Codex 另外写入 `agents/openai.yaml`。它不会创建或修改项目规则文件。不要把只为单一宿主渲染的副本放进会被多个产品同时扫描的技能目录。

## 入门咒语

vibe coding、还不熟悉术语时，复制下面这一句，把路径换成你的项目：

```text
$design-system-steward setup，项目在 /absolute/project/path
```

它会先只读看现有样式写在哪，再用一份带推荐项的问卷问你；确认前不会改页面。

## 从第一天到日常：完整旅程

每次都要在请求中提供绝对项目根目录；在 monorepo 中要精确到一个 package。

**第一天——建立系统。** 运行 `setup`：只读审计现有样式，把全部闸门合成一份带档位（保守／推荐／激进）的问卷，答完后依次建立 Core／Scope／Theme。这一步只写 `design-system/`，不改任何页面，所以做完后项目视觉零变化——这是正常的，系统先有名分，再统一户口。

```text
$design-system-steward setup，项目在 /absolute/project/path
```

**第一周——统一存量。** 项目 90% 的旧代码还在用硬编码，AI 续写时会照抄旧写法。想一次性统一就运行 `migrate`：先给只读分层计划（可桥接多少旧变量、可替换多少硬编码、多少要你拍板），确认档位后分阶段执行，每阶段单独提交、自动生成 `MIGRATION.md` 对照与回滚指引。语义不明的值走 `settle` 逐组决定：归并、升级成新 Token，或写明理由豁免。

```text
$design-system-steward migrate --phase adopt
$design-system-steward migrate --phase replace
$design-system-steward migrate --phase settle
```

**日常——消费与守卫。** 批准三行项目规则写进 `AGENTS.md` 后，普通编码 Agent 会先读设计系统再改 UI。每次改动用 `change` 分流（内容更新／复用／需要提案／Drift），改完 UI 跑 `guard --changed` 复核；接入某个 Scope／Theme 到页面时走 `integrate` 的双确认。

```text
$design-system-steward change --target src/pages/Signup.tsx
$design-system-steward integrate --scope showcase
$design-system-steward guard
```

**随时——看进度。** 不知道下一步干什么时运行 `status`：它只读输出已纳管数量、剩余未统一数量、豁免数、Token 使用率百分比，和基于当前状态的下一步建议。

```text
$design-system-steward status
```

`audit`、`propose`、`change`、`experiment`、`status` 与 `guard` 永不改生产 UI；`apply` 只在确认后建立登记与 Token 源；`integrate` 与 `migrate --apply` 是仅有的两个可以改项目文件的动作，都要求先预览、再确认，后者还要求 git 工作区干净。面向用户的确认必须用生活语言和带理由的推荐项，见 [references/communication.md](references/communication.md)。

## 最终会得到什么

具体目录随项目已有证据和已确认范围而变化；一个带局部规范与 dark Theme 的项目可能是：

```text
design-system/
├── DESIGN.md
├── AUDIT.md
├── MIGRATION.md                    # 统一存量后：最近一次迁移对照与回滚指引
├── TRY.md
├── exemptions.json                 # 有意不纳管的登记册，每条必须有理由
├── scope-map.json
├── theme-map.json
├── tokens/                         # Core，也是确认的默认 Theme
├── scopes/showcase/
│   ├── SCOPE.md
│   └── tokens/                     # 仅相对父级的 delta
├── themes/dark/
│   ├── THEME.md
│   └── tokens/                     # 仅相对 Core 的 delta
├── style-dictionary.config.mjs
└── dist/
    ├── tokens.css
    ├── themes/dark.css
    └── index.css
```

不是每个项目都会有 Scope、Theme 或 Component Tokens。Core 一直代表默认主题；不会生成一份重复的 `themes/light/`。当前版本不自动生成 Scope × Theme 运行时组合，若某个局部规范覆写了在主题间变化的语义值，Guard 会要求人决定如何处理。

## 后续 AI 如何遵守它

这个 Skill 本身是显式调用的“管家”。建立系统后，可由它**提出**一个很短的项目规则；只有你批准后才写入已有 `AGENTS.md`、`CLAUDE.md` 或规则目录。普通编码 Agent 因此能先读取设计系统，再做日常 UI 修改。

日常文案、数据或图片内容更新不需要改设计系统。新增、跨页面复用或修订视觉决定时，Agent 应先提出 Token／Scope／Theme／组件例外提案；确认后更新来源、构建、Guard，再实现页面。一次性视觉差异先记为 Drift 或放入可回滚试验，不自动成为永久规则。具体契约见 [references/governance.md](references/governance.md)。

## 构建与校验

Skill 固定 Style Dictionary `5.5.2`。它使用经过 fixture 验证的 DTCG 2025.10 CSS Profile，**不是完整官方 JSON Schema 校验器**；支持范围见 [references/dtcg-profile.md](references/dtcg-profile.md)。

开发本 Skill 需要 Node.js 22+：

```bash
cd design-system-steward
npm install
npm run test:all
```

## 许可证与来源

本项目采用 [MIT](LICENSE)，版权为 `WYCM9527`。它从头实现，不复制 `ilikescience/design-tokens-skill` 的文字或脚本；若以后引入第三方 MIT 代码，必须保留原有版权与许可证通知。

## 参考

- [DTCG Format 2025.10](https://www.designtokens.org/tr/2025.10/format/)
- [Agent Skills specification](https://agentskills.io/specification)
- [Codex Skills](https://developers.openai.com/codex/skills)
- [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [Cursor Skills](https://cursor.com/docs/skills)
- [Style Dictionary formats](https://styledictionary.com/reference/hooks/formats/)

# Changelog

版本策略：patch 只改文档 / 描述 / 不改产物形态的修正；minor 新增脚本能力、改变起草判定或产物结构（同一网站重跑会得到不同的 token 名或值，条目里写清）；major 才改语义角色词表里已有角色的含义或删角色。版本号同时写在 `SKILL.md` frontmatter 与 `package.json`。

## 0.1.0 — 2026-09-21

由 [web-to-design-md](https://github.com/Paidax01/web-to-design-md) 魔改而来：取证方式沿用（agent-browser 在运行时读计算样式，不截图不抓源码），产物从一篇自由格式 DESIGN.md 换成按 Design-System 仓库 token 规范组织的设计系统种子。

- **取证 `extract-evidence.mjs`**：面向 token 的探针——颜色按 color / background / border 用途、面积、文字量、所落底色记账；字号 / 字重 / 行高 / 字距 / 字体族、间距 / 圆角 / 线宽 / 阴影 / 时长 / 缓动 / z-index / 透明度、控件高度、图标尺寸、header / 侧栏 / 容器、样式表断点与 `:focus-visible` 规则、根变量、主题线索；多视口（1440 / 1024 / 390）；暗色探测走两条路（`set media` + reload、给 `<html>` 加 class / data 属性并摘掉互斥类），页面底色明暗真的翻转才算拿到；悬停 / 焦点探针先禁用过渡再读状态，浏览器默认 `outline: auto` 不算证据。解析 rgb / hex / hsl / oklch / oklab / **lab / lch**（Chrome 会把 Tailwind v4 的颜色算成 lab）/ color(srgb | display-p3)。
- **起草 `draft-tokens.mjs`**：颜色按 OKLCH 分族（中性阈值随明度分段，状态浅底不会混进灰阶）× 明度档命名 Primitive，半透明按用途叫 `shadow-N / scrim / ring / mask / <档>-aNN`；品牌族要有该族实底按钮或得分够高才封为 `brand`；间距一律按 4px 阶梯命名（半步 `-5`）；阴影拆 y / blur / color 三件、过滤 Tailwind 的空阴影占位；按 159 个语义角色（`scripts/lib/roles.mjs`，与 Citrine 对齐，分 core / extended / shell）起别名，文字三档按对比度排序，每条 `$description` 以 `[观察]` / `[推断]` 开头；`--fill observed` 只写有证据的角色；拿到另一模式时生成 `themes/<id>/` delta 与 `theme-map.json`（class / data-attribute / media 三种激活）；输出 `audit-summary.md`（证据表 + 角色覆盖 + 缺口 + 警告）与 `draft-notes.json`。
- **写入 `scaffold-system.mjs`**：项目模式写 `design-system/`（tokens、themes、theme-map、scope-map、与 steward 相同的 style-dictionary 配置、DESIGN.md 模板带「待填写」、AUDIT.md 带推断 / 缺口清单、THEME.md 列出未覆写的随模式角色）；`--seed` 模式再写 `design-system.json` 身份文件（过 adopter schema）、纯 CSS 桥接 `bridge/base.css`、接线模板、README / CHANGELOG / package.json，`ds.mjs init --stack css` 可直接接入；`--tokens-only` 重同步 token 不动文档，`--force` 整目录重写。
- **验收 `check-contrast.mjs`**：默认模式与每个 Theme 的文字 / 底色配对对比度（正文 ≥ 4.5、UI ≥ 3、边线可辨 ≥ 1.3；半透明底先叠到页面底），失败退出 1，`--write` 出 markdown 报告。
- **预览 `render-token-board.mjs`**：token 驱动的自包含 HTML——语义色板按角色分组、Primitive 色族、字号 / 间距 / 圆角 / 线宽阶梯、三层阴影、只用语义变量拼的组件样例、全部 token 明细表（含各 Theme 列），带模式切换；`--css` 指向 dist 时看到的就是构建结果。
- **参考**：token 规范速查、语义角色词表（由 roles.mjs 生成）、证据 → token 映射规则（含「缺口怎么补」）、取证清单、浏览器引导；`assets/` 里的 DESIGN / AUDIT / THEME 模板与种子模板。
- **测试**：`node --test tests/*.test.mjs`——颜色数学、起草判定与 Theme delta、脚手架两种模式、steward `validate-system` / `build-tokens` / `guard`（有 steward 与 style-dictionary 时）、对比度、预览板、adopter 接入（附近有 adopter 时）、真实取证冒烟（有 agent-browser 时）。
- 已在真实站点 ui.shadcn.com 上跑通全链路（198 token、12 条暗色 delta、guard current）。

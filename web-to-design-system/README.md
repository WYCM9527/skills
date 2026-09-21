# web-to-design-system

从任意网站提炼一套按 Design-System 仓库 token 规范组织的设计系统种子：agent-browser 在真实渲染页面里读计算样式 → 起草 DTCG token（`color.<族>.<档>` 的 Primitive + 与 Citrine 对齐的语义角色）→ 人核对 → 写成 `design-system/`（DESIGN / AUDIT / theme-map / themes）→ design-system-steward 三绿 → 对比度基线 → token 预览板；可选打成带 `design-system.json` 的种子包（`--into-repo` 直接按 Design-System 仓库约定落位、`--with-citrine-bridges` 拷组件库桥接当起点、`--build` 出 dist），`publish-check.mjs` 过门禁后打 tag，design-system-adopter 一条命令接入并按 tag 升级。

它是 [web-to-design-md](https://github.com/Paidax01/web-to-design-md) 的魔改版：取证方式沿用，产物从「一篇 DESIGN.md」换成「能构建、能校验、能接入的 token 系统」。怎么用看 [SKILL.md](SKILL.md)。

## 布局

```text
web-to-design-system/
├── SKILL.md                       # 流程、硬边界、质量门
├── scripts/
│   ├── check-browser-tooling.mjs  # 预检 agent-browser / steward
│   ├── extract-evidence.mjs       # 取证：多视口 + 暗色探测 + 悬停 / 焦点探针 → 证据 JSON
│   ├── draft-tokens.mjs           # 起草：证据 → primitives / semantic / theme delta + audit-summary.md
│   ├── scaffold-system.mjs        # 写入：design-system/（--project）、整包种子（--seed）、按 Design-System 仓库约定落位（--into-repo）；--with-citrine-bridges、--build
│   ├── publish-check.mjs          # 发布前门禁：身份文件 / 六处版本 / upstream 路径 / 待填写 / [推断] / 对比度报告 / steward validate + guard
│   ├── check-bridge-vars.mjs      # 桥接引用但本系统没定义的变量
│   ├── check-contrast.mjs         # 对比度基线（默认模式 + 每个 Theme）
│   ├── render-token-board.mjs     # token 驱动的预览板（亮暗切换）
│   └── lib/                       # color（解析 / OKLCH / 对比度）、dtcg、palette、evidence、roles（角色词表 + 迁移对照）、bridges、repo、system、steward、args
├── assets/                        # DESIGN / AUDIT / THEME 模板、style-dictionary 配置、种子模式的身份文件 / 桥接 / 接线模板 / 系统级 README 模板
├── references/                    # token 规范速查、语义角色词表、映射规则、取证清单、浏览器引导
├── tests/                         # node --test：夹具证据 → 起草 → 脚手架 → steward 校验 / 构建
└── agents/openai.yaml
```

## 依赖

- Node ≥ 22；`agent-browser` 在 PATH（取证用）；design-system-steward ≥ 0.6.0（校验 / 构建 / Guard，`ds.mjs steward locate` 能找到）；构建时目标目录装 `style-dictionary@5.5.2`。
- 脚本本身零 npm 依赖。

## 测试

```bash
cd web-to-design-system && npm test        # = node --test tests/*.test.mjs
```

夹具是一份对本地 HTML 页面（含亮 / 暗两模式）的真实取证结果；测试覆盖颜色解析与对比度、起草的角色判定与 Theme delta、脚手架产物、steward `validate-system` 通过，以及（本机有 style-dictionary 时）构建 + guard current。

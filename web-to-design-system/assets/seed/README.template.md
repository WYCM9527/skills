# {{NAME}} 种子

版本 {{VERSION}} · 由 [web-to-design-system](https://github.com/WYCM9527/skills/tree/main/web-to-design-system) 从 {{SOURCES}} 实测提炼（{{DATE}}）· 纯数据包：本目录即分发单元（文件夹直接下载，或发布为 npm 包 `{{NPM}}`），身份文件 `design-system.json`，接入 / 更新由 [design-system-adopter](https://github.com/WYCM9527/Design-System/tree/main/design-system-adopter) skill 驱动 · 变更见 [CHANGELOG.md](CHANGELOG.md)

> **这是从网站提炼出来的起点，不是定稿。** `tokens/semantic.tokens.json` 里 `$description` 以 `[推断]` 开头的角色是按规则补的默认值，`design-system/AUDIT.md` 列出了全部推断与缺口；接入项目前逐条确认，`DESIGN.md` 里写着「待填写」的段落必须补齐。发布前跑 `publish-check.mjs --seed <本目录>`。

## 里面有什么

```text
design-system/
├── DESIGN.md                       # 设计意图与规则（不含数值）
├── AUDIT.md                        # 证据、推断、缺口、对比度基线、桥接缺口、风险
├── tokens/primitives.tokens.json   # 值：color.<族>.<明度档>、spacing.<px/4>、radius / font / size / border / shadow / duration / easing / z / opacity
├── tokens/semantic.tokens.json     # 用途：color.action / text / bg / border / status …、text.* 阶梯、control.height.*、layout.*、elevation.*、motion.*、layer.*
{{THEME_TREE}}├── scope-map.json                  # 空；局部规范在目标项目里按证据登记
├── style-dictionary.config.mjs     # 与 design-system-steward 脚手架相同
└── dist/                           # 构建产物，随种子提交：纯 CSS 渠道 ds.mjs export 直接读它；接入项目里 steward 会按工作副本重建
{{BRIDGE_TREE}}templates/                          # 接线模板：entry-*.css（样式入口）、notes-*.md（接线要点）、AGENTS.md（项目规则模板）
migration/roles.json                # 旧规范 → 新 token 的角色对照（adopter「更换现有规范」的 settle 阶段用），hints 里的旧变量名 / 色值待维护者补
design-system.json                  # 身份文件：id / 版本 / upstream / 栈 / owned 清单——adopter skill 靠它识别与更新
package.json                        # 包定义：exports 暴露 bridge/* 与 design-system/*
```

## 用法

```bash
# 装好 design-system-adopter 之后，把本目录放进项目任意位置（或 npm i {{NPM}}），然后：
node .cursor/skills/design-system-adopter/scripts/ds.mjs init --system {{ID}} --stack {{DEFAULT_STACK}}
# init 做的事：落成只读快照 design-systems/{{ID}}/ → 生成工作副本 design-system/ → 写 .adopter.json → 打印样式入口与接线步骤
# 然后 steward：validate-system → build-tokens（需要 style-dictionary@5.5.2）→ guard 应为 current
```

可用的栈：{{STACK_LIST}}。样式入口见 `templates/entry-*.css`；项目自己的样式只引用 `var(--color-*)` / `var(--spacing-*)` 等变量。

## 从旧规范迁移

按角色对照，不按色值找近似：`migration/roles.json` 把「正文色 / 边线 / 页面底 / 主色按钮 / 状态色 / 链接 / 边线宽 / 圆角 / 字号 / 间距 / 控件高 / 阴影」映射到本系统的 token 名。流程：项目先提交一次 → adopter `init`（旧 `design-system/` 改名当证据）并 `build-tokens` → steward `audit` → 有旧变量才 `migrate --phase adopt` → `replace` → `settle`（adopter 用这份对照起草决策文件，确认后 `--apply`）→ 豁免登记 → `guard` / `status` 两绿。旧系统独有、新系统没有对应物的东西写进 `noEquivalent`。

## 这套 token 怎么来的

1. `extract-evidence.mjs` 用 agent-browser 打开来源页面，在运行时里统计颜色（按用途 / 面积 / 文字量 / 所落底色）、字号 / 字重 / 行高、间距、圆角、线宽、阴影、时长 / 缓动、z-index、控件高度、断点、根变量，并做暗色探测与悬停 / 焦点探针。
2. `draft-tokens.mjs` 把颜色按 OKLCH 分族分档命名，其余按阶梯归档，再按与 Citrine 对齐的语义角色词表起别名；每个别名的 `$description` 写明是 `[观察]` 还是 `[推断]`。
3. 人 / Agent 按 `AUDIT.md` 逐角色核对，补齐 `DESIGN.md`，跑 steward 三绿。

## 版本策略

描述 / 文档修正是 patch，新增或修改 token 是 minor（页面像素会变），重命名 / 删除是 major。仓库只打 `{{ID}}-vX.Y.Z` 一种 tag；adopter 的 `status / upgrade` 靠这个 tag 前缀找新版本。

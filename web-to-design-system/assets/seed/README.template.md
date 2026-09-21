# {{NAME}} 种子

版本 {{VERSION}} · 由 [web-to-design-system](https://github.com/WYCM9527/skills/tree/main/web-to-design-system) 从 {{SOURCES}} 实测提炼（{{DATE}}）· 纯数据包：本目录即分发单元（文件夹直接下载，或发布为 npm 包 `{{NPM}}`），身份文件 `design-system.json`，接入 / 更新由 [design-system-adopter](https://github.com/WYCM9527/Design-System/tree/main/design-system-adopter) skill 驱动 · 变更见 [CHANGELOG.md](CHANGELOG.md)

> **这是从网站提炼出来的起点，不是定稿。** `tokens/semantic.tokens.json` 里 `$description` 以 `[推断]` 开头的角色是按规则补的默认值，`design-system/AUDIT.md` 列出了全部推断与缺口；接入项目前逐条确认，`DESIGN.md` 里写着「待填写」的段落必须补齐。

## 里面有什么

```text
design-system/
├── DESIGN.md                       # 设计意图与规则（不含数值）；「待填写」段落待补
├── AUDIT.md                        # 证据、推断、缺口、对比度基线、风险
├── tokens/primitives.tokens.json   # 值：color.<族>.<明度档>、spacing.<px/4>、radius / font / size / border / shadow / duration / easing / z / opacity
├── tokens/semantic.tokens.json     # 用途：color.action / text / bg / border / status …、text.* 阶梯、control.height.*、layout.*、elevation.*、motion.*、layer.*
{{THEME_TREE}}├── scope-map.json                  # 空；局部规范在目标项目里按证据登记
├── style-dictionary.config.mjs     # 与 design-system-steward 脚手架相同
└── dist/                           # 空，在目标项目里构建
bridge/base.css                     # 基础桥接（纯 CSS 栈）：body / 标题 / 链接 / 表单控件 / 焦点 / 减少动态效果，只引用变量
templates/                          # 接线模板：entry-css.css（样式入口）、notes-css.md（接线要点）、AGENTS.md（项目规则模板）
design-system.json                  # 身份文件：id / 版本 / upstream / 栈 / owned 清单——adopter skill 靠它识别与更新
package.json                        # 包定义：exports 暴露 bridge/* 与 design-system/*
```

## 用法

```bash
# 装好 design-system-adopter 之后，把本目录放进项目任意位置（或 npm i {{NPM}}），然后：
node .cursor/skills/design-system-adopter/scripts/ds.mjs init --system {{ID}} --stack css
# init 做的事：落成只读快照 design-systems/{{ID}}/ → 生成工作副本 design-system/ → 写 .adopter.json → 打印样式入口与接线步骤
# 然后 steward：validate-system → build-tokens（需要 style-dictionary@5.5.2）→ guard 应为 current
```

样式入口见 `templates/entry-css.css`；项目自己的样式只引用 `var(--color-*)` / `var(--spacing-*)` 等变量。项目用了组件库（Element Plus / shadcn / Ant Design…）时，组件默认外观不会自动跟随 token——需要一份逐组件接管的桥接，那是系统层工作，按 Citrine 的 `bridge/element-plus.css` 做法补。

## 这套 token 怎么来的

1. `extract-evidence.mjs` 用 agent-browser 打开来源页面，在运行时里统计颜色（按用途 / 面积 / 文字量 / 所落底色）、字号 / 字重 / 行高、间距、圆角、线宽、阴影、时长 / 缓动、z-index、控件高度、断点、根变量，并做暗色探测与悬停 / 焦点探针。
2. `draft-tokens.mjs` 把颜色按 OKLCH 分族分档命名，其余按阶梯归档，再按与 Citrine 对齐的语义角色词表起别名；每个别名的 `$description` 写明是 `[观察]` 还是 `[推断]`。
3. 人 / Agent 按 `AUDIT.md` 逐角色核对，补齐 `DESIGN.md`，跑 steward 三绿。

## 版本策略

描述 / 文档修正是 patch，新增或修改 token 是 minor（页面像素会变），重命名 / 删除是 major。仓库只打 `{{ID}}-vX.Y.Z` 一种 tag。

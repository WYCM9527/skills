# Changelog

版本策略：patch 只改文档 / 描述 / 不改产物形态的修正；minor 新增脚本能力、改变起草判定或产物结构（同一网站重跑会得到不同的 token 名或值，条目里写清）；major 才改语义角色词表里已有角色的含义或删角色。版本号同时写在 `SKILL.md` frontmatter 与 `package.json`。

## Unreleased（待做，2026-09-22 记录）

- **默认 `description` 不该是用户决策**：`scaffold-system.mjs` 不传 `--description` 时写成「<名称>：从 <URL> 实测提炼的设计系统。」，这句会落到根 README 表格「定位」列、`design-system.json`、`<id>/README.md`、`package.json`。改为从 `draft-notes.json` 拼一句能直接上表的定位（来源域名 · 主操作色与色族 · 有无另一模式 · 栈与桥接状态），并把 SKILL「6. 发布到 Design-System 仓库」里「写进仓库前问用户 `--description`」改成「Agent 按证据起草定位，给用户过目即可」。
- **npm 发布不在 skill 里决定**：提炼出的种子继续默认不带 `publishConfig`（只走文件夹 / Release 直链渠道，adopter 接入与按 tag 升级都不依赖 registry）；何时值得上 npm 的判据记在 Design-System 仓库 GUIDE 8c 第 8 步，`release.yml` 已会自动识别 `publishConfig`。

## 0.3.0 — 2026-09-22

用三个真实站点做端到端验证（Element Plus 中文文档三页合并 · Bootstrap 文档 `data-bs-theme` 属性暗色 · Linear 官网暗色为默认）后修的判定与探测问题；同一站点重跑会得到不同的色档名与角色值，所以是 minor。

- **中性色阈值按真实数据重标**：近白段（L ≥ 0.955）0.010、0.90～0.955 段 0.016——Element 的 `*-light-9` 状态浅底（`#fdf6ec` / `#f0f9eb` / `#ecf5ff` / `#fef0f0`）与 Tailwind 50 档不再混进 neutral，而 `#f5f7fa` / `#e5eaf3` / `#e2e8f0` 这类真浅灰仍是 neutral。
- **调色板先合并同族近似色再命名**（OKLab ΔE < 0.012，近白 / 近黑与灰阶一起比），`#f5f7fa` 与 `#f4f4f5` 合成一个 Primitive；撞档优先落到 25 的倍数（125 / 175 / 425），不再出现 105 / 110 / 115。
- **暗色探测方向修正**：站点首屏已是暗色时切「light」而不是再切「dark」；data 属性候选优先 `<html>` 上已有的（`data-theme="dark"`）与框架常用名，不再被 toast 库的 `data-sonner-theme` 抢走；主题选择器正则放宽到任何 `data-*theme|mode|scheme*`（`data-bs-theme`、`data-color-mode`…）。Linear 由此拿到 `themes/light` 12 条 delta、`theme-map` 默认 `dark`。
- **根变量上限 400 → 1200**（Element + VitePress 上千个变量，`--el-color-warning-light-9` 曾被截掉），窄屏 / 手机的布局探针不再重复收集。
- **输入框边线兼容 `inset box-shadow`**（Element / shadcn 的做法）；占位符色与文字色相同视为未设置（el-select 的只读输入框）。
- **文字三档与边线允许半透明色**（Bootstrap 的 `rgba(33,37,41,.75)`、Linear 的 `rgba(255,255,255,.08)` 分隔线），alias 指向带 alpha 的 Primitive，对比度按叠底算。
- **正文内链接排除导航区**（侧栏 / 目录里的 `li > a` 不再算内容链接）；页面容器只认 ≥ 720px 且取整（此前取到 541.57px 的文字列）。
- 根变量线索补 Bootstrap（`--bs-success` / `-bg-subtle`）与 VitePress（`--vp-c-*`）的命名。
- 拷了桥接的种子 `package.json` 补 `./vue/*`、`./react/*`、`./echarts`、`./iconpark.config` 的 exports 与来源种子的可选 peerDependencies——接线要点里的 `@scope/id/vue/KitchenSink.vue` 才能解析。
- 测试 20 项：新增中性阈值边界、近似色合并与撞档命名两组单测；夹具证据按新探针重生成。验证结论：三站均过 steward validate / build / guard，对比度报告准确命中 Element Plus 已知的 AA 不达项（白字压 `#409EFF` 2.78:1）。

## 0.2.0 — 2026-09-21

面向「提炼 → 进 Design-System 仓库 → adopter 分发给任何人 → 按 tag 升级」这条路补齐发布链。

- **`scaffold-system.mjs --into-repo <仓库根>`**：按 Design-System 仓库约定写到 `<id>/seeds/<seed-name>/`；`upstream.repo` 从仓库 git 远端推出（与 `--repo` 不一致即报错）、`upstream.path` 等于实际子路径（与 `--path` 不一致即报错）、`tagPrefix = <id>-v`、`npm = @<owner>/<id>`；另写系统级 `<id>/README.md`（版本行 `版本 **x.y.z**`）并在仓库根 README 的「| 设计系统 | 定位 | 版本 |」表格里追加 / 更新一行。种子模式（`--seed`）在 git 仓库里时也按同样规则推 `repo / path`。
- **`--build`**：在种子目录跑 steward `build-tokens`（没有 style-dictionary 就 `npm i --no-save` 一份），`dist/` 随种子提交——纯 CSS 渠道 `ds.mjs export` 直接读它；种子 README 模板的「dist 在目标项目里构建」措辞改正。
- **`migration/roles.json`**：从角色词表生成旧规范 → 新 token 的角色对照（33 条，含 Primitive 的 `radius.*`），身份文件加 `migration` 字段与 `owned`；adopter「更换现有规范」的 settle 阶段能用。`hints` 只放通用词，旧系统独有的变量名 / 色值由维护者补。
- **`--with-citrine-bridges <Citrine 种子>`**：拷入 `bridge/`（Element Plus / shadcn / recipes / ECharts / IconPark / Vue & React 配方组件）当起点，不覆盖本 skill 的 `base.css`；身份文件并入 `element-plus` / `shadcn` 两个栈（entry / extra / components / scaffold / detect 沿用，snippet / notes 换成本 skill 的通用模板）与 `export.optional`；扫出**桥接引用但本系统没定义的 CSS 变量**（排除组件库前缀与桥接内部变量）写进 AUDIT「桥接缺口」表，每行待决定「补 token / 删规则」。独立命令 `check-bridge-vars.mjs --system … --bridge …`。
- **`publish-check.mjs --seed <种子>`**：发布前门禁——身份文件完整且引用文件都在、`package.json name = upstream.npm`、版本号六处一致（design-system.json / package.json / CHANGELOG / 种子 README / `<id>/README.md` / 根 README 表格）、`upstream.path / repo` 与真实位置与远端一致、tag 未重复、DESIGN.md 无「待填写 / 待确认」、token 无未确认 `[推断]`（`--allow-inferred` 降为警告）、AUDIT 贴了对比度报告、steward `validate-system` 通过、`dist/` 已构建且 `guard` current；对比度失败与桥接缺口未决作警告。
- SKILL 新增「6. 发布到 Design-System 仓库」与三条硬边界（发布不绕门禁、桥接是起点不是成品、不碰第三方资产）；`lib/steward.mjs` 多一处「本 skill 的兄弟目录」候选，与 steward 并列安装时直接找到。
- 测试 18 项：新增发布模式端到端（模拟仓库 + 远端 + 根 README 表格 → `--with-citrine-bridges --build` → 门禁三项预期不通过、`--allow-inferred` 后两项）。

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

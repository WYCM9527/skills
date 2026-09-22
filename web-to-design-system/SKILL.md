---
name: web-to-design-system
description: 从任意网站（一个或多个 URL）用浏览器实测证据提炼一套按本仓库 token 规范组织的设计系统种子——DTCG 2025.10 CSS Profile 的 primitives / semantic token、与 Citrine 对齐的语义角色词表、Core + Theme delta、design-system/ 目录、DESIGN.md（只写意图）与 AUDIT.md（观察 / 推断 / 缺口 / 对比度），能过 design-system-steward validate / build / guard，可选打成带 design-system.json 的种子包供 design-system-adopter 接入。用户说「把这个网站做成设计系统 / 提炼 XX 网站的 token / 按我们的规范抓一套设计系统 / web to design system / 参考这个站起一套规范」时使用。不用于：接入已发布的设计系统（design-system-adopter）、治理项目自身规范或迁移存量（design-system-steward）、只想要一份自由格式 DESIGN.md（原 web-to-design-md）。
metadata:
  version: "0.7.0"
---

# Web to Design System

把一个真实网站读成一套**能构建、能校验、能接入**的设计系统种子，而不是一篇设计语言散文。它是 [web-to-design-md](https://github.com/Paidax01/web-to-design-md) 的魔改版：取证方式沿用（agent-browser 在运行时里读计算样式，不截图不抓源码），产物换成本仓库的 token 规范——与 Citrine 同一套目录、同一套用途名、同一套校验器。

## 30 秒心智模型

- **取证**：网站的每个可见元素都在说自己用了什么颜色 / 字号 / 间距，脚本把这些话按用途、面积、文字量、所落底色记账。
- **起草**：颜色按色族 × 明度分档起名（Primitive），再按角色词表说「这个颜色是主按钮」（Semantic）。机器只做机械的部分，每条别名都写明是 `[观察]` 还是 `[推断]`。
- **系统类型**：这套规范给什么类型的产品用。类型是可定义的数据（[references/system-types.md](references/system-types.md)）：内置 `website` 通用网站、`product` 产品应用、`admin` 中后台，公司可在 Design-System 仓库 `system-types/<id>/` 加自己的（文档站、电商、H5…）。它决定哪些角色必须处理、允许推断哪些、DESIGN 用哪套配方词汇、要不要组件库桥接；一个官网不会被写成中后台底座。
- **核对**：Agent 逐角色核对草稿、补缺口、纠正判断，写 DESIGN.md 的意图段落——这一步不能省，机器的推断只是有依据的默认值。
- **虚拟项目**：用刚提炼的系统渲染几张真实网页（按系统类型：落地页 / 内容页 / 联系页，或登录 / 列表 / 表单，或工作台 / 表单 / 抽屉），与来源站首屏并排给人看——组合关系（三档底色与文字压在一起、主按钮、品牌色出现的位置、字号节奏、留白）在色块清单上看不出来，在页面上一眼能看出来。起草后看一次纠正判定，写入后再走真实接入路径看一次。
- **写入 + 三绿**：落成 `design-system/`，交给 steward `validate → build → guard`，再跑对比度基线。
- **可选种子包**：加身份文件与基础桥接，adopter 一条命令接进任何项目。

## 与原 web-to-design-md 的差别

| | web-to-design-md | web-to-design-system |
| --- | --- | --- |
| 产物 | 一份自由格式 DESIGN.md + markdown 渲染的预览 | `design-system/`（DTCG token + theme-map + DESIGN / AUDIT / THEME）+ token 驱动的预览板 + 可选种子包 |
| 颜色 | 散文里的 hex | `color.<族>.<档>` 结构化 sRGB + hex，语义层全是 alias |
| 用途名 | 每次现编 | 固定词表（161 个角色，与 Citrine 对齐），按系统类型（可定义：website / product / admin / 公司自定义）列「必须处理」与「可选」 |
| 暗色 | 文字描述两种模式 | `themes/<id>/` delta + `theme-map.json`，没证据不造 |
| 验证 | 人读一遍 | steward 三绿 + `check-contrast.mjs` 对比度基线 |
| 接入 | 复制粘贴 | `ds.mjs init --system <种子> --stack css` |

## 浏览器规则

- 只用 `agent-browser`：`open` → `wait --load networkidle` → `set viewport` / `set media` → `eval --stdin` → `hover` / `focus`。缺失时按 [references/browser-tooling.md](references/browser-tooling.md) 安装或暴露，不静默换 Playwright / fetch / 截图。
- 证据 = 运行时计算样式、样式表规则、根变量、交互状态差；截图只在 DOM 证据自相矛盾时人工瞄一眼。
- 不越过登录墙、不发明看不见的页面；登录态用 `--session <name> --restore` 手动登录后复用。

## 流程

### 0. 预检与定题

```bash
node <本 skill>/scripts/check-browser-tooling.mjs <项目目录>
```

先向用户确认四件事（按 steward 的[提问契约](../design-system-steward/references/communication.md)：生活语言、带推荐项、一次 ≤ 4 题）：

1. **系统 id 与名称**（kebab id 会成为快照目录名与 tag 前缀）。
2. **落到哪**：项目模式（写进某项目的 `design-system/`，之后由 steward 治理）还是种子模式（独立目录 + `design-system.json`，供多个项目接入）。默认推荐项目模式；要发给别的项目用再选种子。
3. **系统类型**：这套规范将来给什么用。先 `node <本 skill>/scripts/list-types.mjs` 列出当前可用的类型（内置 `website` 通用网站 / `product` 产品应用 / `admin` 中后台 + 仓库 `system-types/` 里公司自定义的），把 label 与一句话原样念给用户选；推荐项按站点本身给（官网 → 通用网站）。用户要拿一个官网的视觉去做产品或后台时才选 product / admin，此时缺口会多、AUDIT 要写清哪些是借的。起草脚本也会从证据推断一遍原型，两者不一致要说。想要的类型不存在 → 按 [references/system-types.md](references/system-types.md) 在仓库 `system-types/<id>/` 定义一个（extends 最接近的内置类型，增删角色），再继续。
4. **取哪些页面**：按类型定义里的 `pages`（`list-types.mjs` 会打印）推荐 2～4 个 URL，细则见 [references/extraction-checklist.md](references/extraction-checklist.md)「0. 选页面」。用户只给一个也能跑，缺口会多。

### 1. 取证

```bash
node <本 skill>/scripts/extract-evidence.mjs <url> [<url> …] --out /tmp/<id>-evidence.json
#   [--viewports 1440x900,1024x768,390x844] [--no-dark] [--no-hover] [--no-responsive] [--session <name>]
```

输出一行摘要（几种颜色、几档字号、首屏明暗、是否拿到另一模式、悬停样本数）。证据 JSON 放系统临时目录，不进项目。每个 URL 打开后会 reload 一次再测（同源 hash 路由的 `open` 不重载文档，上一页留下的视口 / class / 悬停状态会污染证据）。SPA 的路由靠点导航拿：先 `snapshot -i` 看菜单项，点一遍记下 `location.hash`，兜底页（各路由节点数一样）不要。

### 2. 起草

```bash
node <本 skill>/scripts/draft-tokens.mjs --evidence /tmp/<id>-evidence.json --out /tmp/<id>-draft --id <id> --name "<名称>"
#   [--brand #hex]（品牌族判错时指定） [--min-count 2] [--fill inferred|observed]（observed = 只写有证据的角色）
#   [--unit auto|px|rem]（默认 auto：根字号偏离 16px 超过 2px 的站点按 rem 起草，见下）
#   [--type auto|<类型 id 或别名>]（系统类型；默认 auto 从证据推断到 website / product / admin 之一——把预检确认的那个显式传进来）
#   [--types-dir <dir>[,<dir>]]（自定义类型目录；仓库根的 system-types/ 会自动发现）
```

- `--type` 决定「必须处理的缺口」与「允许推断的角色」，口径来自类型定义（[references/system-types.md](references/system-types.md)）：`website` 只要基础集（底 / 文字 / 操作 / 边线 / 焦点 / 留白 / 排版 / 布局 / 动效 / 层级），状态色、危险色、选中态、骨架屏、表格、壳层都归「可选」，没证据就不填也不推断；`product` 要 core 全集；`admin` 连 shell 一起要；自定义类型按它的 type.json。auto 的判据：侧栏 + 表格 → admin；单页 ≥ 4 个输入框 / 选择勾选类控件 / ≥ 3 个状态徽标 / 状态类根变量 / 多页有表格 → product；否则 website。自定义类型不会被自动推断出来，要显式传。

- `--brand` 只定品牌族与品牌角色（`color.brand.indicator` / `bg.brand` / `text.brand`）；`color.action.primary` 仍跟按钮证据走——深底站点主按钮常是白的，品牌色只做焦点，两者要分开。
- **rem 站点**：`html` 根字号被 JS 设成 `100vw / N` 的站点（1440 宽下 9px 之类），px 值全是「根字号 × rem」的乘积，按 px 起草没有意义。auto 模式会把字号 / 间距 / 圆角 / 控件高 / 阴影 / 布局尺寸换算成 rem，间距按 `spacing.<rem×100>` 命名，根字号记成 `size.root-font` = `layout.root.font-size`；边线宽、断点保留 px。摘要会提醒「接入项目必须复刻根字号规则」。各页根字号不一致会警告——那是站点 resize 脚本的 bug 污染了证据，重新取证。

产物：`tokens/primitives.tokens.json`、`tokens/semantic.tokens.json`、（有证据时）`themes/<id>/tokens/semantic.tokens.json` + `theme-map.json`、`audit-summary.md`、`draft-notes.json`。**先读 `audit-summary.md`**，规则在 [references/mapping-rules.md](references/mapping-rules.md)。

### 3. 核对（Agent 的工作，不能跳）

按 [references/semantic-roles.md](references/semantic-roles.md) 逐组核对草稿，直接改 `/tmp/<id>-draft/tokens/*.json`：

- **判错的观察**：品牌族错了 → `--brand` 重跑（看首屏截图定：hero 大字 / 主按钮 / 光效用的那个有彩色才是品牌，进度点、装饰粒子不是）；正文色 / 卡片底选错 → 改 alias。
- **逐字动画站点**：标题被拆成单字 `<span>` 时元素数会灌大——正文字号、行高、字重都按承载字数选，但仍要对着 `audit-summary.md` 的字号表核一眼「正文 = 承载最多字的字号」是不是真的正文。
- **批量补缺口时写一次性脚本**（放系统临时目录，不进种子）：import 本 skill 的 `scripts/lib/dtcg.mjs` / `color.mjs`，用 `setPath` 加 Primitive 与别名、`composite` 算 14% 预混浅底、`contrastRatio` 验对比；同时同步 `draft-notes.json` 的 `roles` / `missing` / `counts`，scaffold 生成的 AUDIT 才和 token 一致。
- **推断项**：能从证据确认的把 `[推断]` 改 `[确认]`；不同意的改 alias；拿不准的留着（AUDIT 会列出来）。
- **缺口**：`audit-summary.md`「必须处理的缺口」按系统类型列出，三选一——补证据（换页面再取）/ 按规则推断并标注 / 写明本系统不需要；「可选角色未填」有证据再填，**不为它们发明值**（品牌站不要借中后台的侧栏宽、表格内边距、状态色来把词表填满）。
- **品牌决定要问用户**（≤ 4 题，带推荐项）：选中态用品牌色还是反转块、链接靠色相还是下划线、暗色是否纳管（拿到了另一模式才问）、状态色缺证据时是否借公司调色板。
- 不改 Primitive 的值去「美化」——值是观察到的；要调（比如对比度不够压深）在 `$description` 写明原值与原因。
- **先看一眼再改**：`node <本 skill>/scripts/render-preview.mjs --draft /tmp/<id>-draft --evidence /tmp/<id>-evidence.json --out /tmp/<id>-preview --shots`（内联解析值，不用构建；直角系统加 `--radius-control none --radius-card none`），打开 `index.html` 对着「看图清单」过——表面判成白、正文判成黑、主按钮该白还是该品牌色、留白太小，这些在页面上一眼就看出来。改完草稿重渲，满意再写入。

### 4. 写入

```bash
# 项目模式：写进某个项目，之后由 steward 治理
node <本 skill>/scripts/scaffold-system.mjs --from /tmp/<id>-draft --project <项目目录> --id <id> --name "<名称>"
# 种子模式：独立目录，adopter 可 init
node <本 skill>/scripts/scaffold-system.mjs --from /tmp/<id>-draft --seed <种子目录> --id <id> --name "<名称>" --repo <owner/repo> --path <子路径> --npm <@scope/id>
# 发布模式：按 Design-System 仓库约定写到 <仓库根>/<id>/seeds/<id>/，upstream 由仓库远端与实际路径推出，并写 <id>/README.md + 根 README 表格行
node <本 skill>/scripts/scaffold-system.mjs --from /tmp/<id>-draft --into-repo <Design-System 仓库根> --id <id> --name "<名称>" --description "<一句定位>" \
  --with-citrine-bridges <仓库根>/citrine/seeds/brand-yellow-e --build
#   --with-citrine-bridges：拷 Element Plus / shadcn / recipes / ECharts 桥接与配方组件当起点，并把「桥接引用但本系统缺的变量」写进 AUDIT「桥接缺口」
#   --build：在种子目录跑 steward build-tokens，dist/ 随种子提交（纯 CSS 渠道 export 直接读它）
#   已有 design-system/ 时：--tokens-only 只重同步 token（不动 DESIGN / AUDIT），--force 整目录重写
```

然后**写 DESIGN.md**：把模板里每处「待填写 / 待确认」换成从证据读出来的规则——只写角色名与规则，不写数值（数值在 token）。写完 `rg "待填写|待确认" design-system/DESIGN.md` 应为 0。AUDIT.md 的推断清单与缺口清单由脚本填好，补「对比度基线」「未纳管项」「风险与待确认」三段；拷了桥接的还要把「桥接缺口」每行的「待决定」改成「补 token」或「删规则」并落实。`migration/roles.json` 的 `hints` 里补上旧系统独有的变量名与色值，`noEquivalent` 按 DESIGN 填。

### 5. 三绿 + 对比度 + 预览 + 虚拟项目

```bash
node <steward>/scripts/validate-system.mjs --project <目录>
(cd <目录> && npm i -D --no-save style-dictionary@5.5.2)
node <steward>/scripts/build-tokens.mjs --project <目录>
node <steward>/scripts/guard.mjs --project <目录>                      # 应为 current
node <本 skill>/scripts/check-contrast.mjs --system <目录>/design-system --write <目录>/design-system/contrast.md
node <本 skill>/scripts/render-token-board.mjs --system <目录>/design-system --out <目录>/design-system/token-board.html --css dist/index.css
node <本 skill>/scripts/render-preview.mjs --system <目录>/design-system --evidence /tmp/<id>-evidence.json --shots [--via-adopter]   # 虚拟项目：真实页面 + 来源站首屏对照
```

虚拟项目（`render-preview.mjs`）写到 `design-system/preview/`：按系统类型的 `preview` 页面列表渲染 HTML（只引用 token 变量，颜色角色缺失露出洋红），链接 `dist/index.css` + `bridge/base.css`（`--via-adopter` 改为走 adopter `export` 的交付物），agent-browser 截 1440 / 390 与每个 Theme，`index.html` 是对照页（来源站首屏 vs 虚拟页 + 看图清单）。把 `index.html` 的路径与截图给用户看，让用户按清单判断「提炼得像不像」；HTML 随种子提交，`shots/` 与 `static/` 不进仓库（.gitignore 已写）。页面模板随类型定义走（`assets/types/<id>/preview/`，自定义类型可带自己的页面）。

steward 位置：`node <adopter>/scripts/ds.mjs steward locate`（脚手架结束时也会打印）。对比度失败项：改值或由用户拍板登记例外（AUDIT + DESIGN「已批准的例外」，附回补路径）。预览板用 agent-browser 打开亮暗各看一眼，暗色下露出后备值的角色就是 Theme delta 的缺口。

种子 / 发布模式再多一步验证：`node <adopter>/scripts/ds.mjs init --system <种子目录> --stack css --project <临时项目>` 能接入、`agents --stack css` 能渲染。

### 6. 发布到 Design-System 仓库（发布模式）

系统进仓库后就是「公司的一套设计系统」，任何人都能用 adopter 接入并按 tag 升级，所以有一道门禁：

```bash
node <本 skill>/scripts/publish-check.mjs --seed <仓库根>/<id>/seeds/<id>        # 全 ✔ 才能发；0.x 想带着 [推断] 先发就加 --allow-inferred
```

它查：身份文件完整、引用的文件都在；版本号在 `design-system.json` / `package.json` / CHANGELOG / 种子 README / `<id>/README.md` / 根 README 表格六处一致；`upstream.path / repo / tagPrefix` 与真实位置一致；DESIGN.md 无「待填写」；token 无未确认 `[推断]`；AUDIT 贴了对比度报告；steward `validate-system` 通过、`guard` current（dist 已构建）。通过后：提交 → 打 tag `<id>-vX.Y.Z` → 推送，仓库的 `release.yml` 会建 Release（说明取 CHANGELOG 段落，附件 = 种子 npm pack + 纯 CSS 包）。之后每次改 token：升版本、写 CHANGELOG、`--tokens-only` 重同步、`--build`、`publish-check`、再打 tag。

写进仓库前问用户两件事：`--description`（根 README 表格里的一句定位，别让脚本默认的「从 URL 实测提炼」句子上表）；要不要 `--with-citrine-bridges`——**只对类型定义 `bridges: true` 的（内置的 product / admin）提这个问题**：Element Plus / shadcn 桥接带着中后台的组件假设（表格、侧栏、状态胶囊、三档控件高），品牌 / 内容站拷进来只会多出一堆要借值才能填的缺口，纯 CSS 接入（`bridge/base.css`）就够。拷了就要在接入前处理「桥接缺口」。

## 输出契约

```text
<目录>/design-system/
├── DESIGN.md                        # 意图与规则；「待填写」清零
├── AUDIT.md                         # 来源、观察 / 推断 / 缺口、对比度、未纳管、风险
├── tokens/primitives.tokens.json    # [观察] 描述带用途与出现次数
├── tokens/semantic.tokens.json      # 别名；描述以 [观察] / [推断] / [确认] 开头
├── scope-map.json                   # 空
├── theme-map.json + themes/<id>/    # 仅当取到另一模式
├── style-dictionary.config.mjs
├── preview/                         # 虚拟项目：按系统类型的真实页面 + index.html 对照页（shots/ 不进仓库）
├── dist/                            # steward 构建
├── contrast.md                      # check-contrast 报告（可选留档）
└── token-board.html                 # 预览板（可选留档）
种子 / 发布模式另有：design-system.json · bridge/base.css（+ 拷入的组件库桥接）· templates/{entry-*.css,notes-*.md,AGENTS.md} · migration/roles.json · README.md · CHANGELOG.md · package.json · .gitignore
发布模式另写：<仓库根>/<id>/README.md（系统级概览，版本行 `版本 **x.y.z**`）与根 README 表格一行 `| [**<名称>**](<id>/) | <定位> | x.y.z |`
```

目标目录里不留证据 JSON、草稿、临时 notes；它们在 `/tmp`。

## 硬边界（违反即错）

- **格式**：颜色必须是结构化 sRGB + 一致的 hex；尺寸 / 时长是 `{ value, unit }`；阴影拆三件；渐变不进 token；alias 类型一致。任何一条错 `validate-system` 都会红。
- **分层**：Semantic 全是 alias，不直接写值；不建 `components.tokens.json`，除非用户批准了具体组件例外。
- **用途名**：优先落到词表角色；新名字要在 AUDIT 说明。不改词表里已有角色的含义。
- **不发明**：没拿到另一模式就不建 Theme，不反相；没证据的状态色 / 选中态不按色相猜——要么补证据、要么标 `[推断]` 并问用户。
- **不复制 Citrine 的值**：对齐的是角色名与目录，不是黄色、冷灰或 14px；值全部来自目标站点。
- **DESIGN.md 不写数值**；`$description` 写证据，不写规则长文。
- **不改生成物**：`dist/` 只由 steward 构建；校验 / 构建 / Guard / 迁移都调 steward，本 skill 不自己实现。
- **写入前确认**：`--force` 重写已有 `design-system/`、种子模式的 `--repo / --npm` 这类会进身份文件的信息，先告诉用户再做。
- **发布不绕门禁**：进 Design-System 仓库、打 tag 之前必须 `publish-check.mjs` 全 ✔（或用户明确接受 `--allow-inferred` 的 0.x 发布）；dist 随种子提交，不让消费者自己猜怎么构建。
- **桥接是起点不是成品**：`--with-citrine-bridges` 拷来的是 Citrine 的实现，含它的品牌决定；「桥接缺口」没处理完、走查页没过一遍，不在 README 里宣称支持该组件库。
- **不碰第三方资产**：只带度量值；来源站点的 logo、图标字体、商用字体文件不进种子，字体栈里的商用字体在 DESIGN 注明授权情况。

## 质量门（结束前逐项过）

- [ ] `validate-system` / `build-tokens` / `guard` 三绿，`guard` 为 `current`。
- [ ] `check-contrast.mjs` 无未处理的失败项（改值或登记例外）。
- [ ] `DESIGN.md` 无「待填写 / 待确认」；每条规则引用的角色在 `semantic.tokens.json` 里存在。
- [ ] `AUDIT.md` 的推断清单每行有确认状态；core 层缺口每行有决定。
- [ ] 有 Theme 时：`THEME.md` 列出的「通常也随模式变化」角色逐条确认过；预览板暗色下没有露出后备值的核心角色。
- [ ] 虚拟项目 `design-system/preview/index.html` 渲染过、截图给用户看过，页面上没有洋红（该类型要求的角色都有值），用户按看图清单确认过或提出了修改。
- [ ] 种子 / 发布模式：adopter `init` 与 `agents` 跑通；`design-system.json` 里的 repo / npm 是用户确认的；`publish-check.mjs` 全 ✔ 后才打 tag。
- [ ] 目标目录干净：没有证据 JSON、草稿目录、评测截图。
- [ ] 最终回复里说明：来源页面、系统类型（谁定的）、品牌族判定、观察 / 推断 / 必须处理的缺口数、Theme 有无、对比度例外、下一步（补哪些页面的证据）。

## 参考索引

- [references/token-spec.md](references/token-spec.md)：本仓库 token 规范速查（格式 / 分层 / 目录 / 文档分工 / 验收 / 种子包）
- [references/semantic-roles.md](references/semantic-roles.md)：161 个语义角色（core / extended / shell）与对比度配对
- [references/system-types.md](references/system-types.md)：系统类型怎么定义（含 `preview` 页面模板）（type.json 字段、四段配方词汇、extends、自定义目录）、内置三类各要哪些角色、自动推断的判据
- [references/mapping-rules.md](references/mapping-rules.md)：证据 → token 的归档规则、另一模式、缺口怎么补
- [references/extraction-checklist.md](references/extraction-checklist.md)：选页面、脚本读了什么、什么不取
- [references/browser-tooling.md](references/browser-tooling.md)：agent-browser 引导与故障
- 规范原文：steward [dtcg-profile](../design-system-steward/references/dtcg-profile.md) / [apply](../design-system-steward/references/apply.md) / [theme](../design-system-steward/references/theme.md)；样板 [Citrine DESIGN.md](https://github.com/WYCM9527/Design-System/blob/main/citrine/seeds/brand-yellow-e/design-system/DESIGN.md)

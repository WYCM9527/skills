# Changelog

版本策略：patch 只改文档 / 描述 / 不改产物形态的修正；minor 新增脚本能力、改变起草判定或产物结构（同一网站重跑会得到不同的 token 名或值，条目里写清）；major 才改语义角色词表里已有角色的含义或删角色。版本号同时写在 `SKILL.md` frontmatter 与 `package.json`。

## Unreleased（待做，2026-09-22 记录）

- **默认 `description` 不该是用户决策**：`scaffold-system.mjs` 不传 `--description` 时写成「<名称>：从 <URL> 实测提炼的设计系统。」，这句会落到根 README 表格「定位」列、`design-system.json`、`<id>/README.md`、`package.json`。改为从 `draft-notes.json` 拼一句能直接上表的定位（来源域名 · 主操作色与色族 · 有无另一模式 · 栈与桥接状态），并把 SKILL「6. 发布到 Design-System 仓库」里「写进仓库前问用户 `--description`」改成「Agent 按证据起草定位，给用户过目即可」。
- **npm 发布不在 skill 里决定**：提炼出的种子继续默认不带 `publishConfig`（只走文件夹 / Release 直链渠道，adopter 接入与按 tag 升级都不依赖 registry）；何时值得上 npm 的判据记在 Design-System 仓库 GUIDE 8c 第 8 步，`release.yml` 已会自动识别 `publishConfig`。

## 0.7.0 — 2026-09-22

**虚拟项目**：每提炼一套系统就用它渲染几张真实网页给人做视觉验证。预览板只验证「有哪些 token」，这轮暴露的问题全是「组合起来对不对」——表面判成白、正文判成黑、正文 61px、主按钮该白还是该橙红——在一张真实排版的页面上一眼能看出来。

- **`render-preview.mjs`**：按系统类型的 `preview` 页面列表渲染 HTML（website = 落地页 / 内容页 / 联系页，product = 登录 / 列表 / 表单 + 弹窗，admin = 工作台 / 表单 / 抽屉），页面只引用 token 变量，颜色角色缺失露出洋红；文案取自取证到的 h1 / h2 / CTA。三种 token 来源：`--draft` 内联解析值（起草后就能看，不用构建）、`--system` 链接 `dist/index.css` + `bridge/base.css`、`--via-adopter` 走 adopter `export` 的交付物（接入方拿到的东西）。`--shots` 用 agent-browser 截 1440 / 390 与每个 Theme；`index.html` 对照页：来源站首屏 vs 虚拟页并排 + 看图清单。`--radius-control / --radius-card` 指定控件 / 卡片圆角档（直角系统传 none），`--local-css` 追加本系统配方；rem 站点复刻 `100vw / N` 根字号、窄屏按桌面根字号；窄屏 hero / display 降两档。
- **取证存首屏截图**：`extract-evidence` 每页存桌面 / 手机 / 另一模式（拿到时）首屏到 `<out>-screens/`，写进 `page.screenshots`，只给对照页用；`--no-screens` 关掉。
- **新角色 `color.text.on-overlay`**（extended，词表 161）：压在遮罩上的文字。深底系统的 `text.inverse` 是黑，图片上的白字借不到——虚拟项目第一版就露了这个坑。draft 在观察到遮罩时按叠底明度推断；website 类型允许推断。
- **website 的留白节奏**：`space.stack` 取最常见的区块内边距（≥ 24px，rem 系统按根字号等比）而不是 flex gap；没有区块左右内边距样本时 `space.gutter` 取 ≥ 32px 里最常见的区块 padding（推断）。
- `type.json` 加 `preview` 字段；`assets/preview/preview.css` 是虚拟项目的组件样式（`.pv-*`，按配方角色拼）；`inlineTokensCss` 抽到 `lib/system.mjs` 供预览板与虚拟项目共用；种子 `.gitignore` 忽略 `design-system/preview/shots/` 与 `static/`。
- SKILL：核对段加「先看一眼再改」，第 5 步加虚拟项目，质量门加「用户按看图清单确认过」；README / system-types / extraction-checklist 同步。

## 0.6.0 — 2026-09-22

系统类型从写死的三个改成**可定义的数据**：用户要的是「可以定义类型，比如通用网站、中后台，等等」，不是挑一个我给的枚举。

- **类型 = 目录**：`<类型目录>/<id>/type.json` + `quick / visual / components / recipes.md`（DESIGN 四段配方词汇）。字段：`id` / `label` / `description` / `aliases` / `extends` / `archetype` / `roles.required` / `roles.inferable` / `bridges` / `pages` / `board`；角色集合用 `tiers`（重置）+ `include` / `exclude`（支持 `*` 通配）在父集合上增删；md 缺文件沿 `extends` 链回退。新 `scripts/lib/types.mjs`，`roles.mjs` 不再写死类型。
- **三层来源**：skill 内置 `assets/types/`（`website` 通用网站，别名 `brand` · `product` 产品应用 · `admin` 中后台）→ Design-System 仓库根 `system-types/`（自动发现，公司自定义类型放这里，同 id 覆盖内置）→ `--types-dir <dir>[,<dir>]`。
- **CLI**：`draft-tokens` / `scaffold-system` / `render-token-board` 改用 `--type <id 或别名>`（`--profile` 仍认）+ `--types-dir`；新 `list-types.mjs`（`--roles <id>` 列该类型必须处理 / 可推断的角色）；`publish-check` 软检查身份文件的类型能否解析。身份文件字段改名 `type`（adopter schema 同步，自由字符串）。
- **自动推断只落到原型**（website / product / admin），自定义类型要显式传；DESIGN 模板的「禁用态」「侧栏」条目改为按类型是否要求 `opacity.disabled` / `layout.sidebar.width` 决定，不再按 id 硬编码。
- 文档：新 `references/system-types.md`（怎么定义一个类型，附文档站示例）；SKILL 预检第 3 问改为「`list-types.mjs` 列出来让用户选，没有就定义一个」；Design-System 仓库加 `system-types/README.md`，GUIDE 8c 第 1 步「定类型」。
- OXYZ3 种子改为 `website`（内容不变）。

## 0.5.0 — 2026-09-22

纠正一个前提：提炼出来的设计系统不都是给中后台用的。此前词表的 core 层混着只有产品 UI 才有的角色、「core 缺口必须处理」的规则、DESIGN 模板的产品词汇（状态胶囊 / 表格 / 分页 / 骨架屏）、以及对种子默认引导拷 Element Plus / shadcn 桥接，合起来会把一个品牌官网写成中后台底座（OXYZ3 第一版就是这样：借 Citrine 值补了 93 个角色、拷了 21 个桥接文件）。同一站点重跑会得到不同的角色集合与文档，所以是 minor。

- **系统类型（profile）**：`brand` 品牌 / 内容站、`product` 产品 UI、`admin` 中后台。`roles.mjs` 新增 `PROFILES` / `requiredRoles()` / `inferableRoles()`：brand 必须处理 core 去掉产品专属 24 个 = 55，只允许推断品牌面 / 大字 / 链接装饰 / 浮层阴影 / 缓动；product = core 79，可推断 extended；admin = core + shell 107，全部可推断。有证据的观察项不受类型限制。
- **`draft-tokens --profile auto|brand|product|admin`**：auto 从证据推断（侧栏 + 表格 → admin；单页 ≥ 4 输入框 / 选择勾选控件 / ≥ 3 状态徽标 / 状态类根变量 / 多页有表格 → product；否则 brand），信号按单页取最大值（页脚联系表单出现 5 次不算「有表单」）。摘要与 `draft-notes.json` 记 `profile`，缺口分「必须处理」与「可选角色未填」，用户指定与证据不一致时提醒。
- **DESIGN 模板按类型拆**：「先读这里 / 视觉语言 / 组件原则 / 组件配方」四段来自 `assets/profiles/<profile>/`；brand 版说的是导航 / Hero / 区块 / CTA / 作品卡 / 图片上的文字 / 联系表单 / 页脚，不再有表格、分页、状态胶囊。AUDIT 模板加「系统类型」与「可选角色（未填）」；种子 README 与身份文件 `design-system.json` 写 `profile`（adopter schema 加了可选字段）。
- **scaffold**：读草稿的 profile（`--profile` 可覆盖）；对 brand 传 `--with-citrine-bridges` 会提醒「品牌站通常不需要组件库桥接」；显式传 `--description` 时重写根 README 已有行的定位（此前只更新版本）。
- **预览板按类型取舍样例**：brand 显示导航当前项 / hover、主 CTA、Hero 大字、联系表单，不再显示靠后备值撑着的状态胶囊 / 危险按钮 / Tooltip；默认读 `<system>/../design-system.json` 的 profile。
- SKILL：预检增加第 4 问「系统类型」（推荐项按站点本身给）；选页面、缺口规则、桥接只对 product / admin 提问；mapping-rules 加「三种类型各必须处理 / 允许推断 / 不借值」表；`text.caption.size` 的「国内中后台下限」措辞改掉。
- OXYZ3 种子按 brand 重做：189 个 token（原 338），30 条 `[推断]`（原 126），无桥接，纯 CSS 接入。

## 0.4.0 — 2026-09-22

用 OXYZ3（游戏化创意工作室官网，React SPA + hash 路由 + WebGL + 逐字动画，根字号 `100vw / 160`）做第四个端到端验证并写进 Design-System 仓库（`oxyz3/seeds/oxyz3`）后加的能力与修的判定；rem 站点的 token 值与名全变，所以是 minor。

- **`--unit auto|px|rem`**：根字号偏离 16px 超过 2px 时，字号 / 间距 / 圆角 / 控件高 / 图标 / 阴影 / 布局尺寸换算成 rem，间距按 `spacing.<rem×100>` 命名，根字号记为 `size.root-font` = 新角色 `layout.root.font-size`（词表 160 个）；边线宽、断点保留 px；预览板按该角色渲染 rem。各页根字号不一致时警告并要求重新取证。
- **取证每页 open 后 reload**：同源 hash 路由的 `open` 不重载文档，上一页留下的视口切换会把站点自己的 resize bug 带进来（OXYZ3 在 390 → 1440 后根字号变成 61.44px），五页里四页的尺寸证据曾因此全部失真。
- **品牌 ≠ 主操作**：`--brand` 只定品牌族与 `color.brand.*` / `text.brand`，`color.action.primary` 仍跟按钮证据（深底站点主按钮是白的）。品牌族投票加入 h1/h2 文字色 ×4、≥ 32px 有彩色大字 ×4（探针新记 `maxFont`），装饰性小块的底色按面积降权——110 个 2px 绿点不再赢过一行橙红 hero 标题。
- **表面与页面底同调**：`bg.surface` 候选只认对 `bg.page` ≤ 1.6:1 的中性色，深底站点的白色内容区归 `bg.inverse`；此前 surface 判成白导致正文色判成黑。
- **字号阶梯保住大字**：比正文大的档超过 8 个时留最常用的 7 个 + 最大的（hero 15rem 不再被丢）；标题字号只认比正文大的 h1/h2（SEO 隐藏标题、逐字动画的空 h2 是 9px）。
- **按承载字数选正文行高 / 字重 / 字体**（探针给 `lineHeights` / `weights` / `families` 记 `text`），逐字动画的单字 span 不再灌大 `line-height: 1`。
- DESIGN 模板一句「等待确认」误触 publish-check 的「待确认」门禁，改措辞。
- SKILL「核对」新增：SPA 路由怎么拿、逐字动画站点怎么核、批量补缺口的一次性脚本要同步 `draft-notes.json`。

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

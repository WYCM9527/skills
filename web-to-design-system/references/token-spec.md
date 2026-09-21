# 本仓库的 token 规范速查

提炼出来的系统必须能被 design-system-steward `validate-system → build-tokens → guard` 三绿、被 design-system-adopter 识别接入、与 Citrine 用同一套用途名。这一页把规范压成可核对的清单；原文在 steward 的 [dtcg-profile.md](../../design-system-steward/references/dtcg-profile.md)、[apply.md](../../design-system-steward/references/apply.md)、[theme.md](../../design-system-steward/references/theme.md) 与 Citrine 种子的 [DESIGN.md](https://github.com/WYCM9527/Design-System/blob/main/citrine/seeds/brand-yellow-e/design-system/DESIGN.md)。

## 1. 格式：DTCG 2025.10 CSS Profile

| 类型 | 写法 | 不能写成 |
| --- | --- | --- |
| `color` | `{ "colorSpace": "srgb", "components": [0.145, 0.388, 0.922], "alpha": 1, "hex": "#2563EB" }`；components 四位小数，hex 必须与 components 换算一致（校验器会算），半透明用 alpha + 8 位 hex | `"#2563eb"` 字符串、`rgb()`、oklch |
| `dimension` | `{ "value": 16, "unit": "px" }`；单位只能是 px / rem / em / % / vw / vh | `"16px"` 字符串 |
| `duration` | `{ "value": 150, "unit": "ms" }` | `"150ms"` |
| `number` | `1.6`（行高、z-index、透明度、描边） | 字符串 |
| `fontWeight` | `500` 或 `"medium"` | — |
| `fontFamily` | `["Inter", "PingFang SC", "sans-serif"]` | 带引号的一整段字符串 |
| `cubicBezier` | `[0.2, 0, 0, 1]` | `"ease"` 关键字（先换算成四点） |
| `string` / `boolean` | `"underline"`、`true` | — |
| alias | `"{color.brand.500}"`，整段引用、类型必须一致 | 嵌在字串里的引用、跨类型引用 |

**有意不用的复合类型**：`shadow`、`gradient`、`typography`、`border`、`transition`。阴影拆成三件（`shadow.y.N` / `shadow.blur.N` 尺寸 + `color.<族>.shadow-N` 颜色），页面写法固定 `box-shadow: 0 var(--elevation-<层>-y) var(--elevation-<层>-blur) var(--elevation-<层>-color)`；渐变不进 token（记进 AUDIT）。

每个 token 可带 `$description`：本 skill 约定以 `[观察]` / `[推断]` / `[确认]` 开头，后面写证据或推导规则。

## 2. 分层：Primitive → Semantic（→ Component 只给批准的例外）

- `tokens/primitives.tokens.json`：值本身，不说明用途。命名：`color.<族>.<明度档>`（族 = brand / neutral / red / orange / yellow / green / cyan / blue / purple / pink，档 = 50～950，半透明用 `scrim` / `shadow-N` / `ring` / `mask` / `<档>-aNN`）；`spacing.<px/4>`（6px → `1-5`，2px → `0-5`）；`radius.xs…2xl / full`；`font.family / size / weight / line-height / letter-spacing`；`size.control / icon / avatar / topbar / sidebar / container / viewport`；`border.width.thin / medium / thick / bar`；`shadow.y / blur / spread`；`duration.fast / normal / slow`；`easing.standard / enter / exit`；`opacity.<pct>`；`z.<value>`。
- `tokens/semantic.tokens.json`：用途，全部是 alias。角色名见 [semantic-roles.md](semantic-roles.md)，与 Citrine 一致——这样 Citrine 的桥接 / 配方 / 迁移角色表以后能复用，adopter 的 `migration/roles.json` 也是按这些名字写的。
- `tokens/components.tokens.json`：只在用户批准了某个组件例外时才创建。本 skill 默认不产出。

变量名 = 路径小写 kebab 连接：`color.action.primary` → `--color-action-primary`，`spacing.0-5` → `--spacing-0-5`，`text.body.size` → `--text-body-size`。

## 3. 目录：`design-system/`

```text
design-system/
├── DESIGN.md                        # 意图与规则，不写数值（引用角色名）
├── AUDIT.md                         # 证据、推断、缺口、对比度报告、风险（本 skill 生成）
├── tokens/primitives.tokens.json
├── tokens/semantic.tokens.json
├── scope-map.json                   # { "scopes": [], "version": 1 }——局部规范在目标项目里按证据登记
├── theme-map.json                   # 只有真的取到另一模式才有
├── themes/<id>/THEME.md + tokens/semantic.tokens.json   # 相对 Core 的 delta，只覆写 Semantic，不建 Primitive
├── style-dictionary.config.mjs      # 与 steward 脚手架相同（assets/ 里有一份拷贝）
└── dist/                            # 构建生成物，禁止手改；index.css = tokens.css + themes/*.css
```

`theme-map.json`：`defaultTheme`（kebab id；Core 就是它）、`activation`（`{ "kind": "class" }` → `:root.<id>`；`{ "kind": "data-attribute", "attribute": "data-theme" }` → `:root[data-theme="<id>"]`；`{ "kind": "media" }` → `@media (prefers-color-scheme: <id>)`，此时 id 只能是 light / dark）、`themes[]`（`id`、`status: active | reference-only`、非空 `runtimeOwner`、`source`、`reason`）。没有 Theme 证据、用户也没要求 → 不建 themes/，**不从现有颜色自动反相造暗色**。

## 4. 文档分工

| 文件 | 写什么 | 不写什么 |
| --- | --- | --- |
| `DESIGN.md` | 视觉语言、Token 使用规则、布局、组件配方（角色名）、交互与无障碍、验收基线、Do / Don't | 任何 hex / px / ms 数值 |
| `AUDIT.md` | 来源、取证方式、观察 vs 推断、缺口、对比度报告、未纳管项、风险 | 设计规则 |
| `THEME.md` | 该模式相对 Core 的意图、激活方式、运行时所有者 | 复制 Core、切换代码 |
| `$description` | 单条 token 的证据、对比度、为什么是这个值 | 别处已有的长篇规则 |

## 5. 验收：三绿 + 对比度

```bash
node <steward>/scripts/validate-system.mjs --project <含 design-system 的目录>   # 结构 / 类型 / alias / theme-map
(cd <目录> && npm i -D --no-save style-dictionary@5.5.2)                          # 固定 5.5.2
node <steward>/scripts/build-tokens.mjs --project <目录>                          # dist/tokens.css + themes/*.css + index.css
node <steward>/scripts/guard.mjs --project <目录>                                 # 应为 current
node <本 skill>/scripts/check-contrast.mjs --system <目录>/design-system          # 正文 ≥ 4.5、UI ≥ 3；失败项要么改值要么登记例外
```

`guard` 只查 token 引用与 dist 漂移，不扫页面字面量（那是 steward `status` / `migrate`）。steward 的位置用 `node <adopter>/scripts/ds.mjs steward locate`，版本要 ≥ 0.6.0。

## 6. 种子包（可选，发布给别的项目接入时）

在 `design-system/` 之外再放：`design-system.json` 身份文件（`id` kebab、`version` x.y.z、`upstream.repo / path / tagPrefix / npm`、至少一个 `stacks.<id>`（`entry` / `snippet` / `notes` 三个文件都要存在）、`owned` glob）、`bridge/`、`templates/`（`entry-*.css`、`notes-*.md`、`AGENTS.md`）、`README.md`、`CHANGELOG.md`、`package.json`（name = `upstream.npm`，folder 渠道靠它 `npm i file:./design-systems/<id>`）。schema 在 [design-system-adopter/schema/design-system.schema.json](https://github.com/WYCM9527/Design-System/blob/main/design-system-adopter/schema/design-system.schema.json)。`scaffold-system.mjs --seed` 会把这些一起写出来；`--into-repo <Design-System 仓库根>` 则直接按 `<id>/seeds/<seed-name>/` 落位并推出 upstream，`--build` 让 `dist/` 随种子提交（纯 CSS 渠道 `ds.mjs export` 直接读它），`publish-check.mjs` 是打 tag 前的门禁。adopter 的 `status / upgrade` 只认 tag `<id>-vX.Y.Z`：没有 tag 就没有升级。

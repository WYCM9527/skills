# 系统类型（可定义）

「这套规范给什么类型的产品用」决定三件事：**哪些角色必须处理**（补证据 / 按规则推断并标注 / 写明不需要）、**允许按规则推断哪些角色**（其余没证据就留空，不发明值）、**DESIGN.md 用哪套配方词汇**（先读这里 / 视觉语言 / 组件原则 / 组件配方）。顺带决定要不要向用户提「拷组件库桥接」、预检推荐取哪些页面、预览板放哪套组件样例。

类型是**数据**，不是代码。每种类型一个目录：

```text
<类型目录>/<id>/
├── type.json        # 定义（下表）
├── quick.md         # DESIGN「先读这里」的编号列表
├── visual.md        # DESIGN「视觉语言」的要点
├── components.md    # DESIGN「组件原则」的要点
├── recipes.md       # DESIGN「组件配方」的表格（含表头）
└── preview/         # 虚拟项目页面模板 <page>.html：只用 var(--*) 与 preview.css 的 .pv-* 类，占位符 {{NAME}} {{H1}} {{SUB}} {{CTA}} {{CTA2}} {{NAV1..4}} {{SECTION1..3}} {{EYEBROW}} {{H2}} {{SOURCE}} {{HEAD}}
```

四个 md 缺哪个就沿 `extends` 链回退到父类型的；`type.json` 缺哪个字段也取父类型的。

## 类型目录从哪来

按顺序加载，同 id 后加载的覆盖先加载的（公司可以整体替换内置类型）：

1. 本 skill 内置：`assets/types/`（`website` 通用网站 · `product` 产品应用 · `admin` 中后台）。
2. Design-System 仓库根的 `system-types/`——从当前目录（scaffold 是目标目录）向上找 `.git` 自动发现。公司自己的类型放这里，随仓库版本管理。
3. `--types-dir <dir>[,<dir>]`：任意目录，draft-tokens / scaffold-system / render-token-board / list-types 都接受。

`node scripts/list-types.mjs [--types-dir …]` 列出当前能用的类型；`--roles <id>` 列出该类型必须处理 / 可推断的角色。

## type.json

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | kebab-case；`--type` 用它，身份文件 `design-system.json` 的 `type` 字段写它 |
| `label` | 是 | 中文短名，进 DESIGN / AUDIT / README（「通用网站」「中后台」「文档站」） |
| `description` | 建议 | 一句话：给谁用、交互到什么程度 |
| `aliases` | 否 | 别名 / 旧名，`--type` 也认（`brand` → `website`） |
| `extends` | 否 | 继承另一个类型的 id：角色集合在父集合上增删，md 缺文件回退到父，其余字段缺省取父 |
| `archetype` | 继承时可省 | `website` / `product` / `admin` 三个原型之一——自动推断只落到原型上；预览板样例套件默认按它 |
| `roles.required` | 否 | 必须处理的角色：`{ tiers?, include?, exclude? }`（见下） |
| `roles.inferable` | 否 | 允许按规则推断写入的角色，同上；`required` 永远包含在内 |
| `bridges` | 否 | `true` 才向用户提「要不要 `--with-citrine-bridges`」；`false` 时传了会提醒 |
| `pages` | 否 | 预检时推荐取哪些页面的一句话 |
| `board` | 否 | 预览板样例套件：`website` / `product` / `admin`；缺省按原型 |
| `preview` | 否 | 虚拟项目要渲染的页面 id 列表，模板在 `<id>/preview/<page>.html`（缺文件沿 `extends` 链回退）；内置：website = landing / article / contact，product = login / list / form，admin = shell / form / drawer |

角色集合的三个键按顺序生效：`tiers` 给出则**重置**为这些层（`core` / `extended` / `shell`）的全部角色，否则从父类型的集合起步；`include` 逐条加入；`exclude` 逐条移除。模式支持 `*` 通配：`color.status.*`、`color.action.danger*`；没匹配到任何角色的模式会在起草摘要里警告（多半是拼错）。角色名以 [semantic-roles.md](semantic-roles.md) 为准。

## 内置三类

| id | label | 必须处理 | 允许推断 | 桥接 | 一句话 |
| --- | --- | --- | --- | --- | --- |
| `website`（别名 `brand`） | 通用网站 | core 去掉产品专属 24 个 = 55 | 必须集 + 品牌面 / 大字 / 遮罩上的文字 / 链接装饰 / 浮层阴影 / 缓动 = 83 | 不需要 | 官网、活动页、作品集、博客、内容站：以读和看为主 |
| `product` | 产品应用 | core 79 | core + extended = 132 | 可选 | 面向用户的应用 / SaaS 前台，有表单 / 列表 / 弹窗 / 状态反馈，没有后台壳层 |
| `admin` | 中后台 | core + shell = 107 | 全部 161 | 可选（建议） | 侧栏 + 表格 + 图表 + 弹窗尺寸的工作台 |

产品专属的 24 个 core 角色：状态色 ×10（`color.status.*`）、危险色 ×5（`color.action.danger*`、`color.text.on-danger`、`color.text.danger`）、输入框三件（`color.bg.input` / `color.border.input` / `color.text.placeholder`）、`color.bg.elevated`、`control.height.sm / lg`、`layer.dropdown / toast`、`opacity.disabled`。通用网站有联系表单时这些照样按观察填，只是没证据不推断。

## 自动推断

`draft-tokens --type auto`（默认）从证据推断**原型**：侧栏 + 表格 → `admin`；单页 ≥ 4 个输入框 / 有选择 · 勾选类控件 / 单页 ≥ 3 个状态徽标 / ≥ 4 个状态类根变量 / 多页有表格 → `product`；否则 `website`。信号按单页取最大值——页脚的联系表单在每页出现一次不等于「有表单」。自定义类型不会被自动推断出来，要显式 `--type <id>`；用户指定的类型与证据原型不一致时摘要里会提醒。

## 定义一个新类型（例：文档站）

```text
<仓库根>/system-types/docs/
├── type.json
└── quick.md          # 只覆盖「先读这里」，其余三段回退到 website 的
```

```json
{
  "id": "docs",
  "label": "文档站",
  "description": "产品文档 / 帮助中心：长文阅读、代码块、侧栏目录、搜索",
  "aliases": ["help-center"],
  "extends": "website",
  "roles": {
    "required": { "include": ["font.family.code", "text.numeric.variant", "layout.sidebar.width"], "exclude": ["color.bg.overlay"] }
  },
  "pages": "首页 + 一篇长文档（标题阶梯、代码块、表格）+ 搜索结果页"
}
```

之后 `--type docs`（或 `--type help-center`）起草：必须处理的缺口按 website 的 55 个 +3 −1 算，DESIGN「先读这里」用你写的 quick.md，其余三段用 website 的，身份文件写 `"type": "docs"`，预览板用 website 套件。

## 边界

- 类型只决定「要哪些角色、用哪些词汇」，**不改词表**——角色名在所有类型间通用，桥接 / 配方 / 迁移对照才能跨系统复用。要给某类系统加独有角色（比如 `hero.*`），是词表扩展，改 `scripts/lib/roles.mjs` + `references/semantic-roles.md`，走 skill 的 minor 版本。
- 类型不决定值。同一站点换类型重跑，观察项一样，变的是缺口口径、推断项、文档词汇、桥接建议。
- 身份文件 `design-system.json` 的 `type` 是自由字符串（adopter 只当元数据），所以自定义类型的种子也能被 adopter 接入。

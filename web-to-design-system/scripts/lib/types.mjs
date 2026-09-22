// 系统类型：这套规范给什么类型的产品用。类型是**数据**，不是代码——每种类型一个目录：
//   <dir>/<id>/type.json                 id / label / description / aliases / extends / archetype / roles / bridges / pages / board
//   <dir>/<id>/{quick,visual,components,recipes}.md   DESIGN.md 的四段配方词汇（缺的沿 extends 链回退）
// 内置类型在本 skill 的 assets/types/（website 通用网站 · product 产品应用 · admin 中后台）；公司自定义类型放 Design-System 仓库根的
// system-types/<id>/（自动发现）或任何 --types-dir 目录。同 id 后加载的覆盖先加载的，所以公司可以整体替换内置类型的定义。
//
// type.json 字段：
//   id            kebab；label 中文短名；description 一句话给谁用；aliases 旧名 / 别名
//   extends       继承另一个类型：roles 在父集合上增删，md 缺文件回退到父类型，其余字段缺省取父
//   archetype     website | product | admin——自动推断只会落到这三个原型上；自定义类型靠 extends 决定原型（用于预览板样例与推断匹配）
//   roles.required  { tiers?: ["core"|"extended"|"shell"], include?: [模式], exclude?: [模式] }  必须处理的角色：tiers 给出则重置，再 include / exclude
//   roles.inferable 同上；允许按规则推断写入的角色（required 永远包含在内）。模式支持 * 通配：color.status.*、color.action.danger*
//   bridges       true / false：要不要向用户提「拷组件库桥接」
//   pages         预检时推荐取哪些页面
//   board         预览板样例套件：website | product | admin（缺省取原型）
//   preview       虚拟项目要渲染的页面 id 列表，模板在 <dir>/<id>/preview/<page>.html（缺文件沿 extends 链回退）
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { skillRoot } from "./args.mjs";
import { findRepoRoot } from "./repo.mjs";
import { ROLES } from "./roles.mjs";

export const BUILTIN_TYPES_DIR = path.join(skillRoot, "assets", "types");
export const REPO_TYPES_DIRNAME = "system-types";
export const ARCHETYPES = ["website", "product", "admin"];
const BLOCKS = ["quick.md", "visual.md", "components.md", "recipes.md"];
const ROLE_PATHS = ROLES.map((role) => role.path);

/** `color.status.*` / `color.action.danger*` 这类模式 → 匹配到的角色路径；没有 * 就是精确匹配。 */
export function matchRoles(pattern) {
  if (!pattern.includes("*")) return ROLE_PATHS.includes(pattern) ? [pattern] : [];
  const regex = new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return ROLE_PATHS.filter((rolePath) => regex.test(rolePath));
}

function resolveRoleSet(spec, base, warnings, label) {
  let set = new Set(base ?? []);
  if (!spec) return set;
  if (Array.isArray(spec.tiers)) set = new Set(ROLES.filter((role) => spec.tiers.includes(role.tier)).map((role) => role.path));
  for (const pattern of spec.include ?? []) {
    const matched = matchRoles(pattern);
    if (!matched.length) warnings.push(`${label}：include 模式 ${pattern} 没匹配到任何角色`);
    for (const rolePath of matched) set.add(rolePath);
  }
  for (const pattern of spec.exclude ?? []) {
    const matched = matchRoles(pattern);
    if (!matched.length) warnings.push(`${label}：exclude 模式 ${pattern} 没匹配到任何角色`);
    for (const rolePath of matched) set.delete(rolePath);
  }
  return set;
}

async function readTypeDirs(dir, source) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, "type.json");
    if (!existsSync(file)) continue;
    const json = JSON.parse(await readFile(file, "utf8"));
    found.push({ ...json, dir: path.join(dir, entry.name), id: json.id ?? entry.name, source });
  }
  return found;
}

/**
 * 加载类型注册表。顺序：内置 → 仓库 system-types/（从 startDir 向上找 .git）→ dirs（--types-dir，可多个）。
 * 返回 { types: Map<id, type>, aliases: Map<alias, id>, dirs: 实际读到的目录, warnings }。
 */
export async function loadTypes({ dirs = [], startDir = process.cwd() } = {}) {
  const searchDirs = [BUILTIN_TYPES_DIR];
  const repoRoot = findRepoRoot(startDir);
  if (repoRoot) searchDirs.push(path.join(repoRoot, REPO_TYPES_DIRNAME));
  for (const dir of dirs) searchDirs.push(path.resolve(dir));
  const raw = new Map();
  const readDirs = [];
  for (const dir of searchDirs) {
    const list = await readTypeDirs(dir, dir === BUILTIN_TYPES_DIR ? "builtin" : "custom");
    if (existsSync(dir)) readDirs.push(dir);
    for (const entry of list) raw.set(entry.id, entry);
  }
  const warnings = [];
  const types = new Map();
  const resolve = (id, stack = []) => {
    if (types.has(id)) return types.get(id);
    const json = raw.get(id);
    if (!json) throw new Error(`系统类型 ${id} 不存在（${stack.length ? `被 ${stack.at(-1)} 继承` : "未定义"}）；可用：${[...raw.keys()].join(" / ")}`);
    if (stack.includes(id)) throw new Error(`系统类型继承成环：${[...stack, id].join(" → ")}`);
    const parent = json.extends ? resolve(json.extends, [...stack, id]) : null;
    const required = resolveRoleSet(json.roles?.required, parent?.required ?? null, warnings, `${id}.roles.required`);
    const inferableOwn = resolveRoleSet(json.roles?.inferable, parent?.inferable ?? null, warnings, `${id}.roles.inferable`);
    const inferable = new Set([...required, ...inferableOwn]);
    const archetype = json.archetype ?? parent?.archetype ?? null;
    if (!ARCHETYPES.includes(archetype)) throw new Error(`系统类型 ${id} 没有可用的 archetype（website / product / admin），直接写或通过 extends 继承`);
    const type = {
      aliases: json.aliases ?? [],
      archetype,
      board: json.board ?? parent?.board ?? archetype,
      bridges: json.bridges ?? parent?.bridges ?? false,
      chain: [json.dir, ...(parent?.chain ?? [])],
      description: json.description ?? parent?.description ?? "",
      dir: json.dir,
      extends: json.extends ?? null,
      id,
      inferable,
      label: json.label ?? id,
      pages: json.pages ?? parent?.pages ?? "",
      preview: Array.isArray(json.preview) ? json.preview : parent?.preview ?? [],
      required,
      source: json.source
    };
    types.set(id, type);
    return type;
  };
  for (const id of raw.keys()) resolve(id);
  const aliases = new Map();
  for (const type of types.values()) for (const alias of type.aliases) if (!types.has(alias)) aliases.set(alias, type.id);
  for (const archetype of ARCHETYPES) if (!types.has(archetype)) throw new Error(`内置类型 ${archetype} 缺失：${BUILTIN_TYPES_DIR} 被改坏了`);
  return { aliases, dirs: readDirs, types, warnings };
}

/** 按 id 或别名取类型；找不到抛错并列出可用的。 */
export function resolveType(registry, idOrAlias) {
  const id = registry.types.has(idOrAlias) ? idOrAlias : registry.aliases.get(idOrAlias);
  if (!id) throw new Error(`系统类型 ${idOrAlias} 不存在；可用：${listTypeIds(registry).join(" / ")}（自定义类型放仓库 system-types/<id>/ 或用 --types-dir 指定）`);
  return registry.types.get(id);
}

export function listTypeIds(registry) {
  return [...registry.types.keys()];
}

/** DESIGN.md 四段配方词汇；缺文件沿 extends 链回退。 */
export async function typeBlocks(type) {
  const blocks = {};
  for (const file of BLOCKS) {
    const dir = type.chain.find((candidate) => existsSync(path.join(candidate, file)));
    if (!dir) throw new Error(`系统类型 ${type.id} 缺 ${file}，extends 链上也没有`);
    blocks[file.replace(".md", "")] = (await readFile(path.join(dir, file), "utf8")).trim();
  }
  return blocks;
}

/** 虚拟项目页面模板：<类型目录>/preview/<page>.html，缺文件沿 extends 链回退；返回 { page, file } 列表。 */
export function typePreviewPages(type) {
  return type.preview.map((page) => {
    const dir = type.chain.find((candidate) => existsSync(path.join(candidate, "preview", `${page}.html`)));
    if (!dir) throw new Error(`系统类型 ${type.id} 声明了预览页 ${page}，但 extends 链上都没有 preview/${page}.html`);
    return { file: path.join(dir, "preview", `${page}.html`), page };
  });
}

/**
 * 从证据信号推断原型：侧栏 + 表格 → admin；单页 ≥ 4 输入框 / 选择勾选类控件 / ≥ 3 状态徽标 / ≥ 4 状态类根变量 / 多页有表格 → product；否则 website。
 * 信号按单页取最大值——页脚的联系表单在每页出现一次不等于「有表单」。
 */
export function inferArchetype({ anyControls = false, hasSidebar = false, maxBadges = 0, maxInputs = 0, pagesWithTables = 0, statusVars = 0 }) {
  if (hasSidebar && pagesWithTables >= 1) return "admin";
  const productSignals = [maxInputs >= 4, anyControls, maxBadges >= 3, statusVars >= 4, pagesWithTables >= 2 || (pagesWithTables >= 1 && (maxBadges >= 1 || maxInputs >= 3))].filter(Boolean).length;
  return productSignals >= 1 ? "product" : "website";
}

/** 一行摘要，给 list-types 与预检提问用。 */
export function describeType(type) {
  return `${type.id}${type.aliases.length ? `（别名 ${type.aliases.join(" / ")}）` : ""} · ${type.label} · ${type.description} · 必须处理 ${type.required.size} · 可推断 ${type.inferable.size} · 桥接${type.bridges ? "可选" : "不需要"}${type.extends ? ` · 继承 ${type.extends}` : ""}${type.source === "custom" ? ` · 自定义（${type.dir}）` : ""}`;
}

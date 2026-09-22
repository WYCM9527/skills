#!/usr/bin/env node
// 列出可用的系统类型（内置 + 仓库 system-types/ + --types-dir），预检时拿它向用户提「这套规范给什么用」。
// 用法：node list-types.mjs [--types-dir <dir>[,<dir>]] [--json] [--roles <类型 id>]（列出该类型必须处理 / 可推断的角色）

import path from "node:path";

import { parseArgs, printJson, reportError } from "./lib/args.mjs";
import { ROLE_BY_PATH } from "./lib/roles.mjs";
import { describeType, loadTypes, resolveType } from "./lib/types.mjs";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dirs = String(options["types-dir"] ?? "").split(",").map((dir) => dir.trim()).filter(Boolean).map((dir) => path.resolve(process.cwd(), dir));
  const registry = await loadTypes({ dirs });
  if (typeof options.roles === "string") {
    const type = resolveType(registry, options.roles);
    const rows = [...type.inferable].sort().map((rolePath) => ({ path: rolePath, required: type.required.has(rolePath), tier: ROLE_BY_PATH.get(rolePath)?.tier, zh: ROLE_BY_PATH.get(rolePath)?.zh }));
    if (options.json === true) return printJson({ type: type.id, roles: rows });
    process.stdout.write(`${describeType(type)}\n\n| 角色 | 层 | 含义 | 必须处理 |\n| --- | --- | --- | --- |\n${rows.map((row) => `| \`${row.path}\` | ${row.tier} | ${row.zh} | ${row.required ? "是" : "可推断"} |`).join("\n")}\n`);
    return;
  }
  if (options.json === true) {
    return printJson({
      aliases: Object.fromEntries(registry.aliases),
      dirs: registry.dirs,
      types: [...registry.types.values()].map((type) => ({ archetype: type.archetype, bridges: type.bridges, description: type.description, dir: type.dir, extends: type.extends, id: type.id, inferable: type.inferable.size, label: type.label, pages: type.pages, required: type.required.size, source: type.source })),
      warnings: registry.warnings
    });
  }
  process.stdout.write(`类型目录：${registry.dirs.join("；")}\n\n`);
  for (const type of registry.types.values()) {
    process.stdout.write(`- ${describeType(type)}\n    取页面：${type.pages}\n`);
  }
  if (registry.warnings.length) process.stdout.write(`\n警告：\n${registry.warnings.map((warning) => `  - ${warning}`).join("\n")}\n`);
  process.stdout.write(`\n自定义类型：在仓库根建 system-types/<id>/type.json（可 extends 内置类型，增删角色、改配方词汇），或用 --types-dir 指向任意目录。\n`);
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

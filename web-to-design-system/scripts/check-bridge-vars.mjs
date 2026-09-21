#!/usr/bin/env node
// 桥接变量核对：桥接 / 配方 / 配方组件里 var(--x) 与 '--x' 引用的变量，本系统（tokens + themes）有没有定义。
// 缺的要么补 token、要么删规则；组件库自己的前缀（--el-*、--tw-*、--radix-*…）与桥接内部自定义的变量不算。
//
// 用法：node check-bridge-vars.mjs --system <design-system 目录> --bridge <bridge 目录> [--json]

import path from "node:path";

import { parseArgs, printJson, reportError, requireAbsolutePath, requireStringOption } from "./lib/args.mjs";
import { missingBridgeVariables, scanBridgeVariables } from "./lib/bridges.mjs";
import { cssVariableName } from "./lib/dtcg.mjs";
import { allPaths, loadSystem } from "./lib/system.mjs";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const systemRoot = requireAbsolutePath(path.resolve(process.cwd(), requireStringOption(options, "system")), "--system");
  const bridgeRoot = requireAbsolutePath(path.resolve(process.cwd(), requireStringOption(options, "bridge")), "--bridge");
  const system = await loadSystem(systemRoot);
  const systemVariables = new Set(allPaths(system).map((tokenPath) => cssVariableName(tokenPath)));
  const scan = scanBridgeVariables(bridgeRoot);
  const missing = missingBridgeVariables(systemVariables, scan);
  const used = [...scan.referenced.keys()].filter((name) => systemVariables.has(name)).length;
  if (options.json === true) {
    printJson({ bridgeDefined: scan.defined.size, missing, referenced: scan.referenced.size, systemVariables: systemVariables.size, usedFromSystem: used, valid: missing.length === 0 });
  } else {
    process.stdout.write(`桥接引用 ${scan.referenced.size} 个变量：${used} 个来自本系统，${scan.defined.size} 个桥接自定义，${missing.length} 个本系统没有。\n`);
    for (const entry of missing) process.stdout.write(`  --${entry.name}  ← ${entry.files.slice(0, 3).join("、")}${entry.files.length > 3 ? ` 等 ${entry.files.length} 处` : ""}\n`);
  }
  process.exitCode = missing.length ? 1 : 0;
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

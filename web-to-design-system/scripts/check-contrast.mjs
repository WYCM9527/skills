#!/usr/bin/env node
// 对比度基线：对 design-system/ 里已登记的文字 / 底色角色配对算 WCAG 对比度，默认模式与每个 Theme 都算一遍。
// 配对表在 lib/roles.mjs 的 CONTRAST_PAIRS（与 Citrine DESIGN.md「验收基线」同一口径：正文 ≥ 4.5、UI 组件 / 图标 ≥ 3）。
// 低于底线的配对退出码 1——要么改值，要么用户拍板登记为例外（写进 AUDIT.md 与 DESIGN.md「已批准的例外」）。
//
// 用法：node check-contrast.mjs --system <design-system 目录> [--json] [--soft] [--write <report.md>]

import path from "node:path";

import { parseArgs, printJson, reportError, requireAbsolutePath, requireStringOption, writeText } from "./lib/args.mjs";
import { composite, contrastRatio, parseCssColor } from "./lib/color.mjs";
import { CONTRAST_PAIRS } from "./lib/roles.mjs";
import { loadSystem, resolveIn } from "./lib/system.mjs";

function evaluate(system, theme) {
  const rows = [];
  const pageBg = resolveIn(system, "color.bg.page", theme);
  const surfaceBg = resolveIn(system, "color.bg.surface", theme);
  const base = parseCssColor(pageBg?.css ?? surfaceBg?.css ?? "#ffffff") ?? { a: 1, b: 255, g: 255, r: 255 };
  for (const [fgPath, bgPath, minimum, label] of CONTRAST_PAIRS) {
    const fg = resolveIn(system, fgPath, theme);
    const bg = resolveIn(system, bgPath, theme);
    if (!fg || !bg) {
      continue;
    }
    const fgColor = parseCssColor(fg.css);
    const bgColor = parseCssColor(bg.css);
    if (!fgColor || !bgColor) {
      continue;
    }
    // 底色本身半透明时先叠到页面底上（遮罩、预混浅底）
    const solidBg = composite(bgColor, base);
    const ratio = contrastRatio(fgColor, solidBg);
    rows.push({ bg: bgPath, bgCss: bg.css, fg: fgPath, fgCss: fg.css, label, minimum, pass: ratio >= minimum, ratio });
  }
  return rows;
}

function table(rows) {
  const lines = ["| 配对 | 前景 | 底色 | 对比 | 底线 | 结果 |", "| --- | --- | --- | --- | --- | --- |"];
  for (const row of rows) {
    lines.push(`| ${row.label} | \`${row.fg}\` ${row.fgCss} | \`${row.bg}\` ${row.bgCss} | ${row.ratio}:1 | ≥ ${row.minimum} | ${row.pass ? "✔" : "✘ 低于底线"} |`);
  }
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const systemRoot = requireAbsolutePath(path.resolve(process.cwd(), requireStringOption(options, "system")), "--system");
  const system = await loadSystem(systemRoot);
  if (system.core.size === 0) {
    throw new Error(`${systemRoot}/tokens 里没有 token`);
  }
  const modes = [{ id: system.themeMap?.defaultTheme ?? "default", theme: null }, ...system.themes.map((theme) => ({ id: theme.id, theme }))];
  const report = modes.map((mode) => ({ id: mode.id, rows: evaluate(system, mode.theme) }));
  const failures = report.flatMap((mode) => mode.rows.filter((row) => !row.pass).map((row) => ({ ...row, mode: mode.id })));
  const checked = report.reduce((total, mode) => total + mode.rows.length, 0);

  if (options.json === true) {
    printJson({ checked, failures: failures.length, report, valid: failures.length === 0 });
  } else {
    const markdown = [`# 对比度基线 · ${path.basename(path.dirname(systemRoot)) || systemRoot}`, "", `检查 ${checked} 组配对，${failures.length} 组低于底线。口径：正文与 12px 小字 ≥ 4.5:1，大字 / 图标 / UI 组件 ≥ 3:1，边线可辨 ≥ 1.3:1；底色半透明时先叠到页面底上再算。`, ""];
    for (const mode of report) {
      markdown.push(`## 模式：${mode.id}`, "", mode.rows.length ? table(mode.rows) : "（没有可配对的角色）", "");
    }
    if (failures.length) {
      markdown.push("## 低于底线", "", ...failures.map((row) => `- [${row.mode}] ${row.label}：\`${row.fg}\`（${row.fgCss}）压 \`${row.bg}\`（${row.bgCss}）只有 ${row.ratio}:1，底线 ${row.minimum}。改值，或由用户拍板登记为例外并写回补路径。`), "");
    }
    const text = markdown.join("\n");
    if (typeof options.write === "string") {
      await writeText(path.resolve(process.cwd(), options.write), text);
    }
    process.stdout.write(text);
  }
  process.exitCode = failures.length && options.soft !== true ? 1 : 0;
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

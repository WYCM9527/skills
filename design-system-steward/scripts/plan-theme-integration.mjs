import { stat } from "node:fs/promises";
import path from "node:path";

import {
  fileExists,
  isWithin,
  parseArgs,
  printJson,
  readTextIfSmall,
  relativePosix,
  reportError,
  requireAbsolutePath,
  requireDirectory,
  requireStringOption,
  walkFiles
} from "./lib.mjs";
import { inspectDesignSystem } from "./validate-system.mjs";

const ENTRY_EXTENSIONS = new Set([".astro", ".html", ".jsx", ".tsx", ".js", ".ts", ".vue", ".svelte"]);
const ROOT_BASENAMES = /^(?:app|index|layout|main|root)\.(?:astro|html|jsx|tsx|js|ts|vue|svelte)$/i;

function likelyRoot(relative) {
  const base = path.basename(relative);
  if (!ROOT_BASENAMES.test(base)) {
    return false;
  }
  return /(?:^|\/)(?:app|src|pages?|routes?|views?)(?:\/|$)|^index\.html$/i.test(relative)
    || /^(?:app|index|layout|main|root)\./i.test(base);
}

function rootScore(relative) {
  if (/(?:^|\/)app\/layout\./i.test(relative) || /^index\.html$/i.test(relative)) {
    return 50;
  }
  if (/(?:^|\/)src\/(?:main|app|root)\./i.test(relative)) {
    return 40;
  }
  if (/(?:^|\/)(?:main|app|root)\./i.test(relative)) {
    return 30;
  }
  return 10;
}

async function discoverEntries(projectRoot) {
  const files = await walkFiles(projectRoot);
  return files
    .map((file) => relativePosix(projectRoot, file))
    .filter((relative) => ENTRY_EXTENSIONS.has(path.extname(relative).toLowerCase()) && likelyRoot(relative))
    .map((relative) => ({ relative, score: rootScore(relative) }))
    .sort((left, right) => right.score - left.score || left.relative.localeCompare(right.relative));
}

async function explicitEntry(projectRoot, value) {
  const entry = requireAbsolutePath(value, "--entry");
  if (!isWithin(projectRoot, entry) || entry === projectRoot) {
    throw new Error("--entry must be a file within the supplied project root");
  }
  const details = await stat(entry);
  if (!details.isFile()) {
    throw new Error(`--entry must be a file: ${entry}`);
  }
  const relative = relativePosix(projectRoot, entry);
  if (!ENTRY_EXTENSIONS.has(path.extname(entry).toLowerCase())) {
    throw new Error(`--entry is not a supported root source file: ${relative}`);
  }
  return { explicit: true, relative, score: rootScore(relative) };
}

function toImportSpecifier(fromDirectory, target) {
  const relative = path.relative(fromDirectory, target).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function importStatementForEntry(entryPath, specifier) {
  return path.extname(entryPath).toLowerCase() === ".html"
    ? `<link rel="stylesheet" href="${specifier}">`
    : `import "${specifier}";`;
}

function activationPreview(theme, themeMap) {
  const { activation } = themeMap;
  if (activation.kind === "data-attribute") {
    return {
      kind: activation.kind,
      preview: `<html ${activation.attribute}="${theme.id}">…</html>`,
      rootChangeRequired: true
    };
  }
  if (activation.kind === "class") {
    return {
      kind: activation.kind,
      preview: `<html class="${theme.id}">…</html>`,
      rootChangeRequired: true
    };
  }
  return {
    kind: activation.kind,
    preview: `@media (prefers-color-scheme: ${theme.id}) { … }`,
    rootChangeRequired: false
  };
}

function escapeExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasStaticActivation(text, theme, themeMap) {
  const { activation } = themeMap;
  const themeId = escapeExpression(theme.id);
  if (activation.kind === "media") {
    return true;
  }
  if (activation.kind === "data-attribute") {
    const attribute = escapeExpression(activation.attribute);
    const dataKey = activation.attribute.slice("data-".length).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return new RegExp(
      `(?:<html\\b[^>]*\\b${attribute}\\s*=\\s*(?:\\{\\s*)?["']${themeId}["']|document\\.documentElement\\.setAttribute\\(\\s*["']${attribute}["']\\s*,\\s*["']${themeId}["']\\s*\\)|document\\.documentElement\\.dataset\\.${dataKey}\\s*=\\s*["']${themeId}["'])`,
      "i"
    ).test(text);
  }
  return new RegExp(
    `(?:<html\\b[^>]*\\b(?:class|className)\\s*=\\s*(?:\\{\\s*)?["'][^"']*\\b${themeId}\\b[^"']*["']|document\\.documentElement\\.classList\\.(?:add|toggle)\\(\\s*["']${themeId}["'])`,
    "i"
  ).test(text);
}

function blocked(details) {
  printJson({
    ...details,
    uiSourceChanged: false,
    writes: false
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = await requireDirectory(requireStringOption(options, "project"), "--project");
  const id = requireStringOption(options, "theme");
  const inspected = await inspectDesignSystem(projectRoot);
  if (!inspected.result.valid) {
    printJson({ ...inspected.result, status: inspected.result.status ?? "invalid-system", uiSourceChanged: false, writes: false });
    process.exitCode = 1;
    return;
  }

  const system = inspected.internal;
  if (!system.themeMap) {
    throw new Error("No managed design-system/theme-map.json found. Audit and confirm a Theme before planning integration.");
  }
  const theme = system.themesById.get(id);
  if (!theme) {
    throw new Error(`Theme is not registered in theme-map.json: ${id}`);
  }
  const aggregatePath = path.join(system.systemRoot, "dist", "index.css");
  const base = {
    activation: activationPreview(theme, system.themeMap),
    cssAggregate: "design-system/dist/index.css",
    defaultTheme: system.themeMap.defaultTheme,
    projectRoot,
    theme: {
      id: theme.id,
      reason: theme.reason,
      runtimeOwner: theme.runtimeOwner,
      source: theme.source,
      status: theme.status
    }
  };

  if (theme.status === "reference-only") {
    blocked({
      ...base,
      canIntegrate: false,
      nextStepPrompt: "该 Theme 是 reference-only：保留现有主题与运行时证据，不生成或导入新的 Theme CSS。若要迁移，先确认唯一真相源、默认模式和运行时所有权。",
      status: "reference-only"
    });
    return;
  }

  const discovered = await discoverEntries(projectRoot);
  let entry = null;
  if (options.entry !== undefined) {
    entry = await explicitEntry(projectRoot, requireStringOption(options, "entry"));
  } else if (discovered.length === 1) {
    entry = { ...discovered[0], explicit: false };
  }
  if (!entry) {
    const reason = discovered.length === 0
      ? "未找到可以安全确认的应用根入口。"
      : "发现多个可能的应用根入口，无法判断哪个入口拥有 html 根或运行时主题状态。";
    blocked({
      ...base,
      canIntegrate: false,
      candidateEntries: discovered,
      nextStepPrompt: `${reason} 请先确认唯一入口或传入 --entry；本脚本不会猜测 Theme Provider、localStorage 或切换逻辑。`,
      status: "needs-entry-confirmation"
    });
    return;
  }

  const entryPath = path.join(projectRoot, entry.relative);
  const entryText = await readTextIfSmall(entryPath);
  if (entryText === null) {
    throw new Error(`--entry is too large to inspect safely: ${entry.relative}`);
  }
  const importSpecifier = toImportSpecifier(path.dirname(entryPath), aggregatePath);
  const importStatement = importStatementForEntry(entryPath, importSpecifier);
  const aggregateExists = await fileExists(aggregatePath);
  const hasCssImport = entryText.includes(importSpecifier) || /design-system\/dist\/index\.css/.test(entryText);
  const activation = activationPreview(theme, system.themeMap);
  const staticActivationPresent = hasStaticActivation(entryText, theme, system.themeMap);
  const themeActivationNeeded = activation.rootChangeRequired && !staticActivationPresent;
  const activationInstruction = themeActivationNeeded
    ? `，并把根激活为 ${activation.preview}`
    : staticActivationPresent
      ? "；入口已有匹配的静态 Theme 激活证据，不重复添加"
      : "";

  printJson({
    ...base,
    canIntegrate: aggregateExists,
    cssAggregateExists: aggregateExists,
    entry: {
      confidence: entry.explicit ? "explicit-user-selected" : "unique-static-candidate",
      relative: entry.relative
    },
    minimalChangePreview: {
      cssImport: {
        needed: !hasCssImport,
        statement: importStatement,
        target: entry.relative
      },
      themeActivation: {
        detectedStaticActivation: staticActivationPresent,
        needed: themeActivationNeeded,
        preview: activation.preview,
        target: entry.relative
      }
    },
    nextStepPrompt: aggregateExists
      ? `请只在已确认的 Theme 根入口 ${entry.relative} 导入 ${importStatement}${activationInstruction}。不要新增切换按钮、持久化、Provider、Token 或 Scope × Theme CSS；完成前需要第二次确认。`
      : `请先运行已确认的 Token 构建，生成 design-system/dist/index.css；在生成物存在前，不要修改 ${entry.relative}。`,
    runtimeBoundary: "本计划只预览入口接线。现有主题切换、用户偏好、localStorage 和框架 Provider 必须由已确认的项目运行时继续负责。",
    status: aggregateExists ? "ready-for-second-confirmation" : "needs-build",
    uiSourceChanged: false,
    writes: false
  });
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

import { stat } from "node:fs/promises";
import path from "node:path";

import {
  fileExists,
  isWithin,
  parseArgs,
  printJson,
  readJson,
  readTextIfSmall,
  relativePosix,
  reportError,
  requireAbsolutePath,
  requireDirectory,
  requireStringOption,
  walkFiles
} from "./lib.mjs";

const ENTRY_EXTENSIONS = new Set([".astro", ".html", ".jsx", ".tsx", ".js", ".ts", ".vue", ".svelte"]);
const ENTRY_BASENAMES = /^(?:app|index|layout|page|root|route)\.(?:astro|html|jsx|tsx|js|ts|vue|svelte)$/i;

function validateScopeMap(map) {
  if (!map || typeof map !== "object" || Array.isArray(map) || map.version !== 1 || !Array.isArray(map.scopes)) {
    throw new Error("scope-map.json must be an object with version: 1 and a scopes array");
  }
  const byId = new Map();
  for (const scope of map.scopes) {
    if (!scope || typeof scope !== "object" || Array.isArray(scope) || typeof scope.id !== "string" || !scope.id) {
      throw new Error("scope-map.json contains an invalid scope entry");
    }
    if (byId.has(scope.id)) {
      throw new Error(`scope-map.json contains duplicate scope id: ${scope.id}`);
    }
    byId.set(scope.id, scope);
  }
  for (const scope of byId.values()) {
    if (typeof scope.parent !== "string" || !scope.parent || (scope.parent !== "core" && !byId.has(scope.parent))) {
      throw new Error(`scope-map scope ${scope.id} references a missing parent`);
    }
  }
  return byId;
}

function scopeChain(scope, byId) {
  const chain = [];
  const seen = new Set();
  let current = scope;
  while (current) {
    if (seen.has(current.id)) {
      throw new Error(`scope-map.json contains an inheritance cycle at ${current.id}`);
    }
    seen.add(current.id);
    chain.unshift(current.id);
    if (current.parent === "core") {
      return ["core", ...chain];
    }
    current = byId.get(current.parent);
  }
  throw new Error(`Scope ${scope.id} has no Core ancestry`);
}

function globExpression(glob) {
  let expression = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*") {
      if (glob[index + 1] === "*") {
        if (glob[index + 2] === "/") {
          expression += "(?:.*/)?";
          index += 2;
        } else {
          expression += ".*";
          index += 1;
        }
      } else {
        expression += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      expression += "[^/]";
      continue;
    }
    expression += /[|\\{}()[\]^$+?.]/.test(character) ? `\\${character}` : character;
  }
  return new RegExp(`${expression}$`);
}

function matchingGlob(relative, globs) {
  return globs.find((glob) => globExpression(glob).test(relative)) ?? null;
}

function likelyEntry(file) {
  const base = path.basename(file);
  if (ENTRY_BASENAMES.test(base)) {
    return true;
  }
  return /(?:^|\/)(?:pages?|routes?|views?)\/[^/]+\.(?:astro|html|jsx|tsx|js|ts|vue|svelte)$/i.test(file);
}

function candidateScore(relative) {
  const base = path.basename(relative).toLowerCase();
  if (base.startsWith("layout.")) {
    return 40;
  }
  if (base.startsWith("page.")) {
    return 30;
  }
  if (base.startsWith("index.")) {
    return 20;
  }
  if (base.startsWith("root.") || base.startsWith("app.") || base.startsWith("route.")) {
    return 10;
  }
  return 0;
}

async function discoverEntries(projectRoot, sourceGlobs) {
  const files = await walkFiles(projectRoot);
  const candidates = [];
  for (const file of files) {
    const relative = relativePosix(projectRoot, file);
    if (!ENTRY_EXTENSIONS.has(path.extname(file).toLowerCase()) || !matchingGlob(relative, sourceGlobs) || !likelyEntry(relative)) {
      continue;
    }
    candidates.push({ relative, score: candidateScore(relative) });
  }
  return candidates
    .sort((left, right) => right.score - left.score || left.relative.localeCompare(right.relative));
}

function toImportSpecifier(fromDirectory, target) {
  const relative = path.relative(fromDirectory, target).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function importStatementForEntry(entryPath, specifier) {
  if (path.extname(entryPath).toLowerCase() === ".html") {
    return `<link rel="stylesheet" href="${specifier}">`;
  }
  return `import "${specifier}";`;
}

function displayPrompt(scope, chain, candidateEntries, reason) {
  const routes = scope.appliesTo?.routes?.length ? scope.appliesTo.routes.join("、") : "未登记";
  const sourceGlobs = scope.appliesTo?.sourceGlobs?.length ? scope.appliesTo.sourceGlobs.join("、") : "未登记";
  const candidates = candidateEntries.length ? candidateEntries.map((entry) => `- ${entry.relative}`).join("\n") : "- 未找到唯一入口";
  return `请只定位 ${scope.id} 的页面或 Layout 入口，不修改任何文件。\n\n已登记边界：\n- 路由：${routes}\n- 源码范围：${sourceGlobs}\n- 完整 data-ds-scope：${chain.slice(1).join(" ")}\n\n当前无法安全接入的原因：${reason}\n候选入口：\n${candidates}\n\n请确认唯一入口为何只覆盖该 Scope；确认后再进行最小接线。`;
}

function outputBlocked(details) {
  printJson({
    ...details,
    uiSourceChanged: false,
    writes: false
  });
}

async function explicitEntry(projectRoot, value, sourceGlobs) {
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
    throw new Error(`--entry is not a supported page or layout source file: ${relative}`);
  }
  const matchedGlob = matchingGlob(relative, sourceGlobs);
  if (!matchedGlob) {
    throw new Error(`--entry is outside the registered sourceGlobs: ${relative}`);
  }
  return {
    explicit: true,
    matchedGlob,
    relative,
    score: candidateScore(relative)
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = await requireDirectory(requireStringOption(options, "project"), "--project");
  const id = requireStringOption(options, "scope");
  const systemRoot = path.join(projectRoot, "design-system");
  const mapPath = path.join(systemRoot, "scope-map.json");
  if (!(await fileExists(mapPath))) {
    throw new Error("No design-system/scope-map.json found. Create or register the scope before planning integration.");
  }
  const byId = validateScopeMap(await readJson(mapPath));
  const scope = byId.get(id);
  if (!scope) {
    throw new Error(`Scope is not registered in scope-map.json: ${id}`);
  }
  const chain = scopeChain(scope, byId);
  const scopeValue = chain.slice(1).join(" ");
  const base = {
    cssAggregate: "design-system/dist/index.css",
    dataDsScope: `data-ds-scope="${scopeValue}"`,
    projectRoot,
    scope: {
      id: scope.id,
      kind: scope.kind,
      parent: scope.parent,
      status: scope.status ?? "active"
    },
    scopeChain: chain
  };

  if ((scope.status ?? "active") === "reference-only") {
    outputBlocked({
      ...base,
      canIntegrate: false,
      nextStepPrompt: "该 Scope 是 reference-only：仅保留边界与设计说明，不生成或导入运行时 CSS。若需要接入，请先经确认把它改为 active。",
      status: "reference-only"
    });
    return;
  }

  const sourceGlobs = Array.isArray(scope.appliesTo?.sourceGlobs) ? scope.appliesTo.sourceGlobs : [];
  if (sourceGlobs.length === 0) {
    outputBlocked({
      ...base,
      canIntegrate: false,
      nextStepPrompt: displayPrompt(scope, chain, [], "Scope 只有路由边界，无法静态验证唯一源码入口。请先补充 sourceGlobs。"),
      status: "needs-source-boundary"
    });
    return;
  }

  const discovered = await discoverEntries(projectRoot, sourceGlobs);
  let entry = null;
  if (options.entry !== undefined) {
    entry = await explicitEntry(projectRoot, requireStringOption(options, "entry"), sourceGlobs);
  } else if (discovered.length === 1) {
    entry = { ...discovered[0], explicit: false, matchedGlob: matchingGlob(discovered[0].relative, sourceGlobs) };
  }

  if (!entry) {
    const reason = discovered.length === 0
      ? "登记的 sourceGlobs 内没有可识别的 page、layout、route、index 或 root 入口。"
      : "登记的 sourceGlobs 内存在多个可能入口，无法判断哪个根容器只覆盖此 Scope。";
    outputBlocked({
      ...base,
      canIntegrate: false,
      candidateEntries: discovered.map(({ relative, score }) => ({ relative, score })),
      nextStepPrompt: displayPrompt(scope, chain, discovered, reason),
      status: "needs-entry-confirmation"
    });
    return;
  }

  const entryPath = path.join(projectRoot, entry.relative);
  const entryText = await readTextIfSmall(entryPath);
  if (entryText === null) {
    throw new Error(`--entry is too large to inspect safely: ${entry.relative}`);
  }
  const aggregatePath = path.join(systemRoot, "dist", "index.css");
  const importSpecifier = toImportSpecifier(path.dirname(entryPath), aggregatePath);
  const importStatement = importStatementForEntry(entryPath, importSpecifier);
  const hasCssImport = entryText.includes(importSpecifier)
    || /design-system\/dist\/index\.css/.test(entryText);
  const hasScopeAttribute = new RegExp(`data-ds-scope\\s*=\\s*(?:["']${scopeValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']|\\{\\s*["']${scopeValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']\\s*\\})`).test(entryText);
  const aggregateExists = await fileExists(aggregatePath);
  const entryConfidence = entry.explicit ? "explicit-user-selected" : "unique-static-candidate";

  printJson({
    ...base,
    canIntegrate: aggregateExists,
    cssAggregateExists: aggregateExists,
    entry: {
      confidence: entryConfidence,
      matchedSourceGlob: entry.matchedGlob,
      relative: entry.relative
    },
    minimalChangePreview: {
      cssImport: {
        needed: !hasCssImport,
        statement: importStatement,
        target: entry.relative
      },
      scopeAttribute: {
        needed: !hasScopeAttribute,
        preview: `<main data-ds-scope="${scopeValue}">…</main>`,
        target: entry.relative
      }
    },
    nextStepPrompt: aggregateExists
      ? `请仅在 ${entry.relative} 的已确认页面或 Layout 根加入 ${base.dataDsScope}，并在同一确认范围内导入 ${importStatement}。不要改动其他页面、组件、Token 或生成 CSS。`
      : `请先运行已确认的 Token 构建，生成 design-system/dist/index.css；在生成物存在前，不要修改 ${entry.relative}。`,
    status: aggregateExists ? "ready-for-second-confirmation" : "needs-build",
    uiSourceChanged: false,
    writes: false
  });
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

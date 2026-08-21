import path from "node:path";

import {
  parseArgs,
  printJson,
  readTextIfSmall,
  relativePosix,
  reportError,
  requireAbsolutePath,
  requireDirectory,
  requireStringOption,
  walkFiles,
  writeJson
} from "./lib.mjs";

const STYLE_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less", ".html", ".jsx", ".tsx", ".js", ".ts", ".vue", ".svelte"]);
const STYLESHEET_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
const TOKEN_FILE_NAMES = new Set(["tokens.json", "design-tokens.json", "design.tokens.json"]);
const THEME_PATH_WORDS = new Set(["theme", "themes", "mode", "modes", "dark", "light"]);

function pathLooksLikeThemeEvidence(relative) {
  const lower = relative.toLowerCase();
  const segments = lower.split("/");
  for (const segment of segments) {
    const stem = segment.replace(/\.[a-z0-9]+$/i, "");
    for (const word of stem.split(/[-_.]+/).filter(Boolean)) {
      if (THEME_PATH_WORDS.has(word)) {
        return true;
      }
    }
  }
  return false;
}
const ROUTE_ANCHORS = new Set(["app", "apps", "pages", "page", "routes", "route", "views", "view", "features", "feature", "sections", "section"]);
const STRUCTURAL_SEGMENTS = new Set([
  "app", "apps", "assets", "common", "components", "component", "content", "features", "feature", "layouts", "layout",
  "lib", "light", "mode", "modes", "pages", "page", "public", "route", "routes", "sections", "section", "shared", "src", "static", "style", "styles",
  "theme", "themes", "dark", "contrast",
  "test", "tests", "ui", "utils", "view", "views"
]);
const STYLE_IMPORT_EXPRESSION = /(?:^|\n)\s*(?:@import\s+|import(?:[^"']*?from\s+)?)\s*["']([^"']+\.(?:css|scss|sass|less)(?:\?[^"']*)?)["']/gm;
const COMPONENT_EXPRESSION = /(?:button|card|modal|tooltip|navbar|input|dialog|popover|menu|select)/i;
const BRAND_EXPRESSION = /\b(?:brand|identity|brandbook)\b|品牌|视觉识别/i;

function extension(file) {
  return path.extname(file).toLowerCase();
}

function increment(map, value) {
  map.set(value, (map.get(value) ?? 0) + 1);
}

function topValues(map, limit = 30) {
  return [...map.entries()]
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ count, value }));
}

function isDtcgDocument(text) {
  return /"\$(?:value|type)"\s*:/.test(text);
}

function matchStaticValues(text, colors, dimensions) {
  for (const match of text.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g)) {
    increment(colors, match[0].toLowerCase());
  }
  for (const match of text.matchAll(/(?:^|[^\w.-])(\d+(?:\.\d+)?(?:px|rem|em|%|vw|vh))\b/gm)) {
    increment(dimensions, match[1]);
  }
}

function collectCssVariables(text, file, root, definitions) {
  for (const match of text.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+)/g)) {
    definitions.push({
      file: relativePosix(root, file),
      name: match[1],
      value: match[2].trim().slice(0, 160)
    });
  }
}

function collectVariableNames(text) {
  return [...new Set([...text.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map((match) => match[1]))]
    .sort((left, right) => left.localeCompare(right));
}

function recordThemeActivation(evidence, entry) {
  const key = JSON.stringify(entry);
  if (!evidence.some((current) => JSON.stringify(current) === key)) {
    evidence.push(entry);
  }
}

function collectThemeActivationEvidence(text, relative, evidence) {
  const modesFor = new Map();
  function addMode(key, mode) {
    if (!modesFor.has(key)) {
      modesFor.set(key, new Set());
    }
    modesFor.get(key).add(mode);
  }
  for (const match of text.matchAll(/\[\s*(data-(?:theme|color-scheme|mode))\b/gi)) {
    const attribute = match[1].toLowerCase();
    if (!modesFor.has(`data-attribute:${attribute}`)) {
      modesFor.set(`data-attribute:${attribute}`, new Set());
    }
  }
  for (const match of text.matchAll(/\[\s*(data-(?:theme|color-scheme|mode))\s*=\s*["']([a-z][a-z0-9-]*)["']\s*\]/gi)) {
    const attribute = match[1].toLowerCase();
    const key = `data-attribute:${attribute}`;
    addMode(key, match[2].toLowerCase());
  }
  for (const match of text.matchAll(/(?:setAttribute\(\s*["'](data-(?:theme|color-scheme|mode))["']\s*,\s*["']([a-z][a-z0-9-]*)["']|\bdataset\.(theme|colorScheme|mode)\s*=\s*["']([a-z][a-z0-9-]*)["'])/gi)) {
    const attribute = (match[1] ?? (match[3] === "colorScheme" ? "data-color-scheme" : `data-${match[3]}`)).toLowerCase();
    const mode = (match[2] ?? match[4]).toLowerCase();
    addMode(`data-attribute:${attribute}`, mode);
    recordThemeActivation(evidence, {
      attribute,
      file: relative,
      kind: "runtime-data-attribute",
      modes: [mode]
    });
  }
  for (const match of text.matchAll(/(?:^|[\s,{>])(?::root|html)?\.(dark|light)\b/gim)) {
    addMode("class", match[1].toLowerCase());
  }
  for (const match of text.matchAll(/classList\.(?:add|remove|toggle)\(\s*["'](dark|light)["']/gi)) {
    const mode = match[1].toLowerCase();
    addMode("class", mode);
    recordThemeActivation(evidence, { file: relative, kind: "runtime-class", modes: [mode] });
  }
  for (const match of text.matchAll(/prefers-color-scheme\s*:\s*(dark|light)/gi)) {
    const mode = match[1].toLowerCase();
    addMode("media", mode);
  }

  for (const [key, modes] of modesFor) {
    const [kind, attribute] = key.split(":", 2);
    recordThemeActivation(evidence, {
      ...(attribute ? { attribute } : {}),
      file: relative,
      kind,
      modes: [...modes].sort((left, right) => left.localeCompare(right))
    });
  }
}

function themeCandidatesFromEvidence(evidence) {
  const groups = new Map();
  for (const current of evidence) {
    if (!["data-attribute", "class", "media"].includes(current.kind)) {
      continue;
    }
    const activation = current.kind === "data-attribute"
      ? { attribute: current.attribute, kind: current.kind }
      : { kind: current.kind };
    const key = JSON.stringify(activation);
    const group = groups.get(key) ?? { activation, evidence: new Set(), modes: new Set() };
    group.evidence.add(current.file);
    for (const mode of current.modes) {
      group.modes.add(mode);
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      activation: group.activation,
      defaultTheme: null,
      evidence: [...group.evidence].sort((left, right) => left.localeCompare(right)),
      modes: [...group.modes].sort((left, right) => left.localeCompare(right)),
      reason: "Existing theme activation evidence was found. Preserve it as reference-only until the default mode and authority are confirmed.",
      requiresConfirmation: true,
      status: "reference-only"
    }))
    .sort((left, right) => JSON.stringify(left.activation).localeCompare(JSON.stringify(right.activation)));
}

function dedupePaths(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normaliseRoute(value) {
  const route = value.trim();
  if (!route.startsWith("/") || route.startsWith("//") || /:\/\//.test(route) || /[\s?#]/.test(route)) {
    return null;
  }
  return route.length > 1 ? route.replace(/\/+$/, "") : route;
}

function scopeIdFromSegment(value) {
  const normalised = value
    .replace(/^\((?:[^)]+)\)$/, "")
    .replace(/^\[\.\.\.[^\]]+\]$/, "")
    .replace(/^\[([^\]]+)\]$/, "$1")
    .replace(/\.(?:module\.)?(?:css|scss|sass|less|html|jsx|tsx|js|ts|vue|svelte)$/i, "")
    .replace(/(?:\.page|\.route)$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalised || STRUCTURAL_SEGMENTS.has(normalised) || !/^[a-z][a-z0-9-]*$/.test(normalised)) {
    return null;
  }
  return normalised;
}

function routeSegments(route) {
  return route
    .split("/")
    .filter(Boolean)
    .map((segment) => scopeIdFromSegment(segment))
    .filter(Boolean);
}

function extractRouteLiterals(text) {
  const routes = new Set();
  const patterns = [
    /<Route\b[^>]*?\bpath\s*=\s*(?:\{\s*)?["']([^"']+)["']/g,
    /\b(?:path|route)\s*:\s*["']([^"']+)["']/g,
    /\b(?:path|route)\s*=\s*["']([^"']+)["']/g
  ];

  for (const expression of patterns) {
    for (const match of text.matchAll(expression)) {
      const route = normaliseRoute(match[1]);
      if (route) {
        routes.add(route);
      }
    }
  }
  return [...routes].sort((left, right) => left.localeCompare(right));
}

function extractStyleImports(text) {
  return [...new Set([...text.matchAll(STYLE_IMPORT_EXPRESSION)].map((match) => match[1]))]
    .sort((left, right) => left.localeCompare(right));
}

function inferPathScope(relative) {
  const parts = relative.split("/");
  const directories = parts.slice(0, -1);
  let anchor = -1;
  for (let index = 0; index < directories.length; index += 1) {
    if (ROUTE_ANCHORS.has(directories[index].toLowerCase())) {
      anchor = index;
      break;
    }
  }

  let candidates = [];
  let sourceRoot = null;
  if (anchor >= 0) {
    const afterAnchor = directories.slice(anchor + 1);
    const stopAt = afterAnchor.findIndex((segment) => STRUCTURAL_SEGMENTS.has(segment.toLowerCase()));
    candidates = afterAnchor
      .slice(0, stopAt >= 0 ? stopAt : undefined)
      .map(scopeIdFromSegment)
      .filter(Boolean);
    if (candidates.length > 0) {
      sourceRoot = directories.slice(0, anchor + 1 + candidates.length).join("/");
    }
  }

  if (candidates.length === 0 && directories.length >= 2 && directories[0].toLowerCase() === "src") {
    const afterSrc = directories.slice(1);
    const stopAt = afterSrc.findIndex((segment) => STRUCTURAL_SEGMENTS.has(segment.toLowerCase()));
    candidates = afterSrc
      .slice(0, stopAt >= 0 ? stopAt : undefined)
      .map(scopeIdFromSegment)
      .filter(Boolean);
    if (candidates.length > 0) {
      sourceRoot = directories.slice(0, 1 + candidates.length).join("/");
    }
  }
  if (candidates.length === 0 && directories.length > 0) {
    const first = scopeIdFromSegment(directories[0]);
    if (first) {
      candidates = [first];
      sourceRoot = directories[0];
    }
  }
  if (candidates.length === 0) {
    return null;
  }

  return {
    id: candidates.at(-1),
    key: candidates.join("/"),
    sourceRoot,
    suggestedParent: candidates.length > 1 ? candidates.at(-2) : "core"
  };
}

function inferFileRoute(relative) {
  const parts = relative.split("/");
  const directories = parts.slice(0, -1);
  const anchor = directories.findIndex((segment) => ["app", "pages", "routes"].includes(segment.toLowerCase()));
  if (anchor < 0) {
    return null;
  }
  const route = directories
    .slice(anchor + 1)
    .filter((segment) => !["components", "styles"].includes(segment.toLowerCase()))
    .map((segment) => segment.replace(/^\((.+)\)$/, "").replace(/^\[\.\.\.(.+)\]$/, "*$1").replace(/^\[(.+)\]$/, ":$1"))
    .filter(Boolean);
  if (route.length === 0) {
    return null;
  }
  return `/${route.join("/")}`;
}

function scopeFromRoute(route) {
  const segments = routeSegments(route);
  if (segments.length === 0) {
    return null;
  }
  return {
    id: segments.at(-1),
    key: segments.join("/"),
    suggestedParent: segments.length > 1 ? segments.at(-2) : "core"
  };
}

function sourceGlobFromRoot(sourceRoot) {
  if (!sourceRoot) {
    return null;
  }
  return /\.[A-Za-z0-9]+$/.test(sourceRoot) ? sourceRoot : `${sourceRoot}/**`;
}

function createScopeEvidence(seed) {
  return {
    ...seed,
    brandEvidence: new Set(),
    colors: new Map(),
    componentEvidence: new Set(),
    cssVariables: new Set(),
    designDocs: new Set(),
    dimensions: new Map(),
    paths: new Set(),
    routes: new Set(),
    sourceRoots: new Set(),
    styleEntrypoints: new Set(),
    tokenFiles: new Set()
  };
}

function ensureScopeEvidence(groups, seed) {
  const current = groups.get(seed.key);
  if (current) {
    return current;
  }
  const next = createScopeEvidence(seed);
  groups.set(seed.key, next);
  return next;
}

function mergeStaticValues(target, text) {
  const colors = new Map();
  const dimensions = new Map();
  matchStaticValues(text, colors, dimensions);
  for (const [value, count] of colors) {
    target.colors.set(value, (target.colors.get(value) ?? 0) + count);
  }
  for (const [value, count] of dimensions) {
    target.dimensions.set(value, (target.dimensions.get(value) ?? 0) + count);
  }
}

function recordScopeFile(group, details) {
  group.paths.add(details.relative);
  if (details.sourceRoot) {
    group.sourceRoots.add(details.sourceRoot);
  }
  for (const route of details.routes) {
    group.routes.add(route);
  }
  if (details.isStyle) {
    if (details.isStylesheet) {
      group.styleEntrypoints.add(details.relative);
    }
    mergeStaticValues(group, details.text);
    for (const name of collectVariableNames(details.text)) {
      group.cssVariables.add(name);
    }
  }
  if (details.isDesignDoc) {
    group.designDocs.add(details.relative);
  }
  if (details.isToken) {
    group.tokenFiles.add(details.relative);
  }
  if (COMPONENT_EXPRESSION.test(details.relative) || COMPONENT_EXPRESSION.test(details.text)) {
    group.componentEvidence.add(details.relative);
  }
  if (BRAND_EXPRESSION.test(details.relative) || (details.isDesignDoc && BRAND_EXPRESSION.test(details.text))) {
    group.brandEvidence.add(details.relative);
  }
}

function evidenceSignals(group) {
  const signals = [];
  if (group.cssVariables.size >= 2) {
    signals.push({ count: group.cssVariables.size, kind: "css-variable-definitions" });
  }
  if (group.colors.size >= 2 || [...group.colors.values()].some((count) => count >= 2)) {
    signals.push({ count: group.colors.size, kind: "color-literals" });
  }
  if (group.dimensions.size >= 2 || [...group.dimensions.values()].some((count) => count >= 2)) {
    signals.push({ count: group.dimensions.size, kind: "dimension-literals" });
  }
  if (group.designDocs.size > 0 || group.tokenFiles.size > 0) {
    signals.push({ count: group.designDocs.size + group.tokenFiles.size, kind: "local-design-contract" });
  }
  if (group.componentEvidence.size > 0) {
    signals.push({ count: group.componentEvidence.size, kind: "component-contract-evidence" });
  }
  return signals;
}

function toScopeCandidate(group) {
  const signals = evidenceSignals(group);
  const sourceGlobs = dedupePaths([...group.sourceRoots].map(sourceGlobFromRoot).filter(Boolean));
  const routes = dedupePaths(group.routes);
  const hasLocalContract = signals.some((signal) => (
    signal.kind === "css-variable-definitions" || signal.kind === "local-design-contract"
  )) || group.styleEntrypoints.size > 0;
  if ((routes.length === 0 && sourceGlobs.length === 0) || signals.length < 2 || !hasLocalContract) {
    return null;
  }

  const routeDepth = Math.max(0, ...routes.map((route) => routeSegments(route).length));
  const kind = routeDepth > 1 || group.key.includes("/") ? "page" : "section";
  const confidence = routes.length > 0 && sourceGlobs.length > 0 && signals.length >= 3 ? "high" : "medium";
  return {
    appliesTo: {
      ...(routes.length > 0 ? { routes } : {}),
      ...(sourceGlobs.length > 0 ? { sourceGlobs } : {})
    },
    confidence,
    evidence: {
      groupedSignals: signals,
      paths: dedupePaths(group.paths),
      styleEntrypoints: dedupePaths(group.styleEntrypoints)
    },
    id: group.id,
    kind,
    reason: "Static grouped evidence suggests a bounded local visual vocabulary; confirm intent before creating a scope.",
    requiresConfirmation: true,
    suggestedParent: group.suggestedParent
  };
}

function toIndependentSystemCandidate(group) {
  const sourceGlobs = dedupePaths([...group.sourceRoots].map(sourceGlobFromRoot).filter(Boolean));
  const routes = dedupePaths(group.routes);
  const hasDesignContract = group.designDocs.size > 0 || group.tokenFiles.size > 0;
  const hasBrandEvidence = group.brandEvidence.size > 0;
  const hasSeparateEntry = routes.length > 0 && sourceGlobs.length > 0;
  const hasComponentContract = group.componentEvidence.size > 0;
  if (!hasDesignContract || !hasBrandEvidence || !hasSeparateEntry || !hasComponentContract) {
    return null;
  }

  return {
    confidence: evidenceSignals(group).length >= 3 ? "high" : "medium",
    evidence: {
      componentContract: dedupePaths(group.componentEvidence),
      brand: dedupePaths(group.brandEvidence),
      designContract: dedupePaths([...group.designDocs, ...group.tokenFiles]),
      entry: {
        routes,
        sourceGlobs
      }
    },
    id: group.id,
    reason: "Separate design-contract, entry, and component-contract evidence coexist. Confirm whether this is a separate design system rather than a local scope.",
    requiresConfirmation: true
  };
}

function sortedCandidates(values) {
  return values.sort((left, right) => `${left.id}:${left.kind ?? ""}`.localeCompare(`${right.id}:${right.kind ?? ""}`));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = await requireDirectory(requireStringOption(options, "project"), "--project");
  const files = await walkFiles(projectRoot);
  const cssVariables = [];
  const colors = new Map();
  const componentVariableFiles = [];
  const designDocs = [];
  const dtcgTokenFiles = [];
  const imageEvidence = [];
  const nonstandardTokenFiles = [];
  const packageLocks = [];
  const tailwindConfigs = [];
  const themeEvidence = [];
  const agentRules = [];
  const dimensions = new Map();
  const routeEvidence = new Map();
  const styleEntrypoints = [];
  const styleImportEvidence = [];
  const scopeGroups = new Map();
  const themeActivationEvidence = [];

  for (const file of files) {
    const relative = relativePosix(projectRoot, file);
    const lower = relative.toLowerCase();
    const base = path.basename(file).toLowerCase();
    const ext = extension(file);
    const isDesignDoc = base === "design.md" || (lower.includes("design-system") && ext === ".md");
    const isTokenName = base.endsWith(".tokens.json") || TOKEN_FILE_NAMES.has(base) || /(?:^|\/)(?:tokens?)(?:\/|$)/.test(lower);
    const isStyle = STYLE_EXTENSIONS.has(ext);
    const isStylesheet = STYLESHEET_EXTENSIONS.has(ext);

    if (["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"].includes(base)) {
      packageLocks.push(relative);
    }
    if (/^tailwind\.config\.(?:js|cjs|mjs|ts)$/.test(base)) {
      tailwindConfigs.push(relative);
    }
    if (isDesignDoc) {
      designDocs.push(relative);
    }
    if (base === "agents.md" || base === "claude.md" || lower.startsWith(".claude/rules/") || lower.startsWith(".cursor/rules/")) {
      agentRules.push(relative);
    }
    if (IMAGE_EXTENSIONS.has(ext)) {
      imageEvidence.push(relative);
    }
    if (pathLooksLikeThemeEvidence(relative)) {
      themeEvidence.push(relative);
    }

    if (!isTokenName && !isStyle && !isDesignDoc) {
      continue;
    }

    const text = await readTextIfSmall(file);
    if (text === null) {
      continue;
    }

    if (isTokenName && ext === ".json") {
      if (isDtcgDocument(text)) {
        dtcgTokenFiles.push(relative);
      } else {
        nonstandardTokenFiles.push(relative);
      }
    }
    if (isStyle) {
      matchStaticValues(text, colors, dimensions);
      collectCssVariables(text, file, projectRoot, cssVariables);
      if (isStylesheet) {
        styleEntrypoints.push(relative);
      }
      const imports = extractStyleImports(text);
      if (imports.length > 0) {
        styleImportEvidence.push({ file: relative, imports });
      }
      if (/--[^;{}]*(?:button|card|modal|tooltip|navbar|input)/i.test(text)) {
        componentVariableFiles.push(relative);
      }
      if (/\[data-theme|prefers-color-scheme|\.dark\b|\.light\b/i.test(text)) {
        themeEvidence.push(relative);
      }
      collectThemeActivationEvidence(text, relative, themeActivationEvidence);
    }

    const fileRoutes = new Set(extractRouteLiterals(text));
    const inferredRoute = isStyle ? inferFileRoute(relative) : null;
    if (inferredRoute) {
      fileRoutes.add(inferredRoute);
    }
    if (fileRoutes.size > 0) {
      routeEvidence.set(relative, [...fileRoutes].sort((left, right) => left.localeCompare(right)));
    }

    const pathScope = inferPathScope(relative);
    const groupsForFile = new Map();
    if (pathScope) {
      groupsForFile.set(pathScope.key, {
        ...pathScope,
        routes: [...fileRoutes]
      });
    }
    for (const route of fileRoutes) {
      const routeScope = scopeFromRoute(route);
      if (routeScope) {
        const current = groupsForFile.get(routeScope.key) ?? { ...routeScope, routes: [] };
        current.routes = [...new Set([...current.routes, route])];
        groupsForFile.set(routeScope.key, current);
      }
    }

    for (const seed of groupsForFile.values()) {
      const group = ensureScopeEvidence(scopeGroups, seed);
      recordScopeFile(group, {
        isDesignDoc,
        isStyle,
        isStylesheet,
        isToken: isTokenName && ext === ".json",
        relative,
        routes: seed.routes,
        sourceRoot: pathScope?.key === seed.key ? pathScope.sourceRoot : null,
        text
      });
    }
  }

  const sourceCandidates = [];
  if (dtcgTokenFiles.length > 0) {
    sourceCandidates.push({
      confidence: "high",
      evidence: dedupePaths(dtcgTokenFiles),
      id: "dtcg-json",
      label: "DTCG token JSON"
    });
  }
  if (nonstandardTokenFiles.length > 0) {
    sourceCandidates.push({
      confidence: "medium",
      evidence: dedupePaths(nonstandardTokenFiles),
      id: "legacy-token-json",
      label: "Non-standard token JSON"
    });
  }
  if (cssVariables.length > 0) {
    sourceCandidates.push({
      confidence: "high",
      evidence: dedupePaths(cssVariables.map((definition) => definition.file)),
      id: "css-variables",
      label: "CSS variable definitions"
    });
  }
  if (tailwindConfigs.length > 0) {
    sourceCandidates.push({
      confidence: "medium",
      evidence: dedupePaths(tailwindConfigs),
      id: "tailwind-config",
      label: "Tailwind configuration"
    });
  }

  const packageManager = packageLocks.length === 1
    ? ({
      "bun.lock": "bun",
      "bun.lockb": "bun",
      "package-lock.json": "npm",
      "pnpm-lock.yaml": "pnpm",
      "yarn.lock": "yarn"
    })[path.basename(packageLocks[0])]
    : null;
  const status = sourceCandidates.length > 1 ? "needs-decision" : "ready-to-propose";
  const scopeCandidates = sortedCandidates([...scopeGroups.values()]
    .map(toScopeCandidate)
    .filter(Boolean));
  const independentSystemCandidates = sortedCandidates([...scopeGroups.values()]
    .map(toIndependentSystemCandidate)
    .filter(Boolean));
  const report = {
    agentRules: dedupePaths(agentRules),
    auditVersion: 3,
    componentExceptionEvidence: dedupePaths(componentVariableFiles),
    confidence: sourceCandidates.length === 0 ? "low" : sourceCandidates.length === 1 ? "medium" : "high",
    designDocs: dedupePaths(designDocs),
    evidenceLimits: [
      "Static files were scanned only inside the specified project root.",
      "Repeated literal values are candidates, not semantic decisions.",
      "Scope and independent-system candidates require grouped static evidence and always need user confirmation.",
      "Images and Figma exports are recorded as optional evidence; their pixels are not interpreted by this script."
    ],
    filesScanned: files.length,
    generatedAt: null,
    imageEvidence: dedupePaths(imageEvidence).slice(0, 30),
    independentSystemCandidates,
    packageManager: packageManager ?? (packageLocks.length > 1 ? "conflict" : null),
    packageLocks: dedupePaths(packageLocks),
    projectRoot,
    repeatedStaticValues: {
      colors: topValues(colors),
      dimensions: topValues(dimensions)
    },
    requiresSourceChoice: status === "needs-decision",
    routeEvidence: [...routeEvidence.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([file, routes]) => ({ file, routes })),
    scopeCandidates,
    sourceCandidates,
    status,
    styleEntrypoints: dedupePaths(styleEntrypoints),
    styleImportEvidence: styleImportEvidence.sort((left, right) => left.file.localeCompare(right.file)),
    suggestedStartingPoint: sourceCandidates.length === 0 ? "new-dtcg" : null,
    tailwindConfigs: dedupePaths(tailwindConfigs),
    themeActivationEvidence: themeActivationEvidence.sort((left, right) => (
      `${left.kind}:${left.attribute ?? ""}:${left.file}`.localeCompare(`${right.kind}:${right.attribute ?? ""}:${right.file}`)
    )),
    themeCandidates: themeCandidatesFromEvidence(themeActivationEvidence),
    themeEvidence: dedupePaths(themeEvidence),
    totalCssVariableDefinitions: cssVariables.length,
    variableSamples: cssVariables
      .sort((left, right) => `${left.file}:${left.name}`.localeCompare(`${right.file}:${right.name}`))
      .slice(0, 40),
    writes: false
  };

  if (options.out) {
    const output = requireAbsolutePath(options.out, "--out");
    await writeJson(output, report);
  }
  printJson(report);
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

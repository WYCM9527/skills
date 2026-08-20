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
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
const TOKEN_FILE_NAMES = new Set(["tokens.json", "design-tokens.json", "design.tokens.json"]);

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

function dedupePaths(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
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

  for (const file of files) {
    const relative = relativePosix(projectRoot, file);
    const lower = relative.toLowerCase();
    const base = path.basename(file).toLowerCase();
    const ext = extension(file);

    if (["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"].includes(base)) {
      packageLocks.push(relative);
    }
    if (/^tailwind\.config\.(?:js|cjs|mjs|ts)$/.test(base)) {
      tailwindConfigs.push(relative);
    }
    if (base === "design.md" || (lower.includes("design-system") && ext === ".md")) {
      designDocs.push(relative);
    }
    if (base === "agents.md" || base === "claude.md" || lower.startsWith(".claude/rules/") || lower.startsWith(".cursor/rules/")) {
      agentRules.push(relative);
    }
    if (IMAGE_EXTENSIONS.has(ext)) {
      imageEvidence.push(relative);
    }
    if (/(?:^|\/)(?:themes?|modes?)(?:\/|$)|(?:dark|light|theme)/.test(lower)) {
      themeEvidence.push(relative);
    }

    const isTokenName = base.endsWith(".tokens.json") || TOKEN_FILE_NAMES.has(base) || /(?:^|\/)tokens?(?:\/|$)/.test(lower);
    const isStyle = STYLE_EXTENSIONS.has(ext);
    if (!isTokenName && !isStyle) {
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
      if (/--[^;{}]*(?:button|card|modal|tooltip|navbar|input)/i.test(text)) {
        componentVariableFiles.push(relative);
      }
      if (/\[data-theme|prefers-color-scheme|\.dark\b|\.light\b/i.test(text)) {
        themeEvidence.push(relative);
      }
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
  const report = {
    agentRules: dedupePaths(agentRules),
    auditVersion: 1,
    componentExceptionEvidence: dedupePaths(componentVariableFiles),
    confidence: sourceCandidates.length === 0 ? "low" : sourceCandidates.length === 1 ? "medium" : "high",
    designDocs: dedupePaths(designDocs),
    evidenceLimits: [
      "Static files were scanned only inside the specified project root.",
      "Repeated literal values are candidates, not semantic decisions.",
      "Images and Figma exports are recorded as optional evidence; their pixels are not interpreted by this script."
    ],
    filesScanned: files.length,
    generatedAt: null,
    imageEvidence: dedupePaths(imageEvidence).slice(0, 30),
    packageManager: packageManager ?? (packageLocks.length > 1 ? "conflict" : null),
    packageLocks: dedupePaths(packageLocks),
    projectRoot,
    repeatedStaticValues: {
      colors: topValues(colors),
      dimensions: topValues(dimensions)
    },
    requiresSourceChoice: status === "needs-decision",
    sourceCandidates,
    status,
    suggestedStartingPoint: sourceCandidates.length === 0 ? "new-dtcg" : null,
    tailwindConfigs: dedupePaths(tailwindConfigs),
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

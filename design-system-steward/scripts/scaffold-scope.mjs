import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  fileExists,
  parseArgs,
  printJson,
  readJson,
  reportError,
  requireDirectory,
  requireStringOption,
  skillRoot,
  writeJson,
  writeText
} from "./lib.mjs";

const scaffoldRoot = path.join(skillRoot, "assets", "scaffold");
const VALID_KINDS = new Set(["page", "section"]);
const VALID_STATUSES = new Set(["active", "reference-only"]);
const LEGACY_STYLE_DICTIONARY_CONFIG = `import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const outputRoot = process.env.DS_OUTPUT_DIR
  ? path.resolve(process.env.DS_OUTPUT_DIR)
  : path.join(root, "dist");

export default {
  source: [path.join(root, "tokens/**/*.tokens.json")],
  platforms: {
    css: {
      transformGroup: "css",
      buildPath: \`${"${outputRoot}"}\${path.sep}\`,
      files: [
        {
          destination: "tokens.css",
          format: "css/variables",
          options: {
            outputReferences: true,
            showFileHeader: false
          }
        }
      ]
    }
  }
};
`;

function normalisedText(text) {
  return text.replace(/\r\n/g, "\n").trim();
}

async function upgradeLegacyConfigIfSafe(systemRoot) {
  const configPath = path.join(systemRoot, "style-dictionary.config.mjs");
  const current = await readFile(configPath, "utf8");
  if (normalisedText(current) === normalisedText(LEGACY_STYLE_DICTIONARY_CONFIG)) {
    const replacement = await readFile(path.join(scaffoldRoot, "style-dictionary.config.mjs"), "utf8");
    if (!replacement.includes("DS_SCOPE_SOURCE") || !replacement.includes("design-system-steward/scope-delta")) {
      throw new Error("The installed v0.2 scaffold config is missing the required Scope build hook");
    }
    await writeText(configPath, replacement);
    return true;
  }
  if (!current.includes("DS_SCOPE_SOURCE") || !current.includes("design-system-steward/scope-delta")) {
    throw new Error("style-dictionary.config.mjs is not the untouched v0.1 scaffold. Refusing to overwrite a customized config; upgrade it manually before creating an active Scope.");
  }
  return false;
}

function listOption(options, key) {
  const raw = options[key];
  if (raw === undefined) {
    return [];
  }
  if (typeof raw !== "string") {
    throw new Error(`--${key} must be a comma-separated string`);
  }
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) {
    throw new Error(`--${key} cannot be empty`);
  }
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function validateScopeId(value, label = "--scope") {
  if (!/^[a-z][a-z0-9-]*$/.test(value) || value === "core") {
    throw new Error(`${label} must be a lowercase kebab-case id other than core`);
  }
  return value;
}

function validateRoute(route) {
  if (!route.startsWith("/") || route.startsWith("//") || /[\s?#]/.test(route) || route.includes("..")) {
    throw new Error(`Invalid route boundary: ${route}`);
  }
  return route.length > 1 ? route.replace(/\/+$/, "") : route;
}

function validateSourceGlob(glob) {
  if (path.isAbsolute(glob) || glob.includes("\\") || glob.includes("\0") || glob.split("/").includes("..")) {
    throw new Error(`Source glob must be a project-relative forward-slash path: ${glob}`);
  }
  return glob.replace(/^\.\//, "").replace(/\/+$/, "");
}

async function requireSourceGlobRoots(projectRoot, globs) {
  for (const glob of globs) {
    const literalPrefix = glob.split(/[\[*?]/, 1)[0].replace(/\/+$/, "");
    if (!literalPrefix) {
      throw new Error(`Source glob must start with a project-relative path: ${glob}`);
    }
    const candidate = path.resolve(projectRoot, literalPrefix);
    const relative = path.relative(projectRoot, candidate);
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
      throw new Error(`Source glob escapes the project boundary: ${glob}`);
    }
    try {
      await stat(candidate);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        throw new Error(`Source glob has no existing project evidence: ${glob}`);
      }
      throw error;
    }
  }
}

function validScopeMap(map) {
  if (!map || typeof map !== "object" || Array.isArray(map) || map.version !== 1 || !Array.isArray(map.scopes)) {
    throw new Error("scope-map.json must be an object with version: 1 and a scopes array");
  }
  const ids = new Set();
  for (const scope of map.scopes) {
    if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
      throw new Error("scope-map.json contains an invalid scope entry");
    }
    const id = validateScopeId(scope.id, "scope-map scope id");
    if (ids.has(id)) {
      throw new Error(`scope-map.json contains duplicate scope id: ${id}`);
    }
    ids.add(id);
    if (!VALID_KINDS.has(scope.kind)) {
      throw new Error(`scope-map scope ${id} has invalid kind`);
    }
    if (typeof scope.parent !== "string" || !scope.parent) {
      throw new Error(`scope-map scope ${id} has no parent`);
    }
    if (!scope.appliesTo || typeof scope.appliesTo !== "object" || Array.isArray(scope.appliesTo)) {
      throw new Error(`scope-map scope ${id} has no appliesTo object`);
    }
    const routeCount = Array.isArray(scope.appliesTo.routes) ? scope.appliesTo.routes.length : 0;
    const sourceCount = Array.isArray(scope.appliesTo.sourceGlobs) ? scope.appliesTo.sourceGlobs.length : 0;
    if (routeCount + sourceCount === 0) {
      throw new Error(`scope-map scope ${id} has no page boundary`);
    }
    if (typeof scope.reason !== "string" || !scope.reason.trim()) {
      throw new Error(`scope-map scope ${id} has no reason`);
    }
    if (scope.status !== undefined && !VALID_STATUSES.has(scope.status)) {
      throw new Error(`scope-map scope ${id} has invalid status`);
    }
  }
  for (const scope of map.scopes) {
    if (scope.parent !== "core" && !ids.has(scope.parent)) {
      throw new Error(`scope-map scope ${scope.id} references missing parent ${scope.parent}`);
    }
  }
}

async function readOrCreateScopeMap(systemRoot) {
  const mapPath = path.join(systemRoot, "scope-map.json");
  if (!(await fileExists(mapPath))) {
    return {
      created: true,
      map: { scopes: [], version: 1 },
      mapPath
    };
  }
  const map = await readJson(mapPath);
  validScopeMap(map);
  return { created: false, map, mapPath };
}

function boundaryBase(value) {
  return value.replace(/\*.*$/, "").replace(/\/+$/, "") || "/";
}

function boundariesOverlap(left, right) {
  const leftBase = boundaryBase(left);
  const rightBase = boundaryBase(right);
  return leftBase === rightBase || leftBase.startsWith(`${rightBase}/`) || rightBase.startsWith(`${leftBase}/`);
}

function assertNoSiblingBoundaryOverlap(existingScopes, parent, routes, sourceGlobs) {
  for (const sibling of existingScopes.filter((scope) => scope.parent === parent)) {
    for (const route of routes) {
      for (const siblingRoute of sibling.appliesTo.routes ?? []) {
        if (boundariesOverlap(route, siblingRoute)) {
          throw new Error(`Scope route boundary overlaps sibling ${sibling.id}: ${route} ↔ ${siblingRoute}`);
        }
      }
    }
    for (const sourceGlob of sourceGlobs) {
      for (const siblingGlob of sibling.appliesTo.sourceGlobs ?? []) {
        if (boundariesOverlap(sourceGlob, siblingGlob)) {
          throw new Error(`Scope source boundary overlaps sibling ${sibling.id}: ${sourceGlob} ↔ ${siblingGlob}`);
        }
      }
    }
  }
}

function renderList(values, fallback) {
  return values.length > 0 ? values.map((value) => `- \`${value}\``).join("\n") : fallback;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = await requireDirectory(requireStringOption(options, "project"), "--project");
  const systemRoot = path.join(projectRoot, "design-system");
  await requireDirectory(systemRoot, "design-system");

  const id = validateScopeId(requireStringOption(options, "scope"));
  const kind = requireStringOption(options, "kind");
  if (!VALID_KINDS.has(kind)) {
    throw new Error("--kind must be section or page");
  }
  const parent = requireStringOption(options, "parent");
  if (parent !== "core") {
    validateScopeId(parent, "--parent");
  }
  const reason = requireStringOption(options, "reason").trim();
  const status = options.status === undefined ? "active" : requireStringOption(options, "status");
  if (!VALID_STATUSES.has(status)) {
    throw new Error("--status must be active or reference-only");
  }

  const routes = listOption(options, "routes").map(validateRoute);
  const sourceGlobs = listOption(options, "source-globs").map(validateSourceGlob);
  if (routes.length + sourceGlobs.length === 0) {
    throw new Error("Provide at least one --routes or --source-globs boundary");
  }
  await requireSourceGlobRoots(projectRoot, sourceGlobs);

  const { created: scopeMapCreated, map, mapPath } = await readOrCreateScopeMap(systemRoot);
  const scopeIds = new Set(map.scopes.map((scope) => scope.id));
  if (scopeIds.has(id)) {
    throw new Error(`Scope already exists in scope-map.json: ${id}`);
  }
  if (parent !== "core" && !scopeIds.has(parent)) {
    throw new Error(`Parent scope does not exist: ${parent}`);
  }
  assertNoSiblingBoundaryOverlap(map.scopes, parent, routes, sourceGlobs);

  const scopeRoot = path.join(systemRoot, "scopes", id);
  if (await fileExists(scopeRoot)) {
    throw new Error(`Refusing to overwrite existing scope directory: ${scopeRoot}`);
  }
  const template = await readFile(path.join(scaffoldRoot, "SCOPE.md"), "utf8");
  const optionalFields = {};
  if (typeof options.owner === "string" && options.owner.trim()) {
    optionalFields.owner = options.owner.trim();
  }
  if (typeof options["review-by"] === "string" && options["review-by"].trim()) {
    optionalFields.reviewBy = options["review-by"].trim();
  }
  const scope = {
    appliesTo: {
      ...(routes.length > 0 ? { routes } : {}),
      ...(sourceGlobs.length > 0 ? { sourceGlobs } : {})
    },
    id,
    kind,
    parent,
    reason,
    status,
    ...optionalFields
  };
  const scopeDocument = template
    .replaceAll("{{SCOPE_ID}}", id)
    .replaceAll("{{PARENT}}", parent)
    .replaceAll("{{KIND}}", kind)
    .replaceAll("{{STATUS}}", status)
    .replaceAll("{{REASON}}", reason)
    .replaceAll("{{ROUTES}}", renderList(routes, "- 未登记路由边界。"))
    .replaceAll("{{SOURCE_GLOBS}}", renderList(sourceGlobs, "- 未登记源码边界。"));

  const configUpgraded = status === "active" ? await upgradeLegacyConfigIfSafe(systemRoot) : false;
  await mkdir(path.join(scopeRoot, "tokens"), { recursive: true });
  await writeText(path.join(scopeRoot, "SCOPE.md"), scopeDocument);
  await writeJson(mapPath, {
    ...map,
    scopes: [...map.scopes, scope].sort((left, right) => left.id.localeCompare(right.id)),
    version: 1
  });

  printJson({
    created: [
      `design-system/scopes/${id}/SCOPE.md`,
      `design-system/scopes/${id}/tokens/`,
      ...(configUpgraded ? ["design-system/style-dictionary.config.mjs (upgraded v0.1 scaffold)"] : []),
      ...(scopeMapCreated ? ["design-system/scope-map.json"] : [])
    ],
    projectRoot,
    scope,
    scopeMap: "design-system/scope-map.json",
    scopeMapCreated,
    styleDictionaryConfigUpgraded: configUpgraded,
    uiSourceChanged: false
  });
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

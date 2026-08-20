import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  fileExists,
  isWithin,
  parseArgs,
  printJson,
  readJson,
  relativePosix,
  reportError,
  requireDirectory,
  requireStringOption
} from "./lib.mjs";
import {
  loadTokenDirectory,
  validateTokenRecords
} from "./tokens.mjs";

const SCOPE_ID = /^[a-z][a-z0-9-]*$/;
const SCOPE_KINDS = new Set(["section", "page"]);
const SCOPE_STATUSES = new Set(["active", "reference-only"]);
const THEME_ACTIVATION_KINDS = new Set(["data-attribute", "class", "media"]);
const THEME_ID = /^[a-z][a-z0-9-]*$/;
const THEME_STATUSES = new Set(["active", "reference-only"]);

function issue(issues, code, message, details = {}) {
  issues.push({ code, message, severity: "error", ...details });
}

function warning(issues, code, message, details = {}) {
  issues.push({ code, message, severity: "warning", ...details });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeStringArray(value, field, scope, issues) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    issue(issues, "invalid-scope-boundary", `${scope}: appliesTo.${field} must be an array of non-empty strings`, {
      scope,
      field
    });
    return [];
  }
  return [...new Set(value.map((item) => item.trim()))].sort((left, right) => left.localeCompare(right));
}

function normalizeScope(raw, position, issues) {
  const label = `scope at index ${position}`;
  if (!isPlainObject(raw)) {
    issue(issues, "invalid-scope-entry", `${label} must be an object`);
    return null;
  }

  const id = raw.id;
  if (typeof id !== "string" || !SCOPE_ID.test(id)) {
    issue(issues, "invalid-scope-id", `${label} must have an id matching ${SCOPE_ID}`, { scope: id });
    return null;
  }
  if (!SCOPE_KINDS.has(raw.kind)) {
    issue(issues, "invalid-scope-kind", `${id}: kind must be section or page`, { scope: id });
  }
  if (typeof raw.parent !== "string" || !raw.parent.trim()) {
    issue(issues, "missing-scope-parent", `${id}: parent is required`, { scope: id });
  }
  if (typeof raw.reason !== "string" || !raw.reason.trim()) {
    issue(issues, "missing-scope-reason", `${id}: reason is required`, { scope: id });
  }

  const status = raw.status ?? "active";
  if (!SCOPE_STATUSES.has(status)) {
    issue(issues, "invalid-scope-status", `${id}: status must be active or reference-only`, { scope: id });
  }
  const appliesTo = isPlainObject(raw.appliesTo) ? raw.appliesTo : {};
  if (!isPlainObject(raw.appliesTo)) {
    issue(issues, "missing-scope-boundary", `${id}: appliesTo is required`, { scope: id });
  }
  const routes = safeStringArray(appliesTo.routes, "routes", id, issues);
  const sourceGlobs = safeStringArray(appliesTo.sourceGlobs, "sourceGlobs", id, issues);
  if (routes.length === 0 && sourceGlobs.length === 0) {
    issue(issues, "missing-scope-boundary", `${id}: at least one route or source glob is required`, { scope: id });
  }

  return {
    appliesTo: { routes, sourceGlobs },
    id,
    kind: raw.kind,
    owner: raw.owner,
    parent: typeof raw.parent === "string" ? raw.parent.trim() : raw.parent,
    raw,
    reason: typeof raw.reason === "string" ? raw.reason.trim() : raw.reason,
    reviewBy: raw.reviewBy,
    status
  };
}

function normalizeThemeActivation(raw, issues) {
  if (!isPlainObject(raw) || typeof raw.kind !== "string" || !THEME_ACTIVATION_KINDS.has(raw.kind)) {
    issue(
      issues,
      "invalid-theme-activation",
      "theme-map.json activation must use kind: data-attribute, class, or media"
    );
    return null;
  }

  if (raw.kind === "data-attribute") {
    if (typeof raw.attribute !== "string" || !/^data-[a-z][a-z0-9-]*$/.test(raw.attribute)) {
      issue(
        issues,
        "invalid-theme-activation-attribute",
        "data-attribute activation requires a lowercase data-* attribute"
      );
      return null;
    }
    return { attribute: raw.attribute, kind: raw.kind };
  }

  if (raw.attribute !== undefined) {
    issue(
      issues,
      "invalid-theme-activation-attribute",
      `${raw.kind} activation cannot declare an attribute`
    );
    return null;
  }
  return { kind: raw.kind };
}

function normalizeTheme(raw, position, defaultTheme, issues) {
  const label = `theme at index ${position}`;
  if (!isPlainObject(raw)) {
    issue(issues, "invalid-theme-entry", `${label} must be an object`);
    return null;
  }
  const id = raw.id;
  if (typeof id !== "string" || !THEME_ID.test(id)) {
    issue(issues, "invalid-theme-id", `${label} must have a lowercase kebab-case id`, { theme: id });
    return null;
  }
  if (id === defaultTheme) {
    issue(
      issues,
      "default-theme-must-be-core",
      `${id}: the confirmed default theme is represented by Core and cannot have a Theme delta`,
      { theme: id }
    );
  }
  if (typeof raw.reason !== "string" || !raw.reason.trim()) {
    issue(issues, "missing-theme-reason", `${id}: reason is required`, { theme: id });
  }
  const status = raw.status ?? "active";
  if (!THEME_STATUSES.has(status)) {
    issue(issues, "invalid-theme-status", `${id}: status must be active or reference-only`, { theme: id });
  }
  if (typeof raw.source !== "string" || !raw.source.trim()) {
    issue(issues, "missing-theme-source", `${id}: source is required`, { theme: id });
  }
  if (typeof raw.runtimeOwner !== "string" || !raw.runtimeOwner.trim()) {
    issue(issues, "missing-theme-runtime-owner", `${id}: runtimeOwner is required`, { theme: id });
  }
  return {
    id,
    owner: raw.owner,
    raw,
    reason: typeof raw.reason === "string" ? raw.reason.trim() : raw.reason,
    reviewBy: raw.reviewBy,
    runtimeOwner: typeof raw.runtimeOwner === "string" ? raw.runtimeOwner.trim() : raw.runtimeOwner,
    source: typeof raw.source === "string" ? raw.source.trim() : raw.source,
    status
  };
}

function staticPrefix(glob) {
  const wildcard = glob.search(/[*!?[{]/);
  const prefix = wildcard === -1 ? glob : glob.slice(0, wildcard);
  return prefix.replace(/\/+$/, "");
}

function globsMayOverlap(left, right) {
  if (left === right) {
    return true;
  }
  const leftPrefix = staticPrefix(left);
  const rightPrefix = staticPrefix(right);
  if (!leftPrefix || !rightPrefix) {
    return true;
  }
  return leftPrefix === rightPrefix
    || leftPrefix.startsWith(`${rightPrefix}/`)
    || rightPrefix.startsWith(`${leftPrefix}/`);
}

function checkSiblingBoundaryOverlap(scopes, issues) {
  const siblings = new Map();
  for (const scope of scopes) {
    if (!siblings.has(scope.parent)) {
      siblings.set(scope.parent, []);
    }
    siblings.get(scope.parent).push(scope);
  }

  for (const entries of siblings.values()) {
    for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
        const left = entries[leftIndex];
        const right = entries[rightIndex];
        for (const field of ["routes", "sourceGlobs"]) {
          for (const leftBoundary of left.appliesTo[field]) {
            for (const rightBoundary of right.appliesTo[field]) {
              if (globsMayOverlap(leftBoundary, rightBoundary)) {
                issue(
                  issues,
                  "sibling-scope-boundary-overlap",
                  `${left.id} and ${right.id} have potentially overlapping ${field}: ${leftBoundary} / ${rightBoundary}`,
                  { left: left.id, right: right.id, field, leftBoundary, rightBoundary }
                );
              }
            }
          }
        }
      }
    }
  }
}

function sortIssues(issues) {
  const unique = new Map();
  for (const current of issues) {
    const key = JSON.stringify([
      current.code,
      current.scope,
      current.token,
      current.reference,
      current.message
    ]);
    if (!unique.has(key)) {
      unique.set(key, current);
    }
  }
  return [...unique.values()].sort((left, right) => {
    const leftKey = `${left.code}:${left.scope ?? ""}:${left.token ?? ""}:${left.reference ?? ""}:${left.message}`;
    const rightKey = `${right.code}:${right.scope ?? ""}:${right.token ?? ""}:${right.reference ?? ""}:${right.message}`;
    return leftKey.localeCompare(rightKey);
  });
}

function selectorForChain(chain) {
  if (chain.length === 0) {
    return ":root";
  }
  return chain.map((id) => `[data-ds-scope~="${id}"]`).join("");
}

function selectorForTheme(theme, themeMap) {
  if (themeMap.activation.kind === "data-attribute") {
    return `:root[${themeMap.activation.attribute}="${theme.id}"]`;
  }
  return themeMap.activation.kind === "class" ? `:root.${theme.id}` : ":root";
}

function mediaQueryForTheme(theme, themeMap) {
  return themeMap.activation.kind === "media"
    ? `(prefers-color-scheme: ${theme.id})`
    : null;
}

function scopeChainFor(id, scopesById, issues) {
  const state = new Map();
  const stack = [];

  function visit(currentId) {
    if (currentId === "core") {
      return [];
    }
    const current = scopesById.get(currentId);
    if (!current) {
      return null;
    }
    const currentState = state.get(currentId) ?? "unseen";
    if (currentState === "visiting") {
      const start = stack.indexOf(currentId);
      const cycle = [...stack.slice(start), currentId];
      issue(issues, "scope-parent-cycle", `Scope parent cycle: ${cycle.join(" → ")}`, { cycle, scope: currentId });
      return null;
    }
    if (currentState === "done") {
      return current.chain ?? null;
    }
    state.set(currentId, "visiting");
    stack.push(currentId);
    let parentChain;
    if (current.parent === "core") {
      parentChain = [];
    } else if (!scopesById.has(current.parent)) {
      issue(issues, "missing-scope-parent", `${current.id}: parent ${current.parent} is not registered`, {
        scope: current.id,
        parent: current.parent
      });
      parentChain = null;
    } else {
      parentChain = visit(current.parent);
    }
    stack.pop();
    state.set(currentId, "done");
    current.chain = parentChain ? [...parentChain, currentId] : null;
    return current.chain;
  }

  return visit(id);
}

function enrichTokens(tokens, origin, originKind = "scope") {
  return new Map([...tokens.entries()].map(([tokenPath, token]) => [tokenPath, {
    ...token,
    origin,
    originKind
  }]));
}

function findScopeRelationship(fromScope, toScope, scopesById) {
  if (toScope === "core") {
    return "ancestor";
  }
  if (fromScope === "core") {
    return "child";
  }
  if (fromScope === toScope) {
    return "self";
  }
  const from = scopesById.get(fromScope);
  const to = scopesById.get(toScope);
  if (!from || !to || !from.chain || !to.chain) {
    return "unrelated";
  }
  if (from.chain.includes(toScope)) {
    return "ancestor";
  }
  if (to.chain.includes(fromScope)) {
    return "child";
  }
  return "sibling";
}

function checkScopeTokenLayers(scope, parentTokens, issues) {
  for (const token of scope.localTokens.values()) {
    if (token.layer === "unknown") {
      issue(issues, "unsupported-scope-token-file", `${scope.id}: ${token.file} must be a standard layer file`, {
        scope: scope.id,
        token: token.path,
        file: token.file
      });
      continue;
    }
    if (token.layer === "primitive") {
      const namespace = `scope.${scope.id}.`;
      if (!token.path.startsWith(namespace)) {
        issue(
          issues,
          "scope-primitive-namespace",
          `${scope.id}: primitive ${token.path} must begin with ${namespace}`,
          { scope: scope.id, token: token.path, namespace }
        );
      }
      if (parentTokens.has(token.path)) {
        issue(
          issues,
          "scope-primitive-overrides-parent",
          `${scope.id}: local primitive ${token.path} cannot override a Core or ancestor primitive`,
          { scope: scope.id, token: token.path }
        );
      }
      continue;
    }

    const parent = parentTokens.get(token.path);
    if (token.layer === "semantic") {
      if (!parent || parent.layer !== "semantic") {
        issue(
          issues,
          "scope-semantic-must-override-parent",
          `${scope.id}: semantic ${token.path} must override an inherited semantic token`,
          { scope: scope.id, token: token.path }
        );
      }
      continue;
    }

    if (token.layer === "component" && (!parent || parent.layer !== "component")) {
      issue(
        issues,
        "scope-component-must-override-approved-exception",
        `${scope.id}: component ${token.path} must override an inherited component exception`,
        { scope: scope.id, token: token.path }
      );
    }
  }
}

function checkThemeTokenLayers(theme, coreTokens, issues) {
  for (const token of theme.localTokens.values()) {
    if (token.layer === "unknown") {
      issue(issues, "unsupported-theme-token-file", `${theme.id}: ${token.file} must be a standard layer file`, {
        theme: theme.id,
        token: token.path,
        file: token.file
      });
      continue;
    }
    if (token.layer === "primitive") {
      issue(
        issues,
        "theme-primitive-not-allowed",
        `${theme.id}: Theme deltas cannot define Primitive tokens; add a confirmed reusable value to Core instead`,
        { theme: theme.id, token: token.path }
      );
      continue;
    }

    const coreToken = coreTokens.get(token.path);
    if (token.layer === "semantic") {
      if (!coreToken || coreToken.layer !== "semantic") {
        issue(
          issues,
          "theme-semantic-must-override-core",
          `${theme.id}: semantic ${token.path} must override a Core semantic token`,
          { theme: theme.id, token: token.path }
        );
      }
      continue;
    }

    if (token.layer === "component" && (!coreToken || coreToken.layer !== "component")) {
      issue(
        issues,
        "theme-component-must-override-approved-exception",
        `${theme.id}: component ${token.path} must override an approved Core component exception`,
        { theme: theme.id, token: token.path }
      );
    }
  }
}

async function scopeDirectories(scopesRoot) {
  if (!(await fileExists(scopesRoot))) {
    return [];
  }
  const entries = await readdir(scopesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function themeDirectories(themesRoot) {
  if (!(await fileExists(themesRoot))) {
    return [];
  }
  const entries = await readdir(themesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Inspect the complete Core + Theme + Scope system. `result` is JSON-safe; `internal`
 * additionally exposes the resolved token maps for deterministic builders.
 */
export async function inspectDesignSystem(projectRoot) {
  const issues = [];
  const systemRoot = path.join(projectRoot, "design-system");
  const coreTokensRoot = path.join(systemRoot, "tokens");
  const scopeMapPath = path.join(systemRoot, "scope-map.json");
  const scopesRoot = path.join(systemRoot, "scopes");
  const themeMapPath = path.join(systemRoot, "theme-map.json");
  const themesRoot = path.join(systemRoot, "themes");
  const hasScopeMap = await fileExists(scopeMapPath);
  const hasThemeMap = await fileExists(themeMapPath);
  let scopeEntries = [];
  let themeEntries = [];
  let themeMap = null;

  if (hasScopeMap) {
    let parsed;
    try {
      parsed = await readJson(scopeMapPath);
    } catch (error) {
      issue(issues, "invalid-scope-map-json", `Cannot parse scope-map.json: ${error.message}`);
      parsed = null;
    }
    if (parsed !== null) {
      if (!isPlainObject(parsed)) {
        issue(issues, "invalid-scope-map", "scope-map.json must contain an object");
      } else if (parsed.version !== 1) {
        issue(issues, "unsupported-scope-map-version", "scope-map.json must declare version: 1");
      } else if (parsed.scopes !== undefined && !Array.isArray(parsed.scopes)) {
        issue(issues, "invalid-scope-map", "scope-map.json scopes must be an array");
      } else {
        scopeEntries = (parsed.scopes ?? [])
          .map((entry, index) => normalizeScope(entry, index, issues))
          .filter(Boolean);
      }
    }
  }

  if (hasThemeMap) {
    let parsed;
    try {
      parsed = await readJson(themeMapPath);
    } catch (error) {
      issue(issues, "invalid-theme-map-json", `Cannot parse theme-map.json: ${error.message}`);
      parsed = null;
    }
    if (parsed !== null) {
      if (!isPlainObject(parsed)) {
        issue(issues, "invalid-theme-map", "theme-map.json must contain an object");
      } else if (parsed.version !== 1) {
        issue(issues, "unsupported-theme-map-version", "theme-map.json must declare version: 1");
      } else if (typeof parsed.defaultTheme !== "string" || !THEME_ID.test(parsed.defaultTheme)) {
        issue(issues, "invalid-default-theme", "theme-map.json defaultTheme must be a lowercase kebab-case id");
      } else if (!Array.isArray(parsed.themes)) {
        issue(issues, "invalid-theme-map", "theme-map.json themes must be an array");
      } else {
        const activation = normalizeThemeActivation(parsed.activation, issues);
        themeEntries = parsed.themes
          .map((entry, index) => normalizeTheme(entry, index, parsed.defaultTheme, issues))
          .filter(Boolean);
        if (activation) {
          themeMap = {
            activation,
            defaultTheme: parsed.defaultTheme,
            themes: themeEntries
          };
          if (activation.kind === "media" && [parsed.defaultTheme, ...themeEntries.map((theme) => theme.id)]
            .some((id) => id !== "dark" && id !== "light")) {
            issue(
              issues,
              "invalid-media-theme-id",
              "media activation only supports light and dark theme ids"
            );
          }
        }
      }
    }
  }

  const scopeDirs = await scopeDirectories(scopesRoot);
  if (!hasScopeMap && scopeDirs.length > 0) {
    issue(issues, "missing-scope-map", "scope-map.json is required when design-system/scopes contains a Scope");
  }
  const themeDirs = await themeDirectories(themesRoot);
  if (!hasThemeMap && themeDirs.length > 0) {
    issue(issues, "missing-theme-map", "theme-map.json is required when design-system/themes contains a Theme");
  }

  const scopesById = new Map();
  for (const scope of scopeEntries) {
    if (scopesById.has(scope.id)) {
      issue(issues, "duplicate-scope-id", `scope-map.json registers ${scope.id} more than once`, { scope: scope.id });
      continue;
    }
    scopesById.set(scope.id, scope);
  }
  for (const directory of scopeDirs) {
    if (!scopesById.has(directory)) {
      issue(issues, "unregistered-scope-directory", `scopes/${directory} is not registered in scope-map.json`, { scope: directory });
    }
  }
  for (const scope of scopesById.values()) {
    const directory = path.join(scopesRoot, scope.id);
    scope.directory = directory;
    scope.tokensRoot = path.join(directory, "tokens");
    if (!(await fileExists(directory))) {
      issue(issues, "missing-scope-directory", `${scope.id}: scopes/${scope.id} does not exist`, { scope: scope.id });
    }
    scopeChainFor(scope.id, scopesById, issues);
  }
  checkSiblingBoundaryOverlap([...scopesById.values()], issues);

  const themesById = new Map();
  for (const theme of themeEntries) {
    if (themesById.has(theme.id)) {
      issue(issues, "duplicate-theme-id", `theme-map.json registers ${theme.id} more than once`, { theme: theme.id });
      continue;
    }
    themesById.set(theme.id, theme);
  }
  for (const directory of themeDirs) {
    if (!themesById.has(directory)) {
      issue(issues, "unregistered-theme-directory", `themes/${directory} is not registered in theme-map.json`, { theme: directory });
    }
  }
  for (const theme of themesById.values()) {
    const directory = path.join(themesRoot, theme.id);
    theme.directory = directory;
    theme.tokensRoot = path.join(directory, "tokens");
    if (!(await fileExists(directory))) {
      issue(issues, "missing-theme-directory", `${theme.id}: themes/${theme.id} does not exist`, { theme: theme.id });
    }
  }

  let coreLoaded;
  if (await fileExists(coreTokensRoot)) {
    coreLoaded = await loadTokenDirectory(coreTokensRoot);
  } else {
    issue(issues, "missing-core-tokens", "design-system/tokens is required");
    coreLoaded = { issues: [], tokenCount: 0, tokenFiles: [], tokens: new Map() };
  }
  issues.push(...coreLoaded.issues);
  const coreTokens = enrichTokens(coreLoaded.tokens, "core", "core");

  for (const scope of scopesById.values()) {
    let loaded = { issues: [], tokenCount: 0, tokenFiles: [], tokens: new Map() };
    if (await fileExists(scope.tokensRoot)) {
      loaded = await loadTokenDirectory(scope.tokensRoot);
    }
    issues.push(...loaded.issues);
    scope.loaded = loaded;
    scope.localTokens = enrichTokens(loaded.tokens, scope.id, "scope");
  }

  for (const theme of themesById.values()) {
    let loaded = { issues: [], tokenCount: 0, tokenFiles: [], tokens: new Map() };
    if (await fileExists(theme.tokensRoot)) {
      loaded = await loadTokenDirectory(theme.tokensRoot);
    }
    issues.push(...loaded.issues);
    theme.loaded = loaded;
    theme.localTokens = enrichTokens(loaded.tokens, theme.id, "theme");
  }

  const definitionsByPath = new Map();
  function indexDefinitions(tokens) {
    for (const token of tokens.values()) {
      if (!definitionsByPath.has(token.path)) {
        definitionsByPath.set(token.path, []);
      }
      definitionsByPath.get(token.path).push(token);
    }
  }
  indexDefinitions(coreTokens);
  for (const scope of scopesById.values()) {
    indexDefinitions(scope.localTokens);
  }
  for (const theme of themesById.values()) {
    indexDefinitions(theme.localTokens);
  }

  function missingReferenceHandler(token, reference) {
    const definitions = definitionsByPath.get(reference) ?? [];
    if (definitions.length === 0) {
      return false;
    }
    const targetOrigins = [...new Set(definitions.map((definition) => `${definition.originKind}:${definition.origin}`))];
    if (token.originKind === "core") {
      issue(
        issues,
        "core-reverse-reference",
        `Core token ${token.path} cannot reference Theme or Scope token ${reference}`,
        { token: token.path, reference, targets: targetOrigins }
      );
      return true;
    }
    if (token.originKind === "theme") {
      const external = definitions.filter((definition) => definition.originKind !== "core");
      if (external.length > 0) {
        issue(
          issues,
          "theme-cross-reference",
          `${token.origin}: ${token.path} can only reference Core or its own Theme tokens, not ${reference}`,
          { theme: token.origin, token: token.path, reference, targets: targetOrigins }
        );
        return true;
      }
      return false;
    }
    for (const definition of definitions) {
      if (definition.originKind === "theme") {
        issue(
          issues,
          "scope-theme-reference",
          `${token.origin}: ${token.path} cannot reference Theme token ${reference}`,
          { scope: token.origin, token: token.path, reference, theme: definition.origin }
        );
        return true;
      }
      if (definition.originKind !== "scope") {
        continue;
      }
      const relationship = findScopeRelationship(token.origin, definition.origin, scopesById);
      if (relationship === "child") {
        issue(
          issues,
          "scope-reverse-reference",
          `${token.origin}: ${token.path} cannot reference child Scope token ${reference}`,
          { scope: token.origin, token: token.path, reference, targetScope: definition.origin }
        );
        return true;
      }
      if (relationship === "sibling" || relationship === "unrelated") {
        issue(
          issues,
          "scope-sibling-reference",
          `${token.origin}: ${token.path} cannot reference sibling Scope token ${reference}`,
          { scope: token.origin, token: token.path, reference, targetScope: definition.origin }
        );
        return true;
      }
    }
    return false;
  }

  validateTokenRecords(coreTokens, issues, {
    onMissingReference: missingReferenceHandler,
    tokenFiles: coreLoaded.tokenFiles
  });

  const themesInOrder = [...themesById.values()]
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const theme of themesInOrder) {
    checkThemeTokenLayers(theme, coreTokens, issues);
    const effectiveTokens = new Map(coreTokens);
    for (const [tokenPath, token] of theme.localTokens) {
      effectiveTokens.set(tokenPath, token);
    }
    theme.effectiveTokens = effectiveTokens;
    validateTokenRecords(effectiveTokens, issues, {
      allowEmpty: true,
      onMissingReference: missingReferenceHandler,
      tokenFiles: theme.loaded.tokenFiles
    });
  }

  const scopesInOrder = [...scopesById.values()]
    .filter((scope) => Array.isArray(scope.chain))
    .sort((left, right) => {
      if (left.chain.length !== right.chain.length) {
        return left.chain.length - right.chain.length;
      }
      return left.id.localeCompare(right.id);
    });

  for (const scope of scopesInOrder) {
    const parentTokens = scope.parent === "core"
      ? coreTokens
      : scopesById.get(scope.parent)?.effectiveTokens;
    if (!parentTokens) {
      continue;
    }
    const parentScope = scope.parent === "core" ? null : scopesById.get(scope.parent);
    if (scope.status === "active" && parentScope?.status === "reference-only") {
      issue(
        issues,
        "active-scope-under-reference-only-parent",
        `${scope.id}: an active Scope cannot inherit runtime values from reference-only parent ${scope.parent}`,
        { scope: scope.id, parent: scope.parent }
      );
    }
    checkScopeTokenLayers(scope, parentTokens, issues);
    const effectiveTokens = new Map(parentTokens);
    for (const [tokenPath, token] of scope.localTokens) {
      effectiveTokens.set(tokenPath, token);
    }
    scope.effectiveTokens = effectiveTokens;
    validateTokenRecords(effectiveTokens, issues, {
      allowEmpty: true,
      onMissingReference: missingReferenceHandler,
      tokenFiles: scope.loaded.tokenFiles
    });
  }

  const activeThemes = themesInOrder.filter((theme) => theme.status === "active");
  if (activeThemes.length > 0) {
    for (const scope of scopesInOrder) {
      if (scope.status !== "active" || !scope.localTokens) {
        continue;
      }
      const overridesSemantic = [...scope.localTokens.values()].some((token) => token.layer === "semantic");
      if (overridesSemantic) {
        warning(
          issues,
          "scope-theme-delta-not-managed",
          `${scope.id}: this Scope overrides Semantic tokens while managed Themes are active. v0.3 does not generate Scope × Theme CSS; confirm the Scope delta is valid in every Theme before integrating it.`,
          { scope: scope.id, themes: activeThemes.map((theme) => theme.id) }
        );
      }
    }
  }

  const summarizedScopes = [...scopesById.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((scope) => ({
      appliesTo: scope.appliesTo,
      chain: scope.chain ?? [],
      id: scope.id,
      kind: scope.kind,
      parent: scope.parent,
      reason: scope.reason,
      selector: selectorForChain(scope.chain ?? []),
      status: scope.status,
      tokenCount: scope.loaded?.tokenCount ?? 0,
      tokenFiles: scope.loaded?.tokenFiles ?? []
    }));
  const summarizedThemes = themesInOrder.map((theme) => ({
    id: theme.id,
    mediaQuery: themeMap ? mediaQueryForTheme(theme, themeMap) : null,
    reason: theme.reason,
    runtimeOwner: theme.runtimeOwner,
    selector: themeMap ? selectorForTheme(theme, themeMap) : null,
    source: theme.source,
    status: theme.status,
    tokenCount: theme.loaded?.tokenCount ?? 0,
    tokenFiles: theme.loaded?.tokenFiles ?? []
  }));
  const sortedIssues = sortIssues(issues);
  const valid = !sortedIssues.some((current) => current.severity === "error");
  const result = {
    core: {
      tokenCount: coreLoaded.tokenCount,
      tokenFiles: coreLoaded.tokenFiles
    },
    cssProfile: "dtcg-2025.10-css-subset",
    issues: sortedIssues,
    scopeMap: {
      present: hasScopeMap,
      scopeCount: scopesById.size
    },
    scopes: summarizedScopes,
    themeMap: {
      activation: themeMap?.activation ?? null,
      defaultTheme: themeMap?.defaultTheme ?? null,
      present: hasThemeMap,
      themeCount: themesById.size
    },
    themes: summarizedThemes,
    valid
  };

  return {
    internal: {
      core: {
        ...coreLoaded,
        tokens: coreTokens,
        tokensRoot: coreTokensRoot
      },
      scopesById,
      scopesInOrder,
      systemRoot,
      themeMap,
      themesById,
      themesInOrder
    },
    result
  };
}

export async function validateDesignSystem(projectRoot) {
  return (await inspectDesignSystem(projectRoot)).result;
}

export function cssSelectorForScope(scope) {
  return selectorForChain(scope.chain ?? []);
}

export function cssSelectorForTheme(theme, themeMap) {
  return selectorForTheme(theme, themeMap);
}

export function cssMediaQueryForTheme(theme, themeMap) {
  return mediaQueryForTheme(theme, themeMap);
}

export function tokenGlob(tokensRoot) {
  return path.join(tokensRoot, "**", "*.tokens.json");
}

export function outputRelativePathForScope(scope) {
  return `scopes/${scope.id}.css`;
}

export function isSafeOutputPath(outputRoot, candidate) {
  return isWithin(outputRoot, candidate) && relativePosix(outputRoot, candidate) !== "";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = await requireDirectory(requireStringOption(options, "project"), "--project");
  const result = await validateDesignSystem(projectRoot);
  printJson(result);
  process.exitCode = result.valid ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    reportError(error);
    process.exitCode = 2;
  });
}

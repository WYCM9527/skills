import path from "node:path";
import { readFile } from "node:fs/promises";

import {
  collectReferences,
  relativePosix,
  walkFiles
} from "./lib.mjs";

export const DTCG_TYPES = new Set([
  "color",
  "dimension",
  "fontFamily",
  "fontWeight",
  "duration",
  "cubicBezier",
  "number",
  "strokeStyle",
  "border",
  "transition",
  "shadow",
  "gradient",
  "typography",
  "link",
  "boolean",
  "string",
  "other"
]);

export const CSS_PROFILE_TYPES = new Set([
  "boolean",
  "color",
  "cubicBezier",
  "dimension",
  "duration",
  "fontFamily",
  "fontWeight",
  "number",
  "string"
]);

const CSS_DIMENSION_UNITS = new Set(["px", "rem", "em", "%", "vw", "vh"]);
const CSS_DURATION_UNITS = new Set(["ms", "s"]);

function issue(issues, code, message, details = {}) {
  issues.push({ code, message, severity: "error", ...details });
}

export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function tokenLayerForFile(file) {
  const basename = path.basename(file);
  if (basename === "primitives.tokens.json") {
    return "primitive";
  }
  if (basename === "semantic.tokens.json") {
    return "semantic";
  }
  if (basename === "components.tokens.json") {
    return "component";
  }
  return "unknown";
}

function validatePrimitiveValue(token, issues) {
  if (typeof token.value === "string" && /^\{[^{}]+\}$/.test(token.value)) {
    return;
  }

  const label = token.path;
  switch (token.type) {
    case "color": {
      if (!isObject(token.value) || token.value.colorSpace !== "srgb") {
        issue(issues, "unsupported-color", `${label} must use a structured srgb color value`, { token: label });
        return;
      }
      const { components, alpha = 1 } = token.value;
      const validComponents = Array.isArray(components)
        && components.length === 3
        && components.every((component) => typeof component === "number" && component >= 0 && component <= 1);
      if (!validComponents || typeof alpha !== "number" || alpha < 0 || alpha > 1) {
        issue(issues, "invalid-color", `${label} has invalid srgb components or alpha`, { token: label });
      }
      return;
    }
    case "dimension": {
      if (!isObject(token.value)
        || typeof token.value.value !== "number"
        || !CSS_DIMENSION_UNITS.has(token.value.unit)) {
        issue(issues, "invalid-dimension", `${label} must use a supported structured CSS dimension`, { token: label });
      }
      return;
    }
    case "duration": {
      if (!isObject(token.value)
        || typeof token.value.value !== "number"
        || !CSS_DURATION_UNITS.has(token.value.unit)) {
        issue(issues, "invalid-duration", `${label} must use a supported structured CSS duration`, { token: label });
      }
      return;
    }
    case "number":
      if (typeof token.value !== "number") {
        issue(issues, "invalid-number", `${label} must be a number`, { token: label });
      }
      return;
    case "fontWeight":
      if (typeof token.value !== "number" && typeof token.value !== "string") {
        issue(issues, "invalid-font-weight", `${label} must be a number or string`, { token: label });
      }
      return;
    case "fontFamily":
      if (typeof token.value !== "string"
        && (!Array.isArray(token.value) || !token.value.every((family) => typeof family === "string"))) {
        issue(issues, "invalid-font-family", `${label} must be a string or string array`, { token: label });
      }
      return;
    case "cubicBezier":
      if (!Array.isArray(token.value)
        || token.value.length !== 4
        || !token.value.every((point) => typeof point === "number")) {
        issue(issues, "invalid-cubic-bezier", `${label} must be an array of four numbers`, { token: label });
      }
      return;
    case "string":
      if (typeof token.value !== "string") {
        issue(issues, "invalid-string", `${label} must be a string`, { token: label });
      }
      return;
    case "boolean":
      if (typeof token.value !== "boolean") {
        issue(issues, "invalid-boolean", `${label} must be a boolean`, { token: label });
      }
      return;
    default:
      issue(
        issues,
        "unsupported-css-profile-type",
        `${label} uses ${token.type}, which is valid DTCG territory but unsupported by this CSS profile`,
        { token: label, type: token.type }
      );
  }
}

function flattenDocument(document, file, root, tokens, issues) {
  function visit(node, parts, inheritedType) {
    if (!isObject(node)) {
      issue(issues, "invalid-group", `${parts.join(".") || "root"} must be an object`, {
        file: relativePosix(root, file)
      });
      return;
    }

    const type = typeof node.$type === "string" ? node.$type : inheritedType;
    if (Object.hasOwn(node, "$value")) {
      const tokenPath = parts.join(".");
      if (!tokenPath) {
        issue(issues, "unnamed-token", "A token cannot be the document root", {
          file: relativePosix(root, file)
        });
        return;
      }
      if (!type) {
        issue(issues, "missing-type", `${tokenPath} has no inherited or local $type`, {
          file: relativePosix(root, file),
          token: tokenPath
        });
        return;
      }
      if (!DTCG_TYPES.has(type)) {
        issue(issues, "unknown-type", `${tokenPath} uses unknown DTCG type ${type}`, {
          file: relativePosix(root, file),
          token: tokenPath,
          type
        });
        return;
      }
      if (tokens.has(tokenPath)) {
        issue(issues, "duplicate-token", `${tokenPath} appears in more than one token file`, {
          file: relativePosix(root, file),
          token: tokenPath
        });
        return;
      }
      tokens.set(tokenPath, {
        file: relativePosix(root, file),
        path: tokenPath,
        references: collectReferences(node.$value),
        type,
        value: node.$value,
        layer: tokenLayerForFile(file)
      });
      return;
    }

    for (const key of Object.keys(node).sort((left, right) => left.localeCompare(right))) {
      if (!key.startsWith("$")) {
        visit(node[key], [...parts, key], type);
      }
    }
  }

  visit(document, [], undefined);
}

function findCycles(tokens, issues) {
  const state = new Map();
  const stack = [];

  function visit(tokenPath) {
    const current = state.get(tokenPath) ?? "unseen";
    if (current === "visiting") {
      const start = stack.indexOf(tokenPath);
      const cycle = [...stack.slice(start), tokenPath];
      issue(issues, "alias-cycle", `Alias cycle: ${cycle.join(" → ")}`, { cycle });
      return;
    }
    if (current === "done") {
      return;
    }

    state.set(tokenPath, "visiting");
    stack.push(tokenPath);
    for (const reference of tokens.get(tokenPath).references) {
      if (tokens.has(reference)) {
        visit(reference);
      }
    }
    stack.pop();
    state.set(tokenPath, "done");
  }

  for (const tokenPath of [...tokens.keys()].sort((left, right) => left.localeCompare(right))) {
    visit(tokenPath);
  }
}

/**
 * Load DTCG CSS-profile token files without resolving aliases. The returned
 * Map stays internal to script callers so a system validator can compose a
 * Core plus Scope inheritance chain deterministically.
 */
export async function loadTokenDirectory(tokensRoot) {
  const issues = [];
  const tokenFiles = (await walkFiles(tokensRoot, { ignoredDirectories: new Set() }))
    .filter((file) => file.endsWith(".tokens.json"))
    .sort((left, right) => left.localeCompare(right));
  const tokens = new Map();

  for (const file of tokenFiles) {
    let document;
    try {
      document = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      issue(issues, "invalid-json", `Cannot parse ${relativePosix(tokensRoot, file)}: ${error.message}`, {
        file: relativePosix(tokensRoot, file)
      });
      continue;
    }
    flattenDocument(document, file, tokensRoot, tokens, issues);
  }

  return {
    issues,
    tokenCount: tokens.size,
    tokenFiles: tokenFiles.map((file) => relativePosix(tokensRoot, file)),
    tokens
  };
}

/**
 * Validate already-loaded token records. A system validator can turn an
 * otherwise dangling alias into a more useful Scope-boundary error.
 */
export function validateTokenRecords(tokens, issues, options = {}) {
  const {
    allowEmpty = false,
    tokenFiles = [],
    onMissingReference
  } = options;

  if (tokenFiles.length === 0 && !allowEmpty) {
    issue(issues, "no-token-files", "No *.tokens.json files found", {});
  }
  if (tokens.size === 0 && tokenFiles.length > 0 && !allowEmpty) {
    issue(issues, "no-tokens", "Token files contain no token values yet", {});
  }

  for (const token of tokens.values()) {
    for (const reference of token.references) {
      const target = tokens.get(reference);
      if (!target) {
        const handled = typeof onMissingReference === "function"
          ? onMissingReference(token, reference)
          : false;
        if (!handled) {
          issue(issues, "dangling-alias", `${token.path} references missing token ${reference}`, {
            token: token.path,
            reference
          });
        }
        continue;
      }
      if (target.type !== token.type) {
        issue(issues, "alias-type-mismatch", `${token.path} (${token.type}) references ${reference} (${target.type})`, {
          token: token.path,
          reference
        });
      }
    }
    validatePrimitiveValue(token, issues);
  }

  findCycles(tokens, issues);
}

export function finalizeTokenValidation({ issues, tokenCount, tokenFiles }) {
  issues.sort((left, right) => `${left.code}:${left.token ?? ""}:${left.message}`.localeCompare(`${right.code}:${right.token ?? ""}:${right.message}`));
  return {
    cssProfile: "dtcg-2025.10-css-subset",
    issues,
    tokenCount,
    tokenFiles,
    valid: issues.length === 0
  };
}

export async function validateTokenDirectory(tokensRoot, options = {}) {
  const loaded = await loadTokenDirectory(tokensRoot);
  validateTokenRecords(loaded.tokens, loaded.issues, {
    allowEmpty: options.allowEmpty === true,
    tokenFiles: loaded.tokenFiles
  });
  return finalizeTokenValidation(loaded);
}

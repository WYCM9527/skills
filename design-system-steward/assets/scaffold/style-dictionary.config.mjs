import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

function environmentPathList(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must be a JSON array of absolute token globs: ${error.message}`);
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string" || !path.isAbsolute(entry))) {
    throw new Error(`${name} must be a JSON array of absolute token globs`);
  }
  return parsed;
}

function outputDestination() {
  const destination = process.env.DS_SCOPE_DESTINATION ?? "tokens.css";
  if (path.isAbsolute(destination) || destination.split(/[\\/]/).includes("..")) {
    throw new Error("DS_SCOPE_DESTINATION must be a relative CSS file path");
  }
  if (!destination.endsWith(".css")) {
    throw new Error("DS_SCOPE_DESTINATION must end in .css");
  }
  return destination;
}

function collectReferences(value) {
  if (typeof value !== "string") {
    return [];
  }
  return [...value.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
}

function sourceFirst(tokens) {
  const sourceTokens = tokens.filter((token) => token.isSource);
  const byPath = new Map(sourceTokens.map((token) => [token.path.join("."), token]));
  const sorted = [];
  const state = new Map();

  function visit(token) {
    const tokenPath = token.path.join(".");
    const current = state.get(tokenPath) ?? "unseen";
    if (current === "visiting" || current === "done") {
      return;
    }
    state.set(tokenPath, "visiting");
    const original = token.original.$value ?? token.original.value;
    for (const reference of collectReferences(original).sort((left, right) => left.localeCompare(right))) {
      const dependency = byPath.get(reference);
      if (dependency) {
        visit(dependency);
      }
    }
    state.set(tokenPath, "done");
    sorted.push(token);
  }

  for (const token of [...sourceTokens].sort((left, right) => left.name.localeCompare(right.name))) {
    visit(token);
  }
  return sorted;
}

function cssValue(token, namesByPath) {
  const original = token.original.$value ?? token.original.value;
  if (typeof original === "string" && original.includes("{")) {
    return original.replace(/\{([^{}]+)\}/g, (match, reference) => {
      const target = namesByPath.get(reference);
      return target ? `var(--${target.name})` : match;
    });
  }

  const value = token.$value ?? token.value;
  const type = token.$type ?? token.type ?? token.original.$type ?? token.original.type;
  if (value && typeof value === "object" && !Array.isArray(value)
    && (type === "dimension" || type === "duration")
    && typeof value.value === "number" && typeof value.unit === "string") {
    return `${value.value}${value.unit}`;
  }
  if (Array.isArray(value)) {
    return type === "cubicBezier" ? `cubic-bezier(${value.join(", ")})` : value.join(", ");
  }
  if (value && typeof value === "object") {
    throw new Error(`CSS profile did not transform ${token.path.join(".")} into a CSS value`);
  }
  return String(value);
}

/**
 * Style Dictionary receives all ancestor tokens as `include` and only the
 * current layer as `source`. The formatter therefore resolves aliases from the
 * complete dictionary but writes only `isSource` delta tokens.
 */
async function scopeDeltaCss({ dictionary, options }) {
  const selector = options.selector ?? ":root";
  const allTokens = dictionary.unfilteredAllTokens ?? dictionary.allTokens;
  const namesByPath = new Map(allTokens.map((token) => [token.path.join("."), token]));
  const lines = sourceFirst(dictionary.allTokens)
    .map((token) => `  --${token.name}: ${cssValue(token, namesByPath)};`);
  if (lines.length === 0) {
    return "";
  }
  return `${selector} {\n${lines.join("\n")}\n}\n`;
}

const outputRoot = process.env.DS_OUTPUT_DIR
  ? path.resolve(process.env.DS_OUTPUT_DIR)
  : path.join(root, "dist");
const source = environmentPathList(
  "DS_SCOPE_SOURCE",
  [path.join(root, "tokens", "**", "*.tokens.json")]
);
const include = environmentPathList("DS_SCOPE_INCLUDE", []);

export default {
  include,
  log: {
    warnings: "error"
  },
  source,
  hooks: {
    formats: {
      "design-system-steward/scope-delta": scopeDeltaCss
    }
  },
  platforms: {
    css: {
      transformGroup: "css",
      buildPath: `${outputRoot}${path.sep}`,
      log: {
        warnings: "error"
      },
      files: [
        {
          destination: outputDestination(),
          format: "design-system-steward/scope-delta",
          options: {
            selector: process.env.DS_SCOPE_SELECTOR ?? ":root",
            showFileHeader: false
          }
        }
      ]
    }
  }
};

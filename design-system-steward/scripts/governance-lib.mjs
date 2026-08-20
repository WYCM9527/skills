import { lstat, stat } from "node:fs/promises";
import path from "node:path";

import {
  isWithin,
  relativePosix
} from "./lib.mjs";

export const UI_STYLE_EXTENSIONS = new Set([
  ".astro", ".css", ".html", ".js", ".jsx", ".less", ".sass", ".scss", ".svelte", ".ts", ".tsx", ".vue"
]);

export function isUiStyleFile(filePath) {
  return UI_STYLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export async function assertProjectPathDoesNotTraverseSymlink(projectRoot, candidate, label) {
  if (!isWithin(projectRoot, candidate) || candidate === projectRoot) {
    throw new Error(`${label} must be within the supplied project root`);
  }
  const relative = path.relative(projectRoot, candidate);
  let current = projectRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error(`${label} must not traverse a symbolic link: ${relativePosix(projectRoot, current)}`);
    }
  }
}

export async function resolveExistingProjectFile(projectRoot, value, label) {
  const candidate = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(projectRoot, value);

  await assertProjectPathDoesNotTraverseSymlink(projectRoot, candidate, label);

  const details = await stat(candidate);
  if (!details.isFile()) {
    throw new Error(`${label} must be a file: ${relativePosix(projectRoot, candidate)}`);
  }
  return candidate;
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

export function matchingProjectGlob(relative, globs) {
  return globs.find((glob) => typeof glob === "string" && globExpression(glob).test(relative)) ?? null;
}

function collectMatches(text, expression, group = 1) {
  return [...new Set([...text.matchAll(expression)]
    .map((match) => match[group])
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim()))]
    .sort((left, right) => left.localeCompare(right));
}

function propertyValues(text, properties) {
  const property = properties.join("|");
  const expression = new RegExp(
    `\\b(?:${property})\\s*[:=]\\s*["']?(-?(?:\\d+(?:\\.\\d+)?)(?:px|rem|em|%|vw|vh)?)`,
    "gi"
  );
  return collectMatches(text, expression);
}

function tailwindValues(text, prefixes) {
  const prefix = prefixes.join("|");
  const expression = new RegExp(`\\b(?:${prefix})-\\[([^\\]]+)\\]`, "gi");
  return collectMatches(text, expression);
}

export function extractVisualCandidates(text) {
  const colors = collectMatches(text, /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklch|oklab)\([^)]*\)/g, 0)
    .map((value) => value.toLowerCase());
  const spacing = [...new Set([
    ...propertyValues(text, [
      "margin(?:Top|Right|Bottom|Left)?", "padding(?:Top|Right|Bottom|Left)?", "gap", "rowGap", "columnGap",
      "inset(?:Top|Right|Bottom|Left)?", "top", "right", "bottom", "left", "width", "minWidth", "maxWidth",
      "height", "minHeight", "maxHeight", "borderRadius"
    ]),
    ...tailwindValues(text, ["p", "px", "py", "pt", "pr", "pb", "pl", "m", "mx", "my", "mt", "mr", "mb", "ml", "gap", "w", "h", "rounded"])
  ])].sort((left, right) => left.localeCompare(right));
  const typography = [...new Set([
    ...propertyValues(text, ["fontSize", "lineHeight", "letterSpacing", "fontWeight"]),
    ...tailwindValues(text, ["text", "leading", "tracking", "font"])
  ])].sort((left, right) => left.localeCompare(right));
  const scopeMarkers = collectMatches(
    text,
    /data-ds-scope\s*=\s*(?:\{\s*)?["']([^"']+)["'](?:\s*\})?/g
  );
  const themeMarkers = [...new Set([
    ...collectMatches(text, /data-theme\s*=\s*(?:\{\s*)?["']([^"']+)["'](?:\s*\})?/g),
    ...collectMatches(text, /(?:dataset\.theme\s*=|setAttribute\(\s*["']data-theme["']\s*,)\s*["']([^"']+)["']/g),
    ...(/\b(?:className|class)\s*=\s*["'][^"']*\bdark\b[^"']*["']/i.test(text) ? ["class:dark"] : [])
  ])].sort((left, right) => left.localeCompare(right));
  const usesManagedCssVariables = /var\(\s*--[A-Za-z0-9_-]+\s*\)/.test(text);

  return {
    colors: [...new Set(colors)].sort((left, right) => left.localeCompare(right)),
    scopeMarkers,
    spacing,
    themeMarkers,
    typography,
    usesManagedCssVariables
  };
}

export function hasVisualCandidates(candidates) {
  return candidates.colors.length > 0
    || candidates.spacing.length > 0
    || candidates.typography.length > 0
    || candidates.scopeMarkers.length > 0
    || candidates.themeMarkers.length > 0;
}

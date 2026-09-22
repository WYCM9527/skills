// 读取一个 design-system/ 目录：Core token（tokens/**）、theme-map.json、每个 Theme 的 delta（themes/<id>/tokens/**）。
// 只做读取与 alias 解析，不做校验——校验、构建、Guard 一律交给 design-system-steward。
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { fileExists, readJson } from "./args.mjs";
import { cssValueOf, cssVariableName, flattenTokens, resolveToken } from "./dtcg.mjs";

async function tokenFilesUnder(root) {
  if (!(await fileExists(root))) {
    return [];
  }
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile() && entry.name.endsWith(".tokens.json")) {
        files.push(absolute);
      }
    }
  }
  await visit(root);
  return files;
}

async function loadLayer(root) {
  const tokens = new Map();
  for (const file of await tokenFilesUnder(root)) {
    flattenTokens(JSON.parse(await readFile(file, "utf8")), tokens);
  }
  return tokens;
}

export function themeSelector(themeMap, themeId) {
  const kind = themeMap?.activation?.kind;
  if (kind === "data-attribute") {
    return `:root[${themeMap.activation.attribute}="${themeId}"]`;
  }
  if (kind === "class") {
    return `:root.${themeId}`;
  }
  return null;
}

/**
 * 返回 { systemRoot, core: Map, themeMap, themes: [{ id, tokens: Map, selector, mediaQuery, status, ... }] }。
 * themes 只含 theme-map 登记且目录存在的主题（reference-only 也会读出来，调用方自行决定是否展示）。
 */
export async function loadSystem(systemRoot) {
  const core = await loadLayer(path.join(systemRoot, "tokens"));
  const themeMapPath = path.join(systemRoot, "theme-map.json");
  const themeMap = (await fileExists(themeMapPath)) ? await readJson(themeMapPath) : null;
  const themes = [];
  for (const entry of themeMap?.themes ?? []) {
    const tokensRoot = path.join(systemRoot, "themes", entry.id, "tokens");
    if (!(await fileExists(tokensRoot))) {
      continue;
    }
    themes.push({
      ...entry,
      mediaQuery: themeMap.activation?.kind === "media" ? `(prefers-color-scheme: ${entry.id})` : null,
      selector: themeSelector(themeMap, entry.id),
      tokens: await loadLayer(tokensRoot)
    });
  }
  return { core, systemRoot, themeMap, themes };
}

/** 某个 token 在某个模式（null = Core 默认）下的最终值与 CSS 文本。 */
export function resolveIn(system, tokenPath, theme = null) {
  const layers = theme ? [system.core, theme.tokens] : [system.core];
  const resolved = resolveToken(layers, tokenPath);
  return resolved ? { ...resolved, css: cssValueOf(resolved) } : null;
}

/** 所有已知路径（Core ∪ 各 Theme delta），按字典序。 */
export function allPaths(system) {
  const paths = new Set(system.core.keys());
  for (const theme of system.themes) {
    for (const key of theme.tokens.keys()) {
      paths.add(key);
    }
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

/** 把 Core 与各 Theme 的解析值写成 CSS 自定义属性（:root + 各主题选择器 / 媒体查询）——构建前也能预览。 */
export function inlineTokensCss(system) {
  const lines = [];
  const block = (selector, tokens, theme) => {
    const body = [];
    for (const tokenPath of [...tokens.keys()].sort()) {
      const resolved = resolveIn(system, tokenPath, theme);
      if (resolved?.css) body.push(`  --${cssVariableName(tokenPath)}: ${resolved.css};`);
    }
    return body.length ? `${selector} {\n${body.join("\n")}\n}` : "";
  };
  lines.push(block(":root", system.core, null));
  for (const theme of system.themes) {
    if (theme.mediaQuery) {
      lines.push(`@media ${theme.mediaQuery} {\n${block(":root", theme.tokens, theme).replace(/^/gm, "  ")}\n}`);
    } else if (theme.selector) {
      lines.push(block(theme.selector, theme.tokens, theme));
    }
  }
  return lines.filter(Boolean).join("\n");
}

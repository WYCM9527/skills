import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  blankComments,
  isCompleteAlias,
  parseArgs,
  printJson,
  readJson,
  readTextIfSmall,
  relativePosix,
  reportError,
  requireDirectory,
  requireStringOption,
  skillRoot,
  stableValue,
  walkFiles,
  writeText
} from "./lib.mjs";
import { isUiStyleFile, resolveExistingProjectFile } from "./governance-lib.mjs";
import {
  cssVariableNameForTokenPath,
  isObject,
  loadTokenDirectory,
  normalizeColorLiteral,
  normalizeDimensionLiteral,
  normalizeHex,
  srgbToHex
} from "./tokens.mjs";
import { createExemptionMatcher, loadExemptions, validateExemptionEntries } from "./exemptions.mjs";

const PHASES = new Set(["adopt", "replace", "settle"]);
const STYLESHEET_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less"]);
const VARIABLE_DEFINITION_EXPRESSION = /(--[A-Za-z0-9_-]+)(\s*:\s*)([^;{}]+)/g;
const COLOR_LITERAL_EXPRESSION = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
const DIMENSION_LITERAL_EXPRESSION = /(?<![\w.$-])(\d+(?:\.\d+)?(?:px|rem))\b/g;
const TAILWIND_ARBITRARY_EXPRESSION = /([\w-]+)-\[([^\]]+)\]/g;
const EXCLUDED_DIMENSION_LITERALS = new Set(["0px", "0rem"]);
const MIGRATION_REPORT_RELATIVE_PATH = "design-system/MIGRATION.md";

function normalizeLiteral(raw, options = {}) {
  const color = normalizeColorLiteral(raw);
  if (color) {
    return { kind: "color", normalized: color };
  }
  const dimension = normalizeDimensionLiteral(raw, options);
  if (dimension) {
    return { kind: "dimension", normalized: dimension };
  }
  return null;
}

function resolveTokenValue(token, tokens, depth = 0) {
  if (depth > 32) {
    return null;
  }
  if (isCompleteAlias(token.value)) {
    const target = tokens.get(token.value.slice(1, -1));
    return target ? resolveTokenValue(target, tokens, depth + 1) : null;
  }
  return token.value;
}

/**
 * Index confirmed token values by normalized literal. Replacement targets are
 * chosen from this index with Semantic-first priority so migrated code
 * consumes intent, not raw palette entries.
 */
export async function loadManagedValueIndex(projectRoot, options = {}) {
  const tokensRoot = path.join(projectRoot, "design-system", "tokens");
  const loaded = await loadTokenDirectory(tokensRoot).catch(() => null);
  const index = new Map();
  const byPath = new Map();
  if (!loaded) {
    return { byPath, index, issues: [{ code: "missing-core-tokens", message: "design-system/tokens was not found", severity: "error" }], tokenCount: 0 };
  }
  for (const token of loaded.tokens.values()) {
    const resolved = resolveTokenValue(token, loaded.tokens);
    let normalized = null;
    if (token.type === "color" && isObject(resolved) && resolved.colorSpace === "srgb") {
      normalized = typeof resolved.hex === "string"
        ? normalizeHex(resolved.hex)
        : Array.isArray(resolved.components)
          ? srgbToHex(resolved.components, resolved.alpha ?? 1)
          : null;
    } else if (token.type === "dimension" && isObject(resolved)
      && typeof resolved.value === "number" && typeof resolved.unit === "string") {
      normalized = normalizeDimensionLiteral(`${resolved.value}${resolved.unit}`, options);
    }
    if (!normalized) {
      continue;
    }
    const entry = {
      cssVariable: cssVariableNameForTokenPath(token.path),
      layer: token.layer,
      path: token.path,
      type: token.type
    };
    byPath.set(token.path, entry);
    const bucket = index.get(normalized) ?? [];
    bucket.push(entry);
    index.set(normalized, bucket);
  }
  for (const bucket of index.values()) {
    bucket.sort((left, right) => left.path.localeCompare(right.path));
  }
  return { byPath, index, issues: loaded.issues, tokenCount: loaded.tokens.size };
}

/**
 * CSS property → value category. A literal is only allowed to match tokens
 * whose path belongs to the same category, so `font-size: 14px` never gets
 * `table.cell.padding-y` offered and `padding: 14px` never gets `text.body.size`.
 * Unknown properties fall back to value-only matching.
 */
const PROPERTY_CATEGORIES = [
  [/^font-size$/, "font-size"],
  [/^line-height$/, "line-height"],
  [/^letter-spacing$/, "letter-spacing"],
  [/^(?:padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left|scroll-margin|scroll-padding|text-indent)(?:-[a-z]+)*$/, "spacing"],
  [/^(?:min-|max-)?(?:width|height|block-size|inline-size)$|^flex-basis$/, "size"],
  [/^border(?:-[a-z]+)*-radius$/, "radius"],
  [/^(?:border(?:-(?:top|right|bottom|left|inline|block)(?:-[a-z]+)?)?(?:-width)?|outline(?:-width)?)$/, "border"],
  [/^(?:color|-webkit-text-fill-color|caret-color|text-decoration-color)$/, "text-color"],
  [/^background(?:-color)?$/, "background-color"],
  [/^(?:fill|stroke)$/, "icon-color"],
  [/^(?:box-shadow|text-shadow|filter)$/, "shadow"]
];
const DIMENSION_CATEGORY_FIT = {
  "font-size": (tokenPath) => /(?:^|\.)(?:text|font|typography)\.[^.]*(?:\.size|size$)|(?:^|\.)icon\.size|font\.size/.test(tokenPath),
  "line-height": (tokenPath) => /line-height/.test(tokenPath),
  "letter-spacing": (tokenPath) => /tracking|letter-spacing/.test(tokenPath),
  spacing: (tokenPath) => /(?:^|\.)(?:spacing|space)\.|padding|gap|inset|offset/.test(tokenPath) && !/line-height|\bsize\b/.test(tokenPath),
  size: (tokenPath) => /(?:^|\.)size\.|width|height|(?:^|\.)(?:layout|control|icon|avatar|illustration)\./.test(tokenPath) && !/padding|line-height|border\.width|ring\.width/.test(tokenPath),
  radius: (tokenPath) => /radius/.test(tokenPath),
  border: (tokenPath) => /border\.width|ring\.width|(?:^|\.)width\./.test(tokenPath)
};
const COLOR_CATEGORY_FIT = {
  "text-color": (tokenPath) => /(?:^|\.)color\.(?:text|status|data|icon|link)\./.test(tokenPath) && !/-bg$|\.bg$|\.bg\./.test(tokenPath),
  "background-color": (tokenPath) => /(?:^|\.)color\.(?:bg|action|surface|brand)\.|-bg$|\.bg$|\.bg\./.test(tokenPath),
  border: (tokenPath) => /(?:^|\.)color\.(?:border|focus)\.|border-color|focus\.ring/.test(tokenPath),
  "icon-color": (tokenPath) => /(?:^|\.)color\.(?:icon|chart|data|status)\./.test(tokenPath),
  shadow: (tokenPath) => /shadow|elevation/.test(tokenPath)
};

export function propertyCategory(property) {
  if (typeof property !== "string" || !property) {
    return null;
  }
  const normalized = property.trim().toLowerCase();
  for (const [expression, category] of PROPERTY_CATEGORIES) {
    if (expression.test(normalized)) {
      return category;
    }
  }
  return null;
}

export function tokenFitsProperty(entry, property) {
  const category = propertyCategory(property);
  if (!category) {
    return true;
  }
  const table = entry.type === "color" ? COLOR_CATEGORY_FIT : DIMENSION_CATEGORY_FIT;
  const fit = table[category];
  return fit ? fit(entry.path) : true;
}

/**
 * Semantic-first choice: a single Semantic token wins; several Semantic
 * tokens with the same value are ambiguous; a Primitive-only or
 * Component-only hit needs a human to name the intent first.
 * When the CSS property is known, candidates are first narrowed to the
 * property's category (see PROPERTY_CATEGORIES); the plan records
 * `matchedBy: "property"` / `narrowedBy` so reviewers can see the narrowing.
 */
export function chooseTokenForValue(entries, property = null) {
  const semantic = entries.filter((entry) => entry.layer === "semantic");
  const pool = semantic.length > 0 ? semantic : entries;
  let narrowed = pool;
  let byProperty = false;
  if (property && propertyCategory(property)) {
    const fitting = pool.filter((entry) => tokenFitsProperty(entry, property));
    if (fitting.length > 0 && fitting.length < pool.length) {
      narrowed = fitting;
      byProperty = true;
    }
  }
  if (semantic.length > 0) {
    if (narrowed.length === 1) {
      return { match: narrowed[0], ...(byProperty ? { matchedBy: "property" } : {}) };
    }
    return {
      options: narrowed,
      pending: "ambiguous-semantic",
      ...(byProperty ? { allOptions: semantic.length, narrowedBy: property } : {})
    };
  }
  return { options: narrowed, pending: "primitive-only", ...(byProperty ? { narrowedBy: property } : {}) };
}

/** Tailwind utility prefix → the CSS property it sets (used for category narrowing). */
const TAILWIND_PREFIX_PROPERTIES = new Map([
  ["p", "padding"], ["px", "padding"], ["py", "padding"], ["pt", "padding"], ["pr", "padding"], ["pb", "padding"], ["pl", "padding"], ["ps", "padding"], ["pe", "padding"],
  ["m", "margin"], ["mx", "margin"], ["my", "margin"], ["mt", "margin"], ["mr", "margin"], ["mb", "margin"], ["ml", "margin"], ["ms", "margin"], ["me", "margin"],
  ["space-x", "margin"], ["space-y", "margin"], ["gap", "gap"], ["gap-x", "gap"], ["gap-y", "gap"],
  ["inset", "inset"], ["top", "top"], ["right", "right"], ["bottom", "bottom"], ["left", "left"],
  ["w", "width"], ["h", "height"], ["size", "width"], ["min-w", "min-width"], ["max-w", "max-width"], ["min-h", "min-height"], ["max-h", "max-height"], ["basis", "flex-basis"],
  ["leading", "line-height"], ["tracking", "letter-spacing"], ["bg", "background-color"], ["fill", "fill"], ["stroke", "stroke"], ["shadow", "box-shadow"]
]);
export function propertyForTailwindPrefix(prefix, kind) {
  if (typeof prefix !== "string") {
    return null;
  }
  const exact = TAILWIND_PREFIX_PROPERTIES.get(prefix);
  if (exact) {
    return exact;
  }
  if (prefix === "text") {
    return kind === "color" ? "color" : "font-size";
  }
  if (prefix === "border" || prefix.startsWith("border-") || prefix === "outline" || prefix.startsWith("outline-") || prefix === "ring") {
    return kind === "color" ? "border-color" : "border-width";
  }
  if (prefix === "rounded" || prefix.startsWith("rounded-")) {
    return "border-radius";
  }
  if (prefix.startsWith("scroll-m")) {
    return "scroll-margin";
  }
  if (prefix.startsWith("scroll-p")) {
    return "scroll-padding";
  }
  return null;
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let position = 0; position < index && position < text.length; position += 1) {
    if (text[position] === "\n") {
      line += 1;
    }
  }
  return line;
}

function propertyBefore(text, index) {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const before = text.slice(lineStart, index);
  const match = before.match(/([-A-Za-z][-\w]*)\s*:\s*[^:;]*$/);
  return match ? match[1] : null;
}

async function collectProjectFiles(projectRoot, options) {
  if (typeof options.files === "string" && options.files.trim()) {
    const requested = options.files.split(",").map((item) => item.trim()).filter(Boolean);
    const resolved = [];
    for (const item of requested) {
      resolved.push(await resolveExistingProjectFile(projectRoot, item, "--files entry"));
    }
    return resolved;
  }
  const files = await walkFiles(projectRoot);
  return files.filter((file) => !relativePosix(projectRoot, file).startsWith("design-system/"));
}

function pushPendingLiteral(aggregates, key, value, relative, extra = {}) {
  const current = aggregates.get(key) ?? { files: new Set(), occurrences: 0, value, ...extra };
  current.occurrences += 1;
  current.files.add(relative);
  aggregates.set(key, current);
}

function finalizeAggregates(aggregates, kind) {
  return [...aggregates.values()]
    .map((entry) => ({
      kind,
      ...entry,
      files: [...entry.files].sort((left, right) => left.localeCompare(right)).slice(0, 5)
    }))
    .sort((left, right) => right.occurrences - left.occurrences || left.value.localeCompare(right.value));
}

/**
 * Phase 1 (adopt): bridge legacy CSS variable definitions whose value matches
 * a confirmed token, e.g. `--brand: #2563eb` → `--brand: var(--color-…)`.
 * Existing consumers of the legacy name keep working untouched.
 */
export async function planAdopt(projectRoot, { index, matcher, files, normalizeOptions }) {
  const changes = [];
  const pending = [];
  const skipped = [];
  const exemptedFiles = [];

  for (const file of files) {
    const relative = relativePosix(projectRoot, file);
    if (!STYLESHEET_EXTENSIONS.has(path.extname(file).toLowerCase())) {
      continue;
    }
    if (matcher.isFileExempt(relative)) {
      exemptedFiles.push(relative);
      continue;
    }
    const source = await readTextIfSmall(file);
    if (source === null) {
      skipped.push({ file: relative, reason: "too-large-to-inspect" });
      continue;
    }
    const text = blankComments(source, path.extname(file));
    const edits = [];
    for (const match of text.matchAll(VARIABLE_DEFINITION_EXPRESSION)) {
      const name = match[1];
      const rawValue = match[3];
      const value = rawValue.trim();
      const valueStart = match.index + match[1].length + match[2].length
        + (rawValue.length - rawValue.trimStart().length);
      const line = lineNumberAt(text, match.index);
      if (value.includes("var(")) {
        continue;
      }
      if (matcher.isValueExempt(relative, value)) {
        continue;
      }
      const literal = normalizeLiteral(value, normalizeOptions);
      if (!literal) {
        continue;
      }
      const bucket = index.get(literal.normalized);
      if (!bucket) {
        pending.push({ file: relative, kind: "unmatched-definition", line, name, value });
        continue;
      }
      const chosen = chooseTokenForValue(bucket);
      if (chosen.pending) {
        pending.push({
          file: relative,
          kind: chosen.pending,
          line,
          name,
          options: chosen.options.map((entry) => entry.path),
          value
        });
        continue;
      }
      if (name === `--${chosen.match.cssVariable}`) {
        pending.push({
          file: relative,
          kind: "duplicate-definition",
          line,
          name,
          token: chosen.match.path,
          value
        });
        continue;
      }
      edits.push({
        cssVariable: chosen.match.cssVariable,
        end: valueStart + value.length,
        kind: "definition-bridge",
        line,
        name,
        oldValue: value,
        replacement: `var(--${chosen.match.cssVariable})`,
        start: valueStart,
        token: chosen.match.path
      });
    }
    if (edits.length > 0) {
      changes.push({ edits, file: relative, absolute: file });
    }
  }

  return { changes, exemptedFiles, pending, skipped };
}

/**
 * Phase 2 (replace): rewrite hard-coded literals in stylesheets and Tailwind
 * arbitrary values to `var(--…)` when they match exactly one Semantic token.
 * JS/TS inline style literals are reported, never rewritten, in this version.
 */
export async function planReplace(projectRoot, { index, matcher, files, normalizeOptions }) {
  const changes = [];
  const pending = [];
  const skipped = [];
  const exemptedFiles = [];
  const unmanaged = new Map();
  const jsLiterals = new Map();

  for (const file of files) {
    const relative = relativePosix(projectRoot, file);
    const extensionName = path.extname(file).toLowerCase();
    const isStylesheet = STYLESHEET_EXTENSIONS.has(extensionName);
    if (!isUiStyleFile(file)) {
      continue;
    }
    if (matcher.isFileExempt(relative)) {
      exemptedFiles.push(relative);
      continue;
    }
    const source = await readTextIfSmall(file);
    if (source === null) {
      skipped.push({ file: relative, reason: "too-large-to-inspect" });
      continue;
    }
    const text = blankComments(source, extensionName);
    const edits = [];

    if (isStylesheet) {
      const definitionRanges = [...text.matchAll(VARIABLE_DEFINITION_EXPRESSION)]
        .map((match) => [match.index, match.index + match[0].length]);
      const insideDefinition = (start) => definitionRanges
        .some(([from, to]) => start >= from && start < to);

      const literalMatches = [
        ...[...text.matchAll(COLOR_LITERAL_EXPRESSION)].map((match) => ({ index: match.index, raw: match[0] })),
        ...[...text.matchAll(DIMENSION_LITERAL_EXPRESSION)].map((match) => ({ index: match.index, raw: match[1] ?? match[0] }))
      ];
      for (const { index: startIndex, raw } of literalMatches) {
        if (insideDefinition(startIndex) || EXCLUDED_DIMENSION_LITERALS.has(raw.toLowerCase())) {
          continue;
        }
        if (matcher.isValueExempt(relative, raw)) {
          continue;
        }
        const literal = normalizeLiteral(raw, normalizeOptions);
        if (!literal) {
          continue;
        }
        const line = lineNumberAt(text, startIndex);
        const property = propertyBefore(text, startIndex);
        const bucket = index.get(literal.normalized);
        if (!bucket) {
          pushPendingLiteral(unmanaged, literal.normalized, raw.toLowerCase(), relative);
          continue;
        }
        const chosen = chooseTokenForValue(bucket, property);
        if (chosen.pending) {
          pending.push({
            file: relative,
            kind: chosen.pending,
            line,
            options: chosen.options.map((entry) => entry.path),
            ...(chosen.narrowedBy ? { allOptions: chosen.allOptions, narrowedBy: chosen.narrowedBy } : {}),
            property,
            value: raw
          });
          continue;
        }
        edits.push({
          cssVariable: chosen.match.cssVariable,
          end: startIndex + raw.length,
          kind: "literal",
          line,
          ...(chosen.matchedBy ? { matchedBy: chosen.matchedBy } : {}),
          oldValue: raw,
          property,
          replacement: `var(--${chosen.match.cssVariable})`,
          start: startIndex,
          token: chosen.match.path
        });
      }
    } else {
      const arbitraryRanges = [];
      for (const match of text.matchAll(TAILWIND_ARBITRARY_EXPRESSION)) {
        const inner = match[2];
        arbitraryRanges.push([match.index, match.index + match[0].length]);
        if (inner.includes("var(")) {
          continue;
        }
        if (matcher.isValueExempt(relative, inner)) {
          continue;
        }
        const literal = normalizeLiteral(inner, normalizeOptions);
        if (!literal) {
          continue;
        }
        const line = lineNumberAt(text, match.index);
        const bucket = index.get(literal.normalized);
        if (!bucket) {
          pushPendingLiteral(unmanaged, literal.normalized, inner.toLowerCase(), relative);
          continue;
        }
        const chosen = chooseTokenForValue(bucket, propertyForTailwindPrefix(match[1], literal.kind));
        if (chosen.pending) {
          pending.push({
            file: relative,
            kind: chosen.pending,
            line,
            options: chosen.options.map((entry) => entry.path),
            ...(chosen.narrowedBy ? { allOptions: chosen.allOptions, narrowedBy: chosen.narrowedBy } : {}),
            property: match[1],
            value: match[0]
          });
          continue;
        }
        edits.push({
          cssVariable: chosen.match.cssVariable,
          end: match.index + match[0].length,
          kind: "tailwind-arbitrary",
          line,
          ...(chosen.matchedBy ? { matchedBy: chosen.matchedBy } : {}),
          oldValue: match[0],
          property: match[1],
          replacement: `${match[1]}-[var(--${chosen.match.cssVariable})]`,
          start: match.index,
          token: chosen.match.path
        });
      }

      const insideArbitrary = (start) => arbitraryRanges
        .some(([from, to]) => start >= from && start < to);
      for (const match of text.matchAll(COLOR_LITERAL_EXPRESSION)) {
        if (insideArbitrary(match.index)) {
          continue;
        }
        if (matcher.isValueExempt(relative, match[0])) {
          continue;
        }
        const literal = normalizeLiteral(match[0]);
        if (!literal) {
          continue;
        }
        const bucket = index.get(literal.normalized);
        const suggestion = bucket ? chooseTokenForValue(bucket) : null;
        pushPendingLiteral(jsLiterals, `${literal.normalized}`, match[0].toLowerCase(), relative, {
          ...(suggestion?.match ? { suggestedToken: suggestion.match.path } : {})
        });
      }
    }

    if (edits.length > 0) {
      changes.push({ edits, file: relative, absolute: file });
    }
  }

  pending.push(...finalizeAggregates(unmanaged, "unmanaged-literal"));
  pending.push(...finalizeAggregates(jsLiterals, "js-literal"));
  return { changes, exemptedFiles, pending, skipped };
}

function summarizeChanges(changes) {
  return {
    editCount: changes.reduce((total, change) => total + change.edits.length, 0),
    fileCount: changes.length
  };
}

function publicChanges(changes) {
  return changes.map((change) => ({
    edits: change.edits.map((edit) => ({
      kind: edit.kind,
      line: edit.line,
      ...(edit.matchedBy ? { matchedBy: edit.matchedBy } : {}),
      ...(edit.name ? { name: edit.name } : {}),
      ...(edit.property ? { property: edit.property } : {}),
      oldValue: edit.oldValue,
      replacement: edit.replacement,
      token: edit.token
    })),
    file: change.file
  }));
}

function gitSafety(projectRoot) {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd: projectRoot, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return { dirty: null, repo: false };
  }
  return { dirty: result.stdout.trim().length > 0, repo: true };
}

function ensureSafeToWrite(projectRoot, options) {
  const safety = gitSafety(projectRoot);
  if (!safety.repo && options.force !== true) {
    throw new Error(
      "Refusing to write: the project is not a git repository, so this migration cannot be rolled back. "
      + "项目没有版本控制，改坏了无法一键回退；请先 git init 并提交一次，或在明确接受风险后加 --force。"
    );
  }
  if (safety.repo && safety.dirty && options["allow-dirty"] !== true && options.allowDirty !== true) {   // 文档写的是 --allow-dirty；0.5 只认 allowDirty，标志从未生效
    throw new Error(
      "Refusing to write: the git worktree has uncommitted changes. "
      + "工作区还有未提交的改动，混在一起就无法单独回滚本次迁移；请先 commit 或 stash，或加 --allow-dirty。"
    );
  }
  return safety;
}

async function applyChanges(changes) {
  for (const change of changes) {
    let text = await readFile(change.absolute, "utf8");
    const ordered = [...change.edits].sort((left, right) => right.start - left.start);
    for (const edit of ordered) {
      text = `${text.slice(0, edit.start)}${edit.replacement}${text.slice(edit.end)}`;
    }
    await writeFile(change.absolute, text, "utf8");
  }
}

function inferRouteHint(relative) {
  const parts = relative.split("/");
  const anchor = parts.findIndex((segment) => ["app", "pages", "routes"].includes(segment.toLowerCase()));
  if (anchor < 0 || anchor >= parts.length - 1) {
    return null;
  }
  const route = parts
    .slice(anchor + 1, -1)
    .filter((segment) => !["components", "styles"].includes(segment.toLowerCase()));
  return route.length > 0 ? `/${route.join("/")}` : "/";
}

function renderMigrationReport({ phase, projectRoot, changes, pending, commitMessage }) {
  const summary = summarizeChanges(changes);
  const files = changes.map((change) => change.file);
  const routeHints = [...new Set(files.map(inferRouteHint).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const lines = [];
  lines.push("# 迁移报告（最近一次 migrate --apply）");
  lines.push("");
  lines.push(`- 阶段：${phase}`);
  lines.push(`- 修改文件 ${summary.fileCount} 个，共改写 ${summary.editCount} 处。`);
  lines.push("- 本文件由 migrate.mjs 生成；历史报告请查 git 记录，不要手工编辑。");
  lines.push("");
  lines.push("## 本次改写对照");
  lines.push("");
  for (const change of changes) {
    lines.push(`### ${change.file}`);
    lines.push("");
    lines.push("| 行 | 位置 | 原值 | 现在 |");
    lines.push("| --- | --- | --- | --- |");
    for (const edit of change.edits) {
      const where = edit.name ?? edit.property ?? edit.kind;
      lines.push(`| ${edit.line} | ${where} | \`${edit.oldValue}\` | \`${edit.replacement}\` |`);
    }
    lines.push("");
  }
  lines.push("## 如何回滚");
  lines.push("");
  lines.push("- 还没提交：运行 `git restore " + files.map((file) => `'${file}'`).join(" ") + "`。");
  lines.push("- 已经提交：先 `git log --oneline -5` 找到本次迁移的提交号，再 `git revert <提交号>`。");
  lines.push("");
  lines.push("## 建议的下一步");
  lines.push("");
  lines.push(`1. 现在就提交，保住回滚点：\`git add -A && git commit -m "${commitMessage}"\`。`);
  if (routeHints.length > 0) {
    lines.push(`2. 打开开发服务器，肉眼过一遍这些页面：${routeHints.join("、")}。`);
  } else {
    lines.push("2. 打开开发服务器，肉眼过一遍受影响文件对应的页面。");
  }
  lines.push(`3. 复核本次改动：\`node ${path.join(skillRoot, "scripts", "guard.mjs")} --project ${projectRoot} --changed '${files.join(",")}'\`。`);
  lines.push("");
  if (pending.length > 0) {
    lines.push("## 待决清单（本次没有自动处理）");
    lines.push("");
    for (const item of pending.slice(0, 40)) {
      const location = item.file ? `${item.file}${item.line ? `:${item.line}` : ""}` : (item.files ?? []).join("、");
      lines.push(`- [${item.kind}] ${item.name ?? item.value}${location ? `（${location}）` : ""}`);
    }
    lines.push("");
    lines.push("处理方式：运行 `migrate --phase settle` 逐组决定归并、升级或豁免。");
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Phase 3 (settle): aggregate everything the earlier phases refused to touch
 * and prepare a decision list. `--apply` only records confirmed exemptions;
 * merges and promotions still go through propose/apply.
 */
export async function planSettle(projectRoot, { index, matcher, files, normalizeOptions, exemptions }) {
  const adopt = await planAdopt(projectRoot, { files, index, matcher, normalizeOptions });
  const replace = await planReplace(projectRoot, { files, index, matcher, normalizeOptions });
  const pendingGroups = new Map();
  for (const item of [...adopt.pending, ...replace.pending]) {
    const bucket = pendingGroups.get(item.kind) ?? [];
    bucket.push(item);
    pendingGroups.set(item.kind, bucket);
  }
  const decisions = [...pendingGroups.entries()].map(([kind, items]) => ({
    count: items.length,
    items: items.slice(0, 20),
    kind,
    options: [
      "merge：这个值其实就是某个已批准 Token，替换成它（回到 propose 记录选择）",
      "promote：这是一个还没命名的真规范，走 propose 建 Token",
      "exempt：有意保留原样，登记进 design-system/exemptions.json 并写明理由"
    ]
  }));
  return {
    decisions,
    exemptions: {
      entryCount: exemptions.entries.length,
      present: exemptions.present
    },
    remainingBridges: summarizeChanges(adopt.changes),
    remainingReplacements: summarizeChanges(replace.changes)
  };
}

/**
 * Merge decisions confirmed in settle: `{ value, token, property?, name?, files? }`.
 * Each decision rewrites the literal (or legacy definition) it names to
 * `var(--token)`. Only stylesheets and Tailwind arbitrary values are rewritten;
 * JS literals stay reported. Unknown tokens abort before anything is written.
 */
export function validateMergeDecisions(merges, byPath) {
  if (merges === undefined || merges === null) {
    return [];
  }
  if (!Array.isArray(merges)) {
    throw new Error("decisions.merges must be an array of { value, token, property?, name?, files? }");
  }
  return merges.map((decision, position) => {
    if (!isObject(decision) || typeof decision.token !== "string" || (typeof decision.value !== "string" && typeof decision.name !== "string")) {
      throw new Error(`decisions.merges[${position}] needs a string token and a string value (or a legacy variable name)`);
    }
    const entry = byPath.get(decision.token);
    if (!entry) {
      throw new Error(`decisions.merges[${position}] points to an unknown token: ${decision.token}`);
    }
    const literal = typeof decision.value === "string" ? normalizeLiteral(decision.value) : null;
    if (typeof decision.value === "string" && !literal) {
      throw new Error(`decisions.merges[${position}] has a value that is neither a color nor a px/rem dimension: ${decision.value}`);
    }
    return {
      entry,
      files: Array.isArray(decision.files) ? decision.files.map(String) : null,
      name: typeof decision.name === "string" ? decision.name : null,
      normalized: literal ? literal.normalized : null,
      property: typeof decision.property === "string" ? decision.property.trim().toLowerCase() : null,
      token: decision.token
    };
  });
}

export async function planMerges(projectRoot, { merges, matcher, files, normalizeOptions }) {
  const changes = [];
  const warnings = [];
  for (const decision of merges) {
    if (decision.entry.layer !== "semantic") {
      warnings.push(`merge → ${decision.token} 是 ${decision.entry.layer} 层 Token；治理约定消费端应使用 Semantic 层，请确认这是有意为之。`);
    }
  }
  const fileAllowed = (decision, relative) => !decision.files || decision.files.some((pattern) => relative === pattern || relative.startsWith(pattern.replace(/\*\*?$/, "")));
  for (const file of files) {
    const relative = relativePosix(projectRoot, file);
    const extensionName = path.extname(file).toLowerCase();
    const isStylesheet = STYLESHEET_EXTENSIONS.has(extensionName);
    if (!isUiStyleFile(file) || matcher.isFileExempt(relative)) {
      continue;
    }
    const source = await readTextIfSmall(file);
    if (source === null) {
      continue;
    }
    const text = blankComments(source, extensionName);
    const edits = [];
    if (isStylesheet) {
      const definitionRanges = [];
      for (const match of text.matchAll(VARIABLE_DEFINITION_EXPRESSION)) {
        definitionRanges.push([match.index, match.index + match[0].length]);
        const name = match[1];
        const rawValue = match[3];
        const value = rawValue.trim();
        if (value.includes("var(")) {
          continue;
        }
        const literal = normalizeLiteral(value, normalizeOptions);
        const decision = merges.find((candidate) => fileAllowed(candidate, relative)
          && (candidate.name ? candidate.name === name : (literal && candidate.normalized === literal.normalized)));
        if (!decision) {
          continue;
        }
        const valueStart = match.index + match[1].length + match[2].length + (rawValue.length - rawValue.trimStart().length);
        edits.push({
          cssVariable: decision.entry.cssVariable, end: valueStart + value.length, kind: "merge-definition", line: lineNumberAt(text, match.index),
          name, oldValue: value, replacement: `var(--${decision.entry.cssVariable})`, start: valueStart, token: decision.token
        });
      }
      const insideDefinition = (start) => definitionRanges.some(([from, to]) => start >= from && start < to);
      const literalMatches = [
        ...[...text.matchAll(COLOR_LITERAL_EXPRESSION)].map((match) => ({ index: match.index, raw: match[0] })),
        ...[...text.matchAll(DIMENSION_LITERAL_EXPRESSION)].map((match) => ({ index: match.index, raw: match[1] ?? match[0] }))
      ];
      for (const { index: startIndex, raw } of literalMatches) {
        if (insideDefinition(startIndex)) {
          continue;
        }
        const literal = normalizeLiteral(raw, normalizeOptions);
        if (!literal) {
          continue;
        }
        const property = propertyBefore(text, startIndex);
        const decision = merges.find((candidate) => !candidate.name && candidate.normalized === literal.normalized
          && fileAllowed(candidate, relative) && (!candidate.property || candidate.property === (property ?? "").toLowerCase()));
        if (!decision) {
          continue;
        }
        edits.push({
          cssVariable: decision.entry.cssVariable, end: startIndex + raw.length, kind: "merge", line: lineNumberAt(text, startIndex),
          oldValue: raw, property, replacement: `var(--${decision.entry.cssVariable})`, start: startIndex, token: decision.token
        });
      }
    } else {
      for (const match of text.matchAll(TAILWIND_ARBITRARY_EXPRESSION)) {
        const inner = match[2];
        if (inner.includes("var(")) {
          continue;
        }
        const literal = normalizeLiteral(inner, normalizeOptions);
        if (!literal) {
          continue;
        }
        const property = propertyForTailwindPrefix(match[1], literal.kind);
        const decision = merges.find((candidate) => !candidate.name && candidate.normalized === literal.normalized
          && fileAllowed(candidate, relative) && (!candidate.property || candidate.property === property));
        if (!decision) {
          continue;
        }
        edits.push({
          cssVariable: decision.entry.cssVariable, end: match.index + match[0].length, kind: "merge-tailwind", line: lineNumberAt(text, match.index),
          oldValue: match[0], property: match[1], replacement: `${match[1]}-[var(--${decision.entry.cssVariable})]`, start: match.index, token: decision.token
        });
      }
    }
    if (edits.length > 0) {
      changes.push({ absolute: file, edits, file: relative });
    }
  }
  return { changes, warnings };
}

async function readDecisions(projectRoot, options, byPath) {
  const resolveFile = (value) => (path.isAbsolute(value) ? value : path.resolve(projectRoot, value));
  let merges = [];
  let exemptionEntries = [];
  const issues = [];
  if (typeof options["decisions-file"] === "string") {
    const document = await readJson(resolveFile(options["decisions-file"]));
    if (!isObject(document)) {
      throw new Error("--decisions-file must contain a JSON object with optional merges and exemptions arrays");
    }
    merges = validateMergeDecisions(document.merges, byPath);
    if (document.exemptions !== undefined) {
      exemptionEntries = validateExemptionEntries(document.exemptions, issues);
    }
  }
  if (typeof options["exemptions-file"] === "string") {
    const document = await readJson(resolveFile(options["exemptions-file"]));
    exemptionEntries = [...exemptionEntries, ...validateExemptionEntries(isObject(document) ? document.exemptions : null, issues)];
  }
  if (issues.length > 0) {
    throw new Error(`exemption entries are invalid: ${issues.map((entry) => entry.message).join("; ")}`);
  }
  return { exemptionEntries, merges, present: typeof options["decisions-file"] === "string" || typeof options["exemptions-file"] === "string" };
}

async function writeExemptionEntries(projectRoot, incoming, existingEntries) {
  const merged = [...existingEntries];
  for (const entry of incoming) {
    const duplicate = merged.some((current) => current.path === entry.path && current.value === entry.value);
    if (!duplicate) {
      merged.push(entry);
    }
  }
  merged.sort((left, right) => `${left.path}:${left.value ?? ""}`.localeCompare(`${right.path}:${right.value ?? ""}`));
  if (incoming.length === 0) {
    return { added: 0, total: merged.length };
  }
  const target = path.join(projectRoot, "design-system", "exemptions.json");
  await writeText(target, `${JSON.stringify(stableValue({
    $description: "已确认的豁免登记册：这些路径或值是有意不纳管的，audit 与 guard 会静默跳过。每条必须有理由。",
    exemptions: merged
  }), null, 2)}\n`);
  return { added: incoming.length, total: merged.length };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = await requireDirectory(requireStringOption(options, "project"), "--project");
  const phase = requireStringOption(options, "phase");
  if (!PHASES.has(phase)) {
    throw new Error(`--phase must be one of: ${[...PHASES].join(", ")}`);
  }
  const apply = options.apply === true;
  const normalizeOptions = {};
  if (typeof options["rem-in-px"] === "string") {
    const remInPx = Number(options["rem-in-px"]);
    if (!Number.isFinite(remInPx) || remInPx <= 0) {
      throw new Error("--rem-in-px must be a positive number, e.g. 16");
    }
    normalizeOptions.remInPx = remInPx;
  }

  const exemptions = await loadExemptions(projectRoot);
  const matcher = createExemptionMatcher(exemptions.entries);
  const managed = await loadManagedValueIndex(projectRoot, normalizeOptions);
  if (managed.tokenCount === 0) {
    printJson({
      message: "No confirmed tokens exist yet, so there is nothing to migrate to. 请先完成 setup／apply 建立 Core，再回来统一存量。",
      phase,
      status: "no-managed-tokens",
      writes: false
    });
    process.exitCode = 1;
    return;
  }
  const files = await collectProjectFiles(projectRoot, options);

  if (phase === "settle") {
    const decisions = await readDecisions(projectRoot, options, managed.byPath);
    const mergePlan = decisions.merges.length > 0
      ? await planMerges(projectRoot, { files, matcher, merges: decisions.merges, normalizeOptions })
      : { changes: [], warnings: [] };
    let applied = null;
    let migrationReport = null;
    if (apply) {
      if (!decisions.present) {
        throw new Error("settle --apply requires --decisions-file (merges and/or exemptions) or --exemptions-file with the user-confirmed entries");
      }
      ensureSafeToWrite(projectRoot, options);
      const mergeSummary = summarizeChanges(mergePlan.changes);
      if (mergeSummary.editCount > 0) {
        await applyChanges(mergePlan.changes);
        migrationReport = MIGRATION_REPORT_RELATIVE_PATH;
      }
      const exemptionsResult = await writeExemptionEntries(projectRoot, decisions.exemptionEntries, exemptions.entries);
      applied = { ...exemptionsResult, exemptions: exemptionsResult, merges: mergeSummary };   // added / total 顶层保留给 0.5 的调用方
    }
    // Re-plan after writes so the decision list reflects what is still pending.
    const refreshed = applied ? await loadExemptions(projectRoot) : exemptions;
    const settle = await planSettle(projectRoot, { exemptions: refreshed, files, index: managed.index, matcher: createExemptionMatcher(refreshed.entries), normalizeOptions });
    if (migrationReport) {
      await writeText(
        path.join(projectRoot, "design-system", "MIGRATION.md"),
        renderMigrationReport({ changes: mergePlan.changes, commitMessage: `migrate(settle): apply ${applied.merges.editCount} confirmed merge decisions`, pending: settle.decisions.flatMap((group) => group.items), phase, projectRoot })
      );
    }
    printJson({
      ...settle,
      exemptionIssues: exemptions.issues,
      ...(decisions.merges.length > 0 ? { mergePlan: { changes: publicChanges(mergePlan.changes), summary: summarizeChanges(mergePlan.changes), warnings: mergePlan.warnings } } : {}),
      ...(migrationReport ? { migrationReport } : {}),
      phase,
      status: settle.decisions.length > 0 ? "needs-decisions" : "settled",
      ...(applied ? { applied } : {}),
      writes: apply && ((applied?.merges.editCount ?? 0) > 0 || (applied?.exemptions.added ?? 0) > 0)
    });
    return;
  }

  const plan = phase === "adopt"
    ? await planAdopt(projectRoot, { files, index: managed.index, matcher, normalizeOptions })
    : await planReplace(projectRoot, { files, index: managed.index, matcher, normalizeOptions });
  const summary = summarizeChanges(plan.changes);
  let migrationReport = null;
  let safety = gitSafety(projectRoot);

  if (apply && summary.editCount > 0) {
    safety = ensureSafeToWrite(projectRoot, options);
    await applyChanges(plan.changes);
    const commitMessage = phase === "adopt"
      ? `migrate(adopt): bridge ${summary.editCount} legacy definitions to tokens`
      : `migrate(replace): swap ${summary.editCount} literals for semantic tokens`;
    migrationReport = MIGRATION_REPORT_RELATIVE_PATH;
    await writeText(
      path.join(projectRoot, "design-system", "MIGRATION.md"),
      renderMigrationReport({ changes: plan.changes, commitMessage, pending: plan.pending, phase, projectRoot })
    );
  }

  printJson({
    changes: publicChanges(plan.changes),
    exemptedFiles: plan.exemptedFiles,
    exemptionIssues: exemptions.issues,
    gitSafety: safety,
    ...(migrationReport ? { migrationReport } : {}),
    pending: plan.pending,
    phase,
    skipped: plan.skipped,
    status: apply
      ? summary.editCount > 0 ? "applied" : "nothing-to-apply"
      : summary.editCount > 0 ? "ready-to-apply" : "nothing-to-migrate",
    summary: { ...summary, pendingCount: plan.pending.length },
    writes: apply && summary.editCount > 0
  });
}

if (process.argv[1] && process.argv[1].endsWith("migrate.mjs")) {
  main().catch((error) => {
    reportError(error);
    process.exitCode = 2;
  });
}

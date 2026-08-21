import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
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
  if (!loaded) {
    return { index, issues: [{ code: "missing-core-tokens", message: "design-system/tokens was not found", severity: "error" }], tokenCount: 0 };
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
    const bucket = index.get(normalized) ?? [];
    bucket.push(entry);
    index.set(normalized, bucket);
  }
  for (const bucket of index.values()) {
    bucket.sort((left, right) => left.path.localeCompare(right.path));
  }
  return { index, issues: loaded.issues, tokenCount: loaded.tokens.size };
}

/**
 * Semantic-first choice: a single Semantic token wins; several Semantic
 * tokens with the same value are ambiguous; a Primitive-only or
 * Component-only hit needs a human to name the intent first.
 */
export function chooseTokenForValue(entries) {
  const semantic = entries.filter((entry) => entry.layer === "semantic");
  if (semantic.length === 1) {
    return { match: semantic[0] };
  }
  if (semantic.length > 1) {
    return { options: semantic, pending: "ambiguous-semantic" };
  }
  return { options: entries, pending: "primitive-only" };
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
    const text = await readTextIfSmall(file);
    if (text === null) {
      skipped.push({ file: relative, reason: "too-large-to-inspect" });
      continue;
    }
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
    const text = await readTextIfSmall(file);
    if (text === null) {
      skipped.push({ file: relative, reason: "too-large-to-inspect" });
      continue;
    }
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
        const chosen = chooseTokenForValue(bucket);
        if (chosen.pending) {
          pending.push({
            file: relative,
            kind: chosen.pending,
            line,
            options: chosen.options.map((entry) => entry.path),
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
        const chosen = chooseTokenForValue(bucket);
        if (chosen.pending) {
          pending.push({
            file: relative,
            kind: chosen.pending,
            line,
            options: chosen.options.map((entry) => entry.path),
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
  if (safety.repo && safety.dirty && options.allowDirty !== true) {
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

async function applyExemptionsFile(projectRoot, exemptionsFile, existingEntries) {
  const document = await readJson(exemptionsFile);
  const issues = [];
  const incoming = validateExemptionEntries(isObject(document) ? document.exemptions : null, issues);
  if (issues.length > 0) {
    const details = issues.map((entry) => entry.message).join("; ");
    throw new Error(`--exemptions-file is invalid: ${details}`);
  }
  const merged = [...existingEntries];
  for (const entry of incoming) {
    const duplicate = merged.some((current) => current.path === entry.path && current.value === entry.value);
    if (!duplicate) {
      merged.push(entry);
    }
  }
  merged.sort((left, right) => `${left.path}:${left.value ?? ""}`.localeCompare(`${right.path}:${right.value ?? ""}`));
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
    const settle = await planSettle(projectRoot, { exemptions, files, index: managed.index, matcher, normalizeOptions });
    let applied = null;
    if (apply) {
      if (typeof options["exemptions-file"] !== "string") {
        throw new Error("settle --apply requires --exemptions-file with the user-confirmed exemption entries");
      }
      ensureSafeToWrite(projectRoot, options);
      const answersFile = path.isAbsolute(options["exemptions-file"])
        ? options["exemptions-file"]
        : path.resolve(projectRoot, options["exemptions-file"]);
      applied = await applyExemptionsFile(projectRoot, answersFile, exemptions.entries);
    }
    printJson({
      ...settle,
      exemptionIssues: exemptions.issues,
      phase,
      status: settle.decisions.length > 0 ? "needs-decisions" : "settled",
      ...(applied ? { applied } : {}),
      writes: apply
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

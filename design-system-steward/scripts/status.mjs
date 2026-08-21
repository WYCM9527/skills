import path from "node:path";

import {
  fileExists,
  parseArgs,
  printJson,
  readTextIfSmall,
  relativePosix,
  reportError,
  requireDirectory,
  requireStringOption,
  walkFiles
} from "./lib.mjs";
import { isUiStyleFile } from "./governance-lib.mjs";
import { validateDesignSystem } from "./validate-system.mjs";
import { createExemptionMatcher, findStaleExemptions, loadExemptions } from "./exemptions.mjs";
import { loadManagedValueIndex, planAdopt, planReplace } from "./migrate.mjs";

const VAR_USAGE_EXPRESSION = /var\(\s*--[A-Za-z0-9_-]+/g;

function pendingOccurrences(pending) {
  return pending.reduce((total, item) => total + (item.occurrences ?? 1), 0);
}

/**
 * Read-only progress dashboard: how much of the project already consumes the
 * design system, what migrate could still unify, and the single best next
 * step. Never writes.
 */
export async function collectStatus(projectRoot) {
  if (!(await fileExists(path.join(projectRoot, "design-system")))) {
    return {
      status: "not-initialized",
      suggestions: [
        "这个项目还没有 design-system/。运行 setup：一次审计加一份问卷即可建立 Core，不会改任何页面。"
      ],
      writes: false
    };
  }

  const validation = await validateDesignSystem(projectRoot);
  const exemptions = await loadExemptions(projectRoot);
  const staleExemptions = findStaleExemptions(exemptions.entries, projectRoot);
  const base = {
    core: validation.core,
    exemptions: {
      entryCount: exemptions.entries.length,
      present: exemptions.present,
      stale: staleExemptions
    },
    scopes: validation.scopes.map((scope) => ({ id: scope.id, status: scope.status, tokenCount: scope.tokenCount })),
    themes: validation.themes.map((theme) => ({ id: theme.id, status: theme.status, tokenCount: theme.tokenCount })),
    writes: false
  };

  if (validation.status === "empty-scaffold") {
    return {
      ...base,
      status: "empty-scaffold",
      suggestions: [
        "Token 文件还是空脚手架。回到 propose／apply，把问卷里确认的颜色和间距填进 design-system/tokens/。"
      ]
    };
  }
  if (!validation.valid) {
    return {
      ...base,
      issues: validation.issues.filter((issue) => issue.severity === "error").slice(0, 10),
      status: "invalid-system",
      suggestions: [
        "设计系统本身有校验错误，先修好再谈统一。运行 validate-system.mjs 查看完整问题列表。"
      ]
    };
  }

  const matcher = createExemptionMatcher(exemptions.entries);
  const managed = await loadManagedValueIndex(projectRoot, {});
  const files = (await walkFiles(projectRoot))
    .filter((file) => !relativePosix(projectRoot, file).startsWith("design-system/"));
  const adopt = await planAdopt(projectRoot, { files, index: managed.index, matcher, normalizeOptions: {} });
  const replace = await planReplace(projectRoot, { files, index: managed.index, matcher, normalizeOptions: {} });

  let varUsages = 0;
  for (const file of files) {
    if (!isUiStyleFile(file)) {
      continue;
    }
    const relative = relativePosix(projectRoot, file);
    if (matcher.isFileExempt(relative)) {
      continue;
    }
    const text = await readTextIfSmall(file);
    if (text === null) {
      continue;
    }
    varUsages += [...text.matchAll(VAR_USAGE_EXPRESSION)].length;
  }

  const bridgeable = adopt.changes.reduce((total, change) => total + change.edits.length, 0);
  const replaceable = replace.changes.reduce((total, change) => total + change.edits.length, 0);
  const pendingCount = pendingOccurrences(adopt.pending) + pendingOccurrences(replace.pending);
  const literalDebt = replaceable + pendingOccurrences(replace.pending);
  const adoptionPercent = varUsages + literalDebt > 0
    ? Math.round((varUsages / (varUsages + literalDebt)) * 100)
    : null;

  const suggestions = [];
  if (bridgeable > 0) {
    suggestions.push(`还有 ${bridgeable} 处旧变量定义可以桥接到 Token：运行 migrate --phase adopt（先看只读计划，确认后 --apply）。`);
  }
  if (replaceable > 0) {
    suggestions.push(`还有 ${replaceable} 处硬编码可以替换成语义 Token：运行 migrate --phase replace。`);
  }
  if (pendingCount > 0) {
    suggestions.push(`有 ${pendingCount} 处值需要人拍板（语义不明、撞值或在 JS 里）：运行 migrate --phase settle 逐组决定归并、升级或豁免。`);
  }
  if (staleExemptions.length > 0) {
    suggestions.push(`有 ${staleExemptions.length} 条豁免指向已删除的文件，可以顺手清掉这些登记。`);
  }
  if (suggestions.length === 0) {
    suggestions.push("存量已统一。日常改动用 change 分流；改完 UI 后跑 guard --changed 复核即可。");
  }

  return {
    ...base,
    adoption: {
      literalDebt,
      percent: adoptionPercent,
      varUsages
    },
    migration: {
      bridgeable,
      pendingDecisions: pendingCount,
      replaceable
    },
    status: bridgeable + replaceable + pendingCount > 0 ? "in-progress" : "unified",
    suggestions
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = await requireDirectory(requireStringOption(options, "project"), "--project");
  printJson(await collectStatus(projectRoot));
}

if (process.argv[1] && process.argv[1].endsWith("status.mjs")) {
  main().catch((error) => {
    reportError(error);
    process.exitCode = 2;
  });
}

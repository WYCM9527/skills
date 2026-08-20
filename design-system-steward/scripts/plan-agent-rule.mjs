import { lstat } from "node:fs/promises";
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
import {
  assertProjectPathDoesNotTraverseSymlink,
  resolveExistingProjectFile
} from "./governance-lib.mjs";

const ROOT_RULE_FILES = ["AGENTS.md", "CLAUDE.md"];
const RULE_DIRECTORIES = [".claude/rules", ".cursor/rules"];
const RULE_EXTENSIONS = new Set([".md", ".mdc", ".txt"]);
const PROPOSED_RULE = [
  "所有 UI 修改先阅读 `design-system/DESIGN.md` 与当前 Scope／Theme 的登记和说明，只使用已管理的设计决定。",
  "若需求需要新增、修改或跨页面复用的视觉决定，先提出提案；确认后先更新设计系统源、构建并运行 Guard，再实现页面。",
  "不要手改 `design-system/dist/`；一次性差异先作为 Drift 或实验处理，不自动升级为规范。"
];

function isRuleFile(file) {
  return RULE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

async function discoverRuleFiles(projectRoot) {
  const discovered = [];
  for (const relative of ROOT_RULE_FILES) {
    const candidate = path.join(projectRoot, relative);
    if (await fileExists(candidate)) {
      discovered.push(await resolveExistingProjectFile(projectRoot, candidate, "agent rule file"));
    }
  }
  for (const relativeDirectory of RULE_DIRECTORIES) {
    const directory = path.join(projectRoot, relativeDirectory);
    if (!(await fileExists(directory))) {
      continue;
    }
    await assertProjectPathDoesNotTraverseSymlink(projectRoot, directory, "agent rule directory");
    const details = await lstat(directory);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      continue;
    }
    const files = await walkFiles(directory);
    for (const file of files) {
      if (isRuleFile(file)) {
        discovered.push(file);
      }
    }
  }
  return [...new Set(discovered)]
    .sort((left, right) => relativePosix(projectRoot, left).localeCompare(relativePosix(projectRoot, right)));
}

async function describeRuleFile(projectRoot, file) {
  const text = await readTextIfSmall(file);
  return {
    file: relativePosix(projectRoot, file),
    hasDesignSystemReference: text === null ? null : /design-system|DESIGN\.md|\.tokens\.json|data-ds-scope/i.test(text),
    inspectable: text !== null
  };
}

function recommendedTarget(files) {
  const agents = files.find((file) => file.file === "AGENTS.md");
  if (agents) {
    return agents.file;
  }
  return files.length === 1 ? files[0].file : null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = await requireDirectory(requireStringOption(options, "project"), "--project");
  const files = await discoverRuleFiles(projectRoot);
  const existingRuleFiles = await Promise.all(files.map((file) => describeRuleFile(projectRoot, file)));
  const target = recommendedTarget(existingRuleFiles);
  const hasExistingReferences = existingRuleFiles.some((file) => file.hasDesignSystemReference === true);
  const status = existingRuleFiles.length === 0
    ? "no-existing-rule-file"
    : existingRuleFiles.length === 1
      ? "ready-for-user-approval"
      : "needs-user-target-choice";

  printJson({
    existingRuleFiles,
    nextAction: existingRuleFiles.length === 0
      ? "未找到现有 Agent 规则文件。请由用户决定是否创建并指定一个项目级规则文件；本工具不会创建它。"
      : target
        ? `请向用户明确询问：是否把这三行规则写入 ${target}？获得批准前不要写入。`
        : "请让用户从现有规则文件中选择一个目标；获得明确批准前不要写入。",
    proposedRule: PROPOSED_RULE,
    status,
    targetChoice: {
      existingDesignSystemReferencesNeedReview: hasExistingReferences,
      recommendedTarget: target,
      requiresExplicitUserApproval: true
    },
    writes: false
  });
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

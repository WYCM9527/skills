import {
  parseArgs,
  printJson,
  readTextIfSmall,
  relativePosix,
  reportError,
  requireDirectory,
  requireStringOption
} from "./lib.mjs";
import {
  extractVisualCandidates,
  hasVisualCandidates,
  isUiStyleFile,
  resolveExistingProjectFile
} from "./governance-lib.mjs";

function changedPaths(value) {
  const paths = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (paths.length === 0) {
    throw new Error("--changed must contain at least one comma-separated path");
  }
  return paths;
}

function generatedOutput(relative) {
  return relative.startsWith("design-system/dist/");
}

export async function inspectChangedFiles(projectRoot, changed) {
  const requestedPaths = changedPaths(changed);
  const resolved = new Map();

  for (const requested of requestedPaths) {
    const file = await resolveExistingProjectFile(projectRoot, requested, "--changed path");
    resolved.set(relativePosix(projectRoot, file), file);
  }

  const scannedFiles = [];
  const skippedFiles = [];
  for (const [relative, file] of [...resolved.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (!isUiStyleFile(file)) {
      skippedFiles.push({ file: relative, reason: "not-ui-style-file" });
      continue;
    }
    const text = await readTextIfSmall(file);
    if (text === null) {
      skippedFiles.push({ file: relative, reason: "too-large-to-inspect" });
      continue;
    }
    const candidates = extractVisualCandidates(text);
    const isGeneratedOutput = generatedOutput(relative);
    const hasCandidates = hasVisualCandidates(candidates) || isGeneratedOutput;
    scannedFiles.push({
      candidates: hasCandidates ? candidates : null,
      file: relative,
      generatedOutput: isGeneratedOutput,
      usesManagedCssVariables: candidates.usesManagedCssVariables
    });
  }

  const candidateFiles = scannedFiles.filter((entry) => entry.candidates !== null).map((entry) => entry.file);
  const status = candidateFiles.length > 0 ? "needs-steward-review" : "clear";
  return {
    candidateFiles,
    evidenceLimit: "字面量和 Scope／Theme 标记只是待复核候选；本检查不会推断设计语义、创建 Token 或修改文件。",
    nextAction: candidateFiles.length > 0
      ? "逐项确认候选是已有规范的消费、一次性 Drift，还是应先经用户批准的新规范；生成物只可由构建产生。"
      : "本次指定的 UI 样式文件未发现待复核候选。",
    scannedFiles,
    skippedFiles,
    status,
    writes: false
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = await requireDirectory(requireStringOption(options, "project"), "--project");
  printJson(await inspectChangedFiles(projectRoot, requireStringOption(options, "changed")));
}

if (process.argv[1] && process.argv[1].endsWith("check-drift.mjs")) {
  main().catch((error) => {
    reportError(error);
    process.exitCode = 2;
  });
}

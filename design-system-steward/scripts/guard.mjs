import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseArgs,
  printJson,
  relativePosix,
  reportError,
  requireDirectory,
  requireStringOption,
  walkFiles
} from "./lib.mjs";
import { buildDesignSystem } from "./build-tokens.mjs";
import { inspectChangedFiles } from "./check-drift.mjs";
import { validateDesignSystem } from "./validate-system.mjs";

async function generatedCssFiles(root) {
  if (!existsSync(root)) {
    return [];
  }
  return (await walkFiles(root, { ignoredDirectories: new Set() }))
    .filter((file) => file.endsWith(".css"))
    .map((file) => relativePosix(root, file))
    .sort((left, right) => left.localeCompare(right));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = await requireDirectory(requireStringOption(options, "project"), "--project");
  const validation = await validateDesignSystem(projectRoot);
  if (!validation.valid) {
    printJson({ ...validation, status: "invalid-system" });
    process.exitCode = 1;
    return;
  }

  const generatedRoot = path.join(projectRoot, "design-system", "dist");
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "design-system-steward-"));
  try {
    const rebuilt = await buildDesignSystem(projectRoot, temporaryRoot, { quiet: true });
    if (!rebuilt.valid) {
      printJson({ ...rebuilt, status: "invalid-system" });
      process.exitCode = 1;
      return;
    }

    const expectedFiles = await generatedCssFiles(temporaryRoot);
    const actualFiles = await generatedCssFiles(generatedRoot);
    const expectedSet = new Set(expectedFiles);
    const actualSet = new Set(actualFiles);
    const missingFiles = expectedFiles.filter((file) => !actualSet.has(file));
    const unexpectedFiles = actualFiles.filter((file) => !expectedSet.has(file));
    const staleFiles = [];

    for (const relativeFile of expectedFiles) {
      if (!actualSet.has(relativeFile)) {
        continue;
      }
      const [expected, actual] = await Promise.all([
        readFile(path.join(temporaryRoot, relativeFile)),
        readFile(path.join(generatedRoot, relativeFile))
      ]);
      if (!expected.equals(actual)) {
        staleFiles.push(relativeFile);
      }
    }

    const valid = missingFiles.length === 0 && unexpectedFiles.length === 0 && staleFiles.length === 0;
    const drift = options.changed === undefined
      ? null
      : await inspectChangedFiles(projectRoot, requireStringOption(options, "changed"));
    printJson({
      cssProfile: validation.cssProfile,
      generatedRoot,
      missingFiles,
      scopes: validation.scopes.map((scope) => ({ id: scope.id, selector: scope.selector, status: scope.status })),
      staleFiles,
      status: valid
        ? drift?.status === "needs-steward-review" ? "current-with-drift-candidates" : "current"
        : "stale-generated-output",
      themes: validation.themes.map((theme) => ({
        id: theme.id,
        mediaQuery: theme.mediaQuery,
        runtimeOwner: theme.runtimeOwner,
        selector: theme.selector,
        source: theme.source,
        status: theme.status
      })),
      unexpectedFiles,
      valid,
      warnings: validation.issues.filter((issue) => issue.severity === "warning"),
      ...(drift === null ? {} : { drift })
    });
    process.exitCode = valid ? 0 : 1;
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

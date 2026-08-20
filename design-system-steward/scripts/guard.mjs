import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseArgs,
  printJson,
  reportError,
  requireDirectory,
  requireStringOption
} from "./lib.mjs";
import { runStyleDictionary } from "./build-tokens.mjs";
import { validateTokenDirectory } from "./tokens.mjs";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = await requireDirectory(requireStringOption(options, "project"), "--project");
  const tokensRoot = path.join(projectRoot, "design-system", "tokens");
  const validation = await validateTokenDirectory(tokensRoot);
  if (!validation.valid) {
    printJson({ ...validation, status: "invalid-tokens" });
    process.exitCode = 1;
    return;
  }

  const generatedFile = path.join(projectRoot, "design-system", "dist", "tokens.css");
  if (!existsSync(generatedFile)) {
    printJson({
      generatedFile,
      status: "missing-generated-output",
      valid: false
    });
    process.exitCode = 1;
    return;
  }

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "design-system-steward-"));
  try {
    runStyleDictionary(projectRoot, temporaryRoot);
    const expected = await readFile(generatedFile);
    const actual = await readFile(path.join(temporaryRoot, "tokens.css"));
    const current = expected.equals(actual);
    printJson({
      generatedFile,
      status: current ? "current" : "stale-generated-output",
      valid: current
    });
    process.exitCode = current ? 0 : 1;
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

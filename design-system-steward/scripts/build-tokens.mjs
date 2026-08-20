import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseArgs,
  printJson,
  reportError,
  requireAbsolutePath,
  requireDirectory,
  requireStringOption
} from "./lib.mjs";
import { validateTokenDirectory } from "./tokens.mjs";

export function styleDictionaryBinary(projectRoot) {
  const binaryName = process.platform === "win32" ? "style-dictionary.cmd" : "style-dictionary";
  const candidate = path.join(projectRoot, "node_modules", ".bin", binaryName);
  if (!existsSync(candidate)) {
    throw new Error(
      `Style Dictionary is not installed in ${projectRoot}. After confirmed Apply, add style-dictionary@5.5.2 with the project's package manager.`
    );
  }
  return candidate;
}

export function runStyleDictionary(projectRoot, outputRoot) {
  const config = path.join(projectRoot, "design-system", "style-dictionary.config.mjs");
  if (!existsSync(config)) {
    throw new Error(`Missing generated config: ${config}`);
  }

  const child = spawnSync(styleDictionaryBinary(projectRoot), ["build", "--config", config], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...(outputRoot ? { DS_OUTPUT_DIR: outputRoot } : {})
    }
  });
  if (child.error) {
    throw child.error;
  }
  if (child.stdout) {
    process.stdout.write(child.stdout);
  }
  if (child.stderr) {
    process.stderr.write(child.stderr);
  }
  if (child.status !== 0) {
    throw new Error(`Style Dictionary exited with status ${child.status}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = await requireDirectory(requireStringOption(options, "project"), "--project");
  const tokensRoot = path.join(projectRoot, "design-system", "tokens");
  const validation = await validateTokenDirectory(tokensRoot);
  if (!validation.valid) {
    printJson(validation);
    process.exitCode = 1;
    return;
  }

  const outputRoot = options.out ? requireAbsolutePath(options.out, "--out") : null;
  runStyleDictionary(projectRoot, outputRoot);
  const cssFile = path.join(outputRoot ?? path.join(projectRoot, "design-system", "dist"), "tokens.css");
  if (!existsSync(cssFile)) {
    throw new Error(`Style Dictionary completed without expected CSS output: ${cssFile}`);
  }

  printJson({
    cssFile,
    cssProfile: validation.cssProfile,
    tokenCount: validation.tokenCount,
    valid: true
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    reportError(error);
    process.exitCode = 2;
  });
}

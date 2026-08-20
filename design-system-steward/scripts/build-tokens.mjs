import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  fileExists,
  parseArgs,
  printJson,
  reportError,
  requireAbsolutePath,
  requireDirectory,
  requireStringOption
} from "./lib.mjs";
import {
  cssMediaQueryForTheme,
  cssSelectorForTheme,
  inspectDesignSystem,
  outputRelativePathForScope,
  tokenGlob
} from "./validate-system.mjs";

const STYLE_DICTIONARY_VERSION = "5.5.2";

export function styleDictionaryBinary(projectRoot) {
  const binaryName = process.platform === "win32" ? "style-dictionary.cmd" : "style-dictionary";
  const candidate = path.join(projectRoot, "node_modules", ".bin", binaryName);
  if (!existsSync(candidate)) {
    throw new Error(
      `Style Dictionary is not installed in ${projectRoot}. After confirmed Apply, add style-dictionary@${STYLE_DICTIONARY_VERSION} with the project's package manager.`
    );
  }
  return candidate;
}

async function assertStyleDictionaryVersion(projectRoot) {
  const packagePath = path.join(projectRoot, "node_modules", "style-dictionary", "package.json");
  if (!(await fileExists(packagePath))) {
    throw new Error(`Style Dictionary package metadata is missing: ${packagePath}`);
  }
  const installed = JSON.parse(await readFile(packagePath, "utf8")).version;
  if (installed !== STYLE_DICTIONARY_VERSION) {
    throw new Error(`Expected style-dictionary@${STYLE_DICTIONARY_VERSION}, found ${installed ?? "unknown"}`);
  }
}

function configEnvironment(outputRoot, target) {
  return {
    DS_OUTPUT_DIR: outputRoot,
    DS_SCOPE_DESTINATION: target.destination,
    DS_SCOPE_ID: target.id,
    DS_SCOPE_INCLUDE: JSON.stringify(target.include),
    DS_SCOPE_MEDIA: target.mediaQuery ?? "",
    DS_SCOPE_SELECTOR: target.selector,
    DS_SCOPE_SOURCE: JSON.stringify(target.source)
  };
}

/**
 * Invoke the generated config with a single Core or Scope build target. The
 * config uses include/source so Style Dictionary owns parsing and resolution;
 * its controlled formatter emits only current-source delta tokens.
 */
export async function runStyleDictionary(projectRoot, outputRoot, target = null, options = {}) {
  await assertStyleDictionaryVersion(projectRoot);
  const config = path.join(projectRoot, "design-system", "style-dictionary.config.mjs");
  if (!existsSync(config)) {
    throw new Error(`Missing generated config: ${config}`);
  }
  const output = path.resolve(outputRoot ?? path.join(projectRoot, "design-system", "dist"));
  const fallbackTarget = {
    destination: "tokens.css",
    id: "core",
    include: [],
    selector: ":root",
    source: [path.join(projectRoot, "design-system", "tokens", "**", "*.tokens.json")]
  };
  const buildTarget = target ?? fallbackTarget;
  const child = spawnSync(styleDictionaryBinary(projectRoot), ["build", "--config", config], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...configEnvironment(output, buildTarget)
    }
  });
  if (child.error) {
    throw child.error;
  }
  const transcript = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  if (child.status !== 0) {
    throw new Error(`Style Dictionary exited with status ${child.status}${transcript ? `:\n${transcript}` : ""}`);
  }
  if (/⚠|\bwarning\b/i.test(transcript)) {
    throw new Error(`Style Dictionary emitted a warning; refusing a non-deterministic build:\n${transcript}`);
  }
  if (options.quiet !== true && transcript) {
    process.stdout.write(transcript);
  }
  return {
    destination: path.join(output, buildTarget.destination),
    transcript
  };
}

async function clearGeneratedScopeCss(outputRoot) {
  const scopesOutput = path.join(outputRoot, "scopes");
  if (!(await fileExists(scopesOutput))) {
    return;
  }
  for (const entry of await readdir(scopesOutput, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".css")) {
      await rm(path.join(scopesOutput, entry.name), { force: true });
    }
  }
}

async function writeIndex(outputRoot, relativeFiles) {
  const contents = [];
  for (const relativeFile of relativeFiles) {
    contents.push(await readFile(path.join(outputRoot, relativeFile), "utf8"));
  }
  const index = `${contents.join("\n").replace(/\n*$/, "")}\n`;
  const destination = path.join(outputRoot, "index.css");
  await writeFile(destination, index, "utf8");
  return destination;
}

async function synchronizeGeneratedCss(stagingRoot, destinationRoot, relativeFiles) {
  await mkdir(destinationRoot, { recursive: true });
  await rm(path.join(destinationRoot, "tokens.css"), { force: true });
  await rm(path.join(destinationRoot, "index.css"), { force: true });
  await clearGeneratedScopeCss(destinationRoot);
  for (const relativeFile of relativeFiles) {
    const destination = path.join(destinationRoot, relativeFile);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(stagingRoot, relativeFile), destination);
  }
}

function scopeBuildTarget(system, scope) {
  const ancestors = scope.chain.slice(0, -1)
    .map((id) => system.scopesById.get(id))
    .filter(Boolean);
  const include = [tokenGlob(system.core.tokensRoot)];
  for (const ancestor of ancestors) {
    include.push(tokenGlob(ancestor.tokensRoot));
  }
  return {
    destination: outputRelativePathForScope(scope),
    id: scope.id,
    include,
    selector: scope.chain.map((id) => `[data-ds-scope~="${id}"]`).join(""),
    source: [tokenGlob(scope.tokensRoot)]
  };
}

function themeBuildTarget(system, theme) {
  return {
    destination: `themes/${theme.id}.css`,
    id: theme.id,
    include: [tokenGlob(system.core.tokensRoot)],
    mediaQuery: cssMediaQueryForTheme(theme, system.themeMap),
    selector: cssSelectorForTheme(theme, system.themeMap),
    source: [tokenGlob(theme.tokensRoot)]
  };
}

async function requireDeltaCapableConfig(projectRoot, runtimeScopes, runtimeThemes, themeMap) {
  if (runtimeScopes.length === 0 && runtimeThemes.length === 0) {
    return;
  }
  const config = path.join(projectRoot, "design-system", "style-dictionary.config.mjs");
  const contents = await readFile(config, "utf8");
  if (!contents.includes("design-system-steward/scope-delta")) {
    throw new Error(
      "The generated Style Dictionary config predates Scope support. Recreate only design-system/style-dictionary.config.mjs from design-system-steward v0.2 before building Scope CSS."
    );
  }
  if (runtimeThemes.length > 0 && themeMap?.activation?.kind === "media" && !contents.includes("DS_SCOPE_MEDIA")) {
    throw new Error(
      "The generated Style Dictionary config predates Theme media support. Recreate only design-system/style-dictionary.config.mjs from design-system-steward v0.3 before building media Theme CSS."
    );
  }
}

/** Build Core, active Themes, then active Scopes in deterministic order. */
export async function buildDesignSystem(projectRoot, outputRoot = null, options = {}) {
  const inspected = await inspectDesignSystem(projectRoot);
  if (!inspected.result.valid) {
    return { ...inspected.result, status: "invalid-system" };
  }
  const system = inspected.internal;
  const destinationRoot = path.resolve(outputRoot ?? path.join(system.systemRoot, "dist"));
  const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "design-system-steward-build-"));

  try {
    const runtimeScopes = system.scopesInOrder.filter((scope) => (
      scope.status === "active" && scope.localTokens.size > 0
    ));
    const runtimeThemes = system.themesInOrder.filter((theme) => (
      theme.status === "active" && theme.localTokens.size > 0
    ));
    await requireDeltaCapableConfig(projectRoot, runtimeScopes, runtimeThemes, system.themeMap);

    const generated = [];
    const coreTarget = {
      destination: "tokens.css",
      id: "core",
      include: [],
      selector: ":root",
      source: [tokenGlob(system.core.tokensRoot)]
    };
    await runStyleDictionary(projectRoot, stagingRoot, coreTarget, { quiet: options.quiet === true });
    const coreRelative = "tokens.css";
    const stagedCoreCss = path.join(stagingRoot, coreRelative);
    if (!(await fileExists(stagedCoreCss))) {
      throw new Error(`Style Dictionary completed without expected Core CSS output: ${stagedCoreCss}`);
    }
    generated.push(coreRelative);

    for (const theme of runtimeThemes) {
      const target = themeBuildTarget(system, theme);
      await runStyleDictionary(projectRoot, stagingRoot, target, { quiet: options.quiet === true });
      const cssFile = path.join(stagingRoot, target.destination);
      if (!(await fileExists(cssFile))) {
        throw new Error(`Style Dictionary completed without expected Theme CSS output: ${cssFile}`);
      }
      generated.push(target.destination);
    }
    for (const scope of runtimeScopes) {
      const target = scopeBuildTarget(system, scope);
      await runStyleDictionary(projectRoot, stagingRoot, target, { quiet: options.quiet === true });
      const cssFile = path.join(stagingRoot, target.destination);
      if (!(await fileExists(cssFile))) {
        throw new Error(`Style Dictionary completed without expected Scope CSS output: ${cssFile}`);
      }
      generated.push(target.destination);
    }
    await writeIndex(stagingRoot, generated);
    generated.push("index.css");
    await synchronizeGeneratedCss(stagingRoot, destinationRoot, generated);

    return {
      cssFile: path.join(destinationRoot, coreRelative),
      cssFiles: generated.map((relativeFile) => path.join(destinationRoot, relativeFile)),
      cssProfile: inspected.result.cssProfile,
      indexFile: path.join(destinationRoot, "index.css"),
      scopes: system.scopesInOrder.map((scope) => ({
        cssFile: runtimeScopes.includes(scope) ? path.join(destinationRoot, outputRelativePathForScope(scope)) : null,
        id: scope.id,
        reason: scope.status === "reference-only"
          ? "reference-only"
          : scope.localTokens.size === 0 ? "empty" : null,
        selector: scope.chain.map((id) => `[data-ds-scope~="${id}"]`).join("")
      })),
      themes: system.themesInOrder.map((theme) => ({
        cssFile: runtimeThemes.includes(theme) ? path.join(destinationRoot, `themes/${theme.id}.css`) : null,
        id: theme.id,
        mediaQuery: cssMediaQueryForTheme(theme, system.themeMap),
        reason: theme.status === "reference-only"
          ? "reference-only"
          : theme.localTokens.size === 0 ? "empty" : null,
        runtimeOwner: theme.runtimeOwner,
        selector: cssSelectorForTheme(theme, system.themeMap),
        source: theme.source,
        status: theme.status
      })),
      tokenCount: inspected.result.core.tokenCount,
      valid: true
    };
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = await requireDirectory(requireStringOption(options, "project"), "--project");
  const outputRoot = options.out ? requireAbsolutePath(options.out, "--out") : null;
  const result = await buildDesignSystem(projectRoot, outputRoot, { quiet: true });
  printJson(result);
  process.exitCode = result.valid ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    reportError(error);
    process.exitCode = 2;
  });
}

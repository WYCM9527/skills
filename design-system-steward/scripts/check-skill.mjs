import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  fileExists,
  printJson,
  reportError,
  skillRoot,
  walkFiles
} from "./lib.mjs";

async function main() {
  const required = [
    "SKILL.md",
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    "assets/scaffold/style-dictionary.config.mjs"
  ];
  const packagePath = path.join(skillRoot, "package.json");
  const adaptersRoot = path.join(skillRoot, "adapters");
  const codexPolicyPath = path.join(skillRoot, "agents", "openai.yaml");
  const hasPackage = await fileExists(packagePath);
  const hasAdapters = await fileExists(adaptersRoot);
  const hasCodexPolicy = await fileExists(codexPolicyPath);
  if (hasPackage) {
    required.push("package.json", "agents/openai.yaml", "adapters/claude.frontmatter.yaml", "adapters/cursor.frontmatter.yaml");
  }
  const missing = [];
  for (const relative of required) {
    if (!(await fileExists(path.join(skillRoot, relative)))) {
      missing.push(relative);
    }
  }

  const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
  const packageJson = hasPackage ? JSON.parse(await readFile(packagePath, "utf8")) : null;
  const skillVersion = skill.match(/^\s{2}version:\s*["']([^"']+)["']\s*$/m)?.[1] ?? null;
  const adapterSkills = hasAdapters
    ? (await walkFiles(adaptersRoot, { ignoredDirectories: new Set() }))
      .filter((file) => path.basename(file) === "SKILL.md")
    : [];
  const hostExplicitOnly = skill.includes("disable-model-invocation: true")
    && (!hasCodexPolicy || (await readFile(codexPolicyPath, "utf8")).includes("allow_implicit_invocation: false"));
  const frontmatterIsHostCompatible = skill.includes("disable-model-invocation: true");
  const checks = {
    adapterSkillDuplicates: adapterSkills.length === 0,
    explicitOnly: hostExplicitOnly,
    portableFrontmatter: /^---\nname: design-system-steward\n[\s\S]*?---\n/.test(skill)
      && frontmatterIsHostCompatible,
    versionMatches: !packageJson || packageJson.version === skillVersion
  };
  const valid = missing.length === 0 && Object.values(checks).every(Boolean);
  printJson({ checks, missing, valid });
  process.exitCode = valid ? 0 : 1;
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

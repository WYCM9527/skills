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
    "package.json",
    "agents/openai.yaml",
    "adapters/claude.frontmatter.yaml",
    "adapters/cursor.frontmatter.yaml",
    "assets/scaffold/style-dictionary.config.mjs"
  ];
  const missing = [];
  for (const relative of required) {
    if (!(await fileExists(path.join(skillRoot, relative)))) {
      missing.push(relative);
    }
  }

  const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
  const packageJson = JSON.parse(await readFile(path.join(skillRoot, "package.json"), "utf8"));
  const adapterSkills = (await walkFiles(path.join(skillRoot, "adapters"), { ignoredDirectories: new Set() }))
    .filter((file) => path.basename(file) === "SKILL.md");
  const checks = {
    adapterSkillDuplicates: adapterSkills.length === 0,
    explicitOnlyCodex: (await readFile(path.join(skillRoot, "agents", "openai.yaml"), "utf8")).includes("allow_implicit_invocation: false"),
    portableFrontmatter: /^---\nname: design-system-steward\n[\s\S]*?---\n/.test(skill)
      && !skill.includes("disable-model-invocation:"),
    versionMatches: packageJson.version === "0.1.0"
  };
  const valid = missing.length === 0 && Object.values(checks).every(Boolean);
  printJson({ checks, missing, valid });
  process.exitCode = valid ? 0 : 1;
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

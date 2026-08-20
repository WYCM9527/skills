import { cp, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  parseArgs,
  printJson,
  reportError,
  requireAbsolutePath,
  requireStringOption,
  skillRoot
} from "./lib.mjs";

const HOSTS = new Set(["codex", "claude", "cursor"]);
const CORE_ENTRIES = ["SKILL.md", "README.md", "CHANGELOG.md", "LICENSE", "references", "scripts", "assets"];

async function destinationDoesNotExist(destination) {
  try {
    await lstat(destination);
    return false;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return true;
    }
    throw error;
  }
}

async function patchExplicitOnlyFrontmatter(skillFile) {
  const source = await readFile(skillFile, "utf8");
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    throw new Error("Core SKILL.md does not have YAML frontmatter");
  }
  const frontmatter = match[1].includes("disable-model-invocation:")
    ? match[1]
    : `${match[1]}\ndisable-model-invocation: true`;
  await writeFile(skillFile, source.replace(match[0], `---\n${frontmatter}\n---\n`), "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const host = requireStringOption(options, "host");
  if (!HOSTS.has(host)) {
    throw new Error(`--host must be one of: ${[...HOSTS].join(", ")}`);
  }
  const destination = requireAbsolutePath(requireStringOption(options, "out"), "--out");
  if (!(await destinationDoesNotExist(destination))) {
    throw new Error(`Refusing to overwrite existing install destination: ${destination}`);
  }

  await mkdir(destination, { recursive: true });
  for (const entry of CORE_ENTRIES) {
    await cp(path.join(skillRoot, entry), path.join(destination, entry), { recursive: true });
  }

  if (host === "codex") {
    await mkdir(path.join(destination, "agents"), { recursive: true });
    await cp(path.join(skillRoot, "agents", "openai.yaml"), path.join(destination, "agents", "openai.yaml"));
  } else {
    await patchExplicitOnlyFrontmatter(path.join(destination, "SKILL.md"));
  }

  printJson({
    destination,
    explicitOnly: true,
    host,
    skill: "design-system-steward"
  });
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

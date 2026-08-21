import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..");

function run(script, argumentsList) {
  return spawnSync(process.execPath, [path.join(skillRoot, "scripts", script), ...argumentsList], {
    encoding: "utf8"
  });
}

function jsonOutput(result) {
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout);
}

function jsonFailure(result) {
  assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout);
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function createProject() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "design-system-steward-v04-"));
  await writeFile(path.join(projectRoot, "package.json"), '{"name":"v04-fixture","private":true}\n');
  return projectRoot;
}

async function createStyleDictionaryLinks(projectRoot) {
  const sourceNodeModules = path.join(skillRoot, "node_modules");
  assert.equal(existsSync(path.join(sourceNodeModules, "style-dictionary")), true, "run npm install before the test suite");
  await mkdir(path.join(projectRoot, "node_modules", ".bin"), { recursive: true });
  await symlink(
    path.join(sourceNodeModules, "style-dictionary"),
    path.join(projectRoot, "node_modules", "style-dictionary"),
    "dir"
  );
  await symlink(
    path.join(sourceNodeModules, ".bin", "style-dictionary"),
    path.join(projectRoot, "node_modules", ".bin", "style-dictionary")
  );
}

test("audit does not promote global stylesheets, page literals, or highlight/darken filenames", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  await mkdir(path.join(projectRoot, "src", "pages", "home"), { recursive: true });
  await mkdir(path.join(projectRoot, "src", "pages", "showcase"), { recursive: true });
  await mkdir(path.join(projectRoot, "src", "styles"), { recursive: true });
  await mkdir(path.join(projectRoot, "src", "utils"), { recursive: true });
  await writeFile(path.join(projectRoot, "src", "styles", "main.css"), `
    :root { --color-primary: #2563eb; --space-md: 16px; }
    .button { background: #2563eb; padding: 16px; border-radius: 8px; }
  `);
  await writeFile(path.join(projectRoot, "src", "pages", "home", "index.tsx"), `
    export default function Home() {
      return <h1 style={{ color: "#2563eb", fontSize: "32px" }}>Welcome</h1>;
    }
  `);
  await writeFile(path.join(projectRoot, "src", "pages", "showcase", "showcase.css"), `
    .showcase { --showcase-accent: #7c3aed; --showcase-radius: 16px; }
    .case-card { border-radius: 16px; color: #7c3aed; padding: 24px; }
  `);
  await writeFile(path.join(projectRoot, "src", "pages", "showcase", "page.tsx"), `import "./showcase.css";\nexport default function Showcase() { return <section className="showcase" />; }\n`);
  await writeFile(path.join(projectRoot, "src", "utils", "highlight.css"), ".hl { color: red; }\n");
  await writeFile(path.join(projectRoot, "src", "utils", "darken.css"), ".dk { opacity: .5; }\n");

  const report = jsonOutput(run("audit.mjs", ["--project", projectRoot]));
  assert.equal(report.scopeCandidates.some((candidate) => candidate.id === "main"), false);
  assert.equal(report.scopeCandidates.some((candidate) => candidate.id === "home"), false);
  assert.equal(report.scopeCandidates.some((candidate) => candidate.id === "showcase"), true);
  assert.equal(report.themeEvidence.includes("src/utils/highlight.css"), false);
  assert.equal(report.themeEvidence.includes("src/utils/darken.css"), false);
});

test("an empty bootstrap is empty-scaffold, not a broken system", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  jsonOutput(run("bootstrap.mjs", ["--project", projectRoot, "--source", "css-variables"]));

  const validation = jsonFailure(run("validate-system.mjs", ["--project", projectRoot]));
  assert.equal(validation.status, "empty-scaffold");
  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.code === "empty-scaffold"), true);
  assert.equal(validation.issues.some((issue) => issue.code === "no-tokens"), false);
  assert.equal(validation.issues[0].message.includes("刚初始化，待填入已确认的 token"), true);

  const guarded = jsonFailure(run("guard.mjs", ["--project", projectRoot]));
  assert.equal(guarded.status, "empty-scaffold");
});

test("structured colors accept a matching hex and reject a mismatched hex", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  jsonOutput(run("bootstrap.mjs", ["--project", projectRoot, "--source", "css-variables"]));
  await writeJson(path.join(projectRoot, "design-system", "tokens", "primitives.tokens.json"), {
    color: {
      blue: {
        "600": {
          $type: "color",
          $value: {
            alpha: 1,
            colorSpace: "srgb",
            components: [0.145, 0.388, 0.922],
            hex: "#2563EB"
          }
        }
      }
    }
  });
  await writeJson(path.join(projectRoot, "design-system", "tokens", "semantic.tokens.json"), {
    color: {
      action: {
        primary: {
          $type: "color",
          $value: "{color.blue.600}"
        }
      }
    }
  });
  await createStyleDictionaryLinks(projectRoot);

  const build = jsonOutput(run("build-tokens.mjs", ["--project", projectRoot]));
  assert.equal(build.valid, true);
  const css = await readFile(path.join(projectRoot, "design-system", "dist", "tokens.css"), "utf8");
  assert.equal(css.includes("--color-blue-600: #2563EB;"), true);

  await writeJson(path.join(projectRoot, "design-system", "tokens", "primitives.tokens.json"), {
    color: {
      blue: {
        "600": {
          $type: "color",
          $value: {
            alpha: 1,
            colorSpace: "srgb",
            components: [0.145, 0.388, 0.922],
            hex: "#ff0000"
          }
        }
      }
    }
  });
  const mismatch = jsonFailure(run("validate-system.mjs", ["--project", projectRoot]));
  assert.equal(mismatch.issues.some((issue) => issue.code === "color-hex-mismatch"), true);
  assert.equal(mismatch.issues.find((issue) => issue.code === "color-hex-mismatch").message.includes("hex 色值"), true);
});

test("scope integration preview lists global stylesheet entry candidates", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  await mkdir(path.join(projectRoot, "src", "showcase"), { recursive: true });
  await mkdir(path.join(projectRoot, "src", "styles"), { recursive: true });
  await writeFile(path.join(projectRoot, "src", "main.tsx"), "import \"./styles/main.css\";\n");
  await writeFile(path.join(projectRoot, "src", "styles", "main.css"), ":root { color: black; }\n");
  await writeFile(path.join(projectRoot, "src", "showcase", "page.tsx"), "export default function Showcase() { return <main />; }\n");
  jsonOutput(run("bootstrap.mjs", ["--project", projectRoot, "--source", "css-variables"]));
  jsonOutput(run("scaffold-scope.mjs", [
    "--project", projectRoot,
    "--scope", "showcase",
    "--kind", "section",
    "--parent", "core",
    "--reason", "Showcase has a confirmed local surface.",
    "--source-globs", "src/showcase/**"
  ]));

  const plan = jsonOutput(run("plan-integration.mjs", ["--project", projectRoot, "--scope", "showcase"]));
  assert.equal(plan.globalStyleEntryCandidates.some((entry) => entry.relative === "src/main.tsx"), true);
  assert.equal(plan.globalStyleEntryCandidates.some((entry) => entry.relative === "src/styles/main.css"), true);
  assert.equal(plan.minimalChangePreview.cssImport.globalAlternatives.some((entry) => entry.relative === "src/main.tsx"), true);
});

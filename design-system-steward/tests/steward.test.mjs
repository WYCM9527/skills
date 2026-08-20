import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..");
const fixtureRoot = path.join(testDirectory, "fixtures");

function run(script, argumentsList) {
  return spawnSync(process.execPath, [path.join(skillRoot, "scripts", script), ...argumentsList], {
    encoding: "utf8"
  });
}

function jsonOutput(result) {
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout);
}

async function copiedFixture(name) {
  const destination = await mkdtemp(path.join(os.tmpdir(), "design-system-steward-fixture-"));
  await cp(path.join(fixtureRoot, name), destination, { recursive: true });
  return destination;
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

function approvedTokenFiles() {
  return {
    primitives: {
      color: {
        blue: {
          "500": {
            "$type": "color",
            "$value": {
              colorSpace: "srgb",
              components: [0.145, 0.388, 0.922],
              alpha: 1
            }
          }
        },
        white: {
          "$type": "color",
          "$value": {
            colorSpace: "srgb",
            components: [1, 1, 1],
            alpha: 1
          }
        }
      },
      space: {
        "4": {
          "$type": "dimension",
          "$value": {
            value: 16,
            unit: "px"
          }
        }
      }
    },
    semantic: {
      color: {
        action: {
          primary: {
            "$type": "color",
            "$value": "{color.blue.500}"
          },
          "on-primary": {
            "$type": "color",
            "$value": "{color.white}"
          }
        }
      },
      space: {
        layout: {
          "$type": "dimension",
          "$value": "{space.4}"
        }
      }
    }
  };
}

test("audit is read-only, reports CSS evidence, and keeps JSON stable", async (context) => {
  const projectRoot = await copiedFixture("bare-css");
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  const before = await readFile(path.join(projectRoot, "src", "app.css"), "utf8");

  const report = jsonOutput(run("audit.mjs", ["--project", projectRoot]));

  assert.equal(report.status, "ready-to-propose");
  assert.equal(report.writes, false);
  assert.equal(report.sourceCandidates[0].id, "css-variables");
  assert.deepEqual(report.repeatedStaticValues.colors, [{ count: 2, value: "#2563eb" }]);
  assert.equal(await readFile(path.join(projectRoot, "src", "app.css"), "utf8"), before);
  assert.equal(existsSync(path.join(projectRoot, "design-system")), false);
});

test("audit surfaces source conflicts and does not resolve them", async (context) => {
  const projectRoot = await copiedFixture("source-conflict");
  context.after(() => rm(projectRoot, { force: true, recursive: true }));

  const report = jsonOutput(run("audit.mjs", ["--project", projectRoot]));

  assert.equal(report.status, "needs-decision");
  assert.equal(report.requiresSourceChoice, true);
  assert.deepEqual(report.sourceCandidates.map((candidate) => candidate.id), ["dtcg-json", "css-variables"]);
});

test("audit keeps non-standard tokens and legacy design documents as evidence", async (context) => {
  const projectRoot = await copiedFixture("legacy-nonstandard");
  context.after(() => rm(projectRoot, { force: true, recursive: true }));

  const report = jsonOutput(run("audit.mjs", ["--project", projectRoot]));

  assert.deepEqual(report.designDocs, ["DESIGN.md"]);
  assert.deepEqual(report.sourceCandidates.map((candidate) => candidate.id), ["legacy-token-json"]);
  assert.equal(report.status, "ready-to-propose");
});

test("audit respects a monorepo package boundary", async (context) => {
  const repository = await copiedFixture("monorepo");
  context.after(() => rm(repository, { force: true, recursive: true }));

  const report = jsonOutput(run("audit.mjs", ["--project", path.join(repository, "packages", "app")]));

  assert.equal(JSON.stringify(report).includes("sibling-secret"), false);
  assert.equal(JSON.stringify(report).includes("packages/sibling"), false);
  assert.equal(report.filesScanned, 1);
});

test("audit records themes, component exceptions, agent rules, and visual evidence", async (context) => {
  const themeRoot = await copiedFixture("light-dark");
  const componentRoot = await copiedFixture("component-exception");
  const rulesRoot = await copiedFixture("agent-rule-conflict");
  const visualRoot = await copiedFixture("visual-evidence");
  context.after(async () => {
    await Promise.all([themeRoot, componentRoot, rulesRoot, visualRoot].map((directory) => rm(directory, { force: true, recursive: true })));
  });

  const theme = jsonOutput(run("audit.mjs", ["--project", themeRoot]));
  const component = jsonOutput(run("audit.mjs", ["--project", componentRoot]));
  const rules = jsonOutput(run("audit.mjs", ["--project", rulesRoot]));
  const visual = jsonOutput(run("audit.mjs", ["--project", visualRoot]));

  assert.equal(theme.themeEvidence.includes("src/theme.css"), true);
  assert.equal(component.componentExceptionEvidence.includes("src/button.css"), true);
  assert.deepEqual(rules.agentRules, [".claude/rules/design.md", ".cursor/rules/design.md", "AGENTS.md"]);
  assert.deepEqual(visual.imageEvidence, ["reference-export.svg"]);
});

test("confirmed scaffold leaves UI source untouched and creates optional layers only when requested", async (context) => {
  const projectRoot = await copiedFixture("bare-css");
  const auditPath = path.join(os.tmpdir(), `design-system-steward-audit-${Date.now()}.json`);
  context.after(async () => {
    await rm(projectRoot, { force: true, recursive: true });
    await rm(auditPath, { force: true });
  });
  const sourceBefore = await readFile(path.join(projectRoot, "src", "Component.tsx"), "utf8");

  const audit = run("audit.mjs", ["--project", projectRoot, "--out", auditPath]);
  assert.equal(audit.status, 0, audit.stderr);
  const scaffold = jsonOutput(run("bootstrap.mjs", [
    "--project", projectRoot,
    "--source", "css-variables",
    "--audit-report", auditPath
  ]));

  assert.equal(scaffold.uiSourceChanged, false);
  assert.equal(existsSync(path.join(projectRoot, "design-system", "tokens", "components.tokens.json")), false);
  assert.equal(existsSync(path.join(projectRoot, "design-system", "themes")), false);
  assert.equal(await readFile(path.join(projectRoot, "src", "Component.tsx"), "utf8"), sourceBefore);
  assert.equal(run("bootstrap.mjs", ["--project", projectRoot, "--source", "css-variables"]).status, 2);
});

test("validator catches alias cycles and build plus guard detect generated-output drift", async (context) => {
  const invalidRoot = await copiedFixture("invalid-alias-cycle");
  const projectRoot = await copiedFixture("bare-css");
  context.after(async () => {
    await Promise.all([invalidRoot, projectRoot].map((directory) => rm(directory, { force: true, recursive: true })));
  });

  const invalid = run("validate-tokens.mjs", ["--tokens", invalidRoot]);
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout.includes("alias-cycle"), true);

  assert.equal(run("bootstrap.mjs", ["--project", projectRoot, "--source", "css-variables"]).status, 0);
  const tokens = approvedTokenFiles();
  await writeFile(
    path.join(projectRoot, "design-system", "tokens", "primitives.tokens.json"),
    `${JSON.stringify(tokens.primitives, null, 2)}\n`
  );
  await writeFile(
    path.join(projectRoot, "design-system", "tokens", "semantic.tokens.json"),
    `${JSON.stringify(tokens.semantic, null, 2)}\n`
  );
  await createStyleDictionaryLinks(projectRoot);

  assert.equal(run("validate-tokens.mjs", ["--tokens", path.join(projectRoot, "design-system", "tokens")]).status, 0);
  const build = run("build-tokens.mjs", ["--project", projectRoot]);
  assert.equal(build.status, 0, `${build.stderr}\n${build.stdout}`);
  const outputFile = path.join(projectRoot, "design-system", "dist", "tokens.css");
  const output = await readFile(outputFile, "utf8");
  assert.equal(output.includes("--color-action-primary: var(--color-blue-500);"), true);
  assert.equal(run("build-tokens.mjs", ["--project", projectRoot]).status, 0);
  assert.deepEqual(await readFile(outputFile), Buffer.from(output));
  assert.equal(run("guard.mjs", ["--project", projectRoot]).status, 0);

  await writeFile(outputFile, `${output}\n/* deliberately stale fixture */\n`);
  const stale = run("guard.mjs", ["--project", projectRoot]);
  assert.equal(stale.status, 1);
  assert.equal(stale.stdout.includes("stale-generated-output"), true);
});

test("the forward audit-to-apply-to-experiment fixture never rewrites UI source", async (context) => {
  const projectRoot = await copiedFixture("bare-css");
  const reportPath = path.join(os.tmpdir(), `design-system-steward-forward-${Date.now()}.json`);
  context.after(async () => {
    await rm(projectRoot, { force: true, recursive: true });
    await rm(reportPath, { force: true });
  });
  const before = await readFile(path.join(projectRoot, "src", "Component.tsx"), "utf8");

  const audit = run("audit.mjs", ["--project", projectRoot, "--out", reportPath]);
  const report = jsonOutput(audit);
  assert.equal(report.status, "ready-to-propose");
  assert.equal(report.sourceCandidates[0].id, "css-variables");
  assert.equal(run("bootstrap.mjs", [
    "--project", projectRoot,
    "--source", "css-variables",
    "--audit-report", reportPath
  ]).status, 0);

  const experimentGuide = await readFile(path.join(projectRoot, "design-system", "TRY.md"), "utf8");
  assert.equal(experimentGuide.includes("不修改生产页面"), true);
  assert.equal(await readFile(path.join(projectRoot, "src", "Component.tsx"), "utf8"), before);
});

test("installer materializes one explicit-only skill for each supported host", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "design-system-steward-install-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const codex = path.join(root, "codex");
  const claude = path.join(root, "claude");
  const cursor = path.join(root, "cursor");

  for (const [host, destination] of [["codex", codex], ["claude", claude], ["cursor", cursor]]) {
    const result = run("render-install.mjs", ["--host", host, "--out", destination]);
    assert.equal(result.status, 0, `${host}: ${result.stderr}`);
  }

  const codexSkill = await readFile(path.join(codex, "SKILL.md"), "utf8");
  const claudeSkill = await readFile(path.join(claude, "SKILL.md"), "utf8");
  const cursorSkill = await readFile(path.join(cursor, "SKILL.md"), "utf8");
  assert.equal(codexSkill.includes("disable-model-invocation:"), false);
  assert.equal(claudeSkill.includes("disable-model-invocation: true"), true);
  assert.equal(cursorSkill.includes("disable-model-invocation: true"), true);
  assert.equal(existsSync(path.join(codex, "agents", "openai.yaml")), true);
  assert.equal(existsSync(path.join(cursor, "adapters")), false);
  assert.equal(existsSync(path.join(cursor, "package.json")), false);
});

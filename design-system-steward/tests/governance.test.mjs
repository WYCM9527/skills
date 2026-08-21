import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
  const destination = await mkdtemp(path.join(os.tmpdir(), "design-system-steward-governance-"));
  await cp(path.join(fixtureRoot, name), destination, { recursive: true });
  return destination;
}

async function createManagedSystem(projectRoot) {
  const systemRoot = path.join(projectRoot, "design-system");
  await mkdir(path.join(systemRoot, "tokens"), { recursive: true });
  await writeFile(path.join(systemRoot, "DESIGN.md"), "# Design System\n");
  await writeFile(path.join(systemRoot, "tokens", "primitives.tokens.json"), "{}\n");
  await writeFile(path.join(systemRoot, "tokens", "semantic.tokens.json"), "{}\n");
  await writeFile(path.join(systemRoot, "scope-map.json"), `${JSON.stringify({
    version: 1,
    scopes: [{
      id: "showcase",
      kind: "section",
      parent: "core",
      reason: "Showcase uses a confirmed local visual vocabulary.",
      status: "active",
      appliesTo: { sourceGlobs: ["src/showcase/**"] }
    }]
  }, null, 2)}\n`);
  await writeFile(path.join(systemRoot, "theme-map.json"), `${JSON.stringify({
    version: 1,
    defaultTheme: "light",
    activation: { kind: "data-attribute", attribute: "data-theme" },
    themes: [{ id: "dark", reason: "Existing dark mode.", status: "active" }]
  }, null, 2)}\n`);
}

test("plan-change classifies content, consumption, proposals, and literal Drift candidates without writing", async (context) => {
  const projectRoot = await copiedFixture("governance-project");
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  await createManagedSystem(projectRoot);
  const legacy = path.join(projectRoot, "src", "showcase", "legacy.tsx");
  const before = await readFile(legacy, "utf8");

  const content = jsonOutput(run("plan-change.mjs", [
    "--project", projectRoot,
    "--target", "docs/content.md",
    "--request", "更新欢迎文案"
  ]));
  assert.equal(content.classification, "content");

  const consume = jsonOutput(run("plan-change.mjs", [
    "--project", projectRoot,
    "--target", "src/core/Card.tsx"
  ]));
  assert.equal(consume.classification, "consume");
  assert.equal(consume.context.scope.resolved.id, "core");

  const scopedTheme = jsonOutput(run("plan-change.mjs", [
    "--project", projectRoot,
    "--target", "src/showcase/page.tsx"
  ]));
  assert.equal(scopedTheme.classification, "consume");
  assert.equal(scopedTheme.context.scope.resolved.id, "showcase");
  assert.equal(scopedTheme.context.theme.resolved.id, "dark");

  const explicitReuse = jsonOutput(run("plan-change.mjs", [
    "--project", projectRoot,
    "--target", "src/core/Card.tsx",
    "--request", "保持现有模式，复用已管理的变量"
  ]));
  assert.equal(explicitReuse.classification, "consume");

  const existingThemeAndToken = jsonOutput(run("plan-change.mjs", [
    "--project", projectRoot,
    "--target", "src/showcase/page.tsx",
    "--request", "使用现有 dark Theme 与 Token 完成这个页面"
  ]));
  assert.equal(existingThemeAndToken.classification, "consume");

  const drift = jsonOutput(run("plan-change.mjs", [
    "--project", projectRoot,
    "--target", "src/showcase/legacy.tsx"
  ]));
  assert.equal(drift.classification, "drift");
  assert.deepEqual(drift.evidence.candidateVisualLiterals.colors, ["#c00000"]);
  assert.deepEqual(drift.evidence.candidateVisualLiterals.spacing, ["18px"]);
  assert.deepEqual(drift.evidence.candidateVisualLiterals.typography, ["13px"]);
  assert.equal(drift.evidenceLimit.includes("不会推断 Token 的语义"), true);

  const sectionCopy = jsonOutput(run("plan-change.mjs", [
    "--project", projectRoot,
    "--target", "src/showcase/legacy.tsx",
    "--request", "这个页面加个介绍板块"
  ]));
  assert.equal(sectionCopy.classification, "content");

  const beautify = jsonOutput(run("plan-change.mjs", [
    "--project", projectRoot,
    "--target", "src/showcase/page.tsx",
    "--request", "帮我把页面弄好看一点"
  ]));
  assert.equal(beautify.classification, "needs-proposal");
  assert.equal(beautify.reasons.includes("美化类请求通常引入新视觉决定"), true);

  const proposal = jsonOutput(run("plan-change.mjs", [
    "--project", projectRoot,
    "--target", "src/core/Card.tsx",
    "--request", "新增可跨页面复用的强调色 Token"
  ]));
  assert.equal(proposal.classification, "needs-proposal");
  assert.equal(proposal.reasons.includes("请求明确涉及可复用或系统级设计决定"), true);

  await writeFile(path.join(projectRoot, "design-system", "theme-map.json"), `${JSON.stringify({
    version: 1,
    defaultTheme: "light",
    activation: { kind: "data-attribute", attribute: "data-theme" },
    themes: [{ id: "dark", reason: "Existing dark mode.", status: "reference-only" }]
  }, null, 2)}\n`);
  const referenceOnlyTheme = jsonOutput(run("plan-change.mjs", [
    "--project", projectRoot,
    "--target", "src/showcase/page.tsx"
  ]));
  assert.equal(referenceOnlyTheme.classification, "needs-proposal");
  assert.equal(referenceOnlyTheme.reasons.includes("Theme dark is reference-only"), true);
  assert.equal(await readFile(legacy, "utf8"), before);
});

test("plan-change rejects unsafe targets and does not invent an unregistered Scope", async (context) => {
  const projectRoot = await copiedFixture("governance-project");
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  const contentWithoutSystem = jsonOutput(run("plan-change.mjs", [
    "--project", projectRoot,
    "--target", "docs/content.md",
    "--request", "更新欢迎文案"
  ]));
  assert.equal(contentWithoutSystem.classification, "content");
  await createManagedSystem(projectRoot);

  const unregistered = jsonOutput(run("plan-change.mjs", [
    "--project", projectRoot,
    "--target", "src/core/Card.tsx",
    "--scope", "unknown"
  ]));
  assert.equal(unregistered.classification, "needs-proposal");
  assert.equal(unregistered.reasons.includes("Scope is not registered: unknown"), true);

  const outside = path.join(path.dirname(projectRoot), "outside-governance-target.css");
  await writeFile(outside, ".outside { color: #000; }\n");
  context.after(() => rm(outside, { force: true }));
  const unsafe = run("plan-change.mjs", ["--project", projectRoot, "--target", outside]);
  assert.equal(unsafe.status, 2);
  assert.equal(unsafe.stderr.includes("within the supplied project root"), true);

  const externalDirectory = await mkdtemp(path.join(os.tmpdir(), "design-system-steward-external-"));
  context.after(() => rm(externalDirectory, { force: true, recursive: true }));
  await writeFile(path.join(externalDirectory, "escape.css"), ".escape { color: #000; }\n");
  await symlink(externalDirectory, path.join(projectRoot, "src", "linked"));
  const throughLink = run("plan-change.mjs", ["--project", projectRoot, "--target", "src/linked/escape.css"]);
  assert.equal(throughLink.status, 2);
  assert.equal(throughLink.stderr.includes("must not traverse a symbolic link"), true);
});

test("check-drift inspects only named UI-style files and returns review candidates with exit zero", async (context) => {
  const projectRoot = await copiedFixture("governance-project");
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  const argumentsList = [
    "--project", projectRoot,
    "--changed", "docs/content.md,src/core/Card.tsx,src/showcase/legacy.tsx"
  ];

  const first = jsonOutput(run("check-drift.mjs", argumentsList));
  const second = jsonOutput(run("check-drift.mjs", argumentsList));
  assert.deepEqual(second, first);
  assert.equal(first.status, "needs-steward-review");
  assert.deepEqual(first.candidateFiles, ["src/showcase/legacy.tsx"]);
  assert.deepEqual(first.skippedFiles, [{ file: "docs/content.md", reason: "not-ui-style-file" }]);
  const legacy = first.scannedFiles.find((file) => file.file === "src/showcase/legacy.tsx");
  assert.deepEqual(legacy.candidates.colors, ["#c00000"]);
  assert.deepEqual(legacy.candidates.scopeMarkers, ["showcase"]);
  assert.deepEqual(legacy.candidates.themeMarkers, ["dark"]);
});

test("plan-agent-rule proposes exactly one short rule and never writes a project rule file", async (context) => {
  const projectRoot = await copiedFixture("governance-project");
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  const agentsPath = path.join(projectRoot, "AGENTS.md");
  const before = await readFile(agentsPath, "utf8");

  const plan = jsonOutput(run("plan-agent-rule.mjs", ["--project", projectRoot]));
  assert.equal(plan.status, "needs-user-target-choice");
  assert.equal(plan.targetChoice.recommendedTarget, "AGENTS.md");
  assert.equal(plan.targetChoice.requiresExplicitUserApproval, true);
  assert.equal(plan.proposedRule.length, 3);
  assert.equal(await readFile(agentsPath, "utf8"), before);

  const noRuleRoot = await mkdtemp(path.join(os.tmpdir(), "design-system-steward-no-rule-"));
  context.after(() => rm(noRuleRoot, { force: true, recursive: true }));
  const noRule = jsonOutput(run("plan-agent-rule.mjs", ["--project", noRuleRoot]));
  assert.equal(noRule.status, "no-existing-rule-file");
  assert.equal(noRule.targetChoice.recommendedTarget, null);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findStaleExemptions, loadExemptions } from "../scripts/exemptions.mjs";

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

async function writeJsonFile(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function createProject() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "design-system-steward-v05-"));
  await writeFile(path.join(projectRoot, "package.json"), '{"name":"v05-fixture","private":true}\n');
  return projectRoot;
}

async function writeCoreTokens(projectRoot) {
  await writeJsonFile(path.join(projectRoot, "design-system", "tokens", "primitives.tokens.json"), {
    color: {
      blue: {
        "600": {
          $type: "color",
          $value: { alpha: 1, colorSpace: "srgb", components: [0.145, 0.388, 0.922], hex: "#2563EB" }
        }
      },
      purple: {
        "500": {
          $type: "color",
          $value: { alpha: 1, colorSpace: "srgb", components: [0.486, 0.227, 0.929], hex: "#7C3AED" }
        }
      }
    },
    spacing: {
      "400": { $type: "dimension", $value: { unit: "px", value: 16 } }
    }
  });
  await writeJsonFile(path.join(projectRoot, "design-system", "tokens", "semantic.tokens.json"), {
    color: {
      action: {
        primary: { $type: "color", $value: "{color.blue.600}" }
      }
    },
    space: {
      md: { $type: "dimension", $value: "{spacing.400}" }
    }
  });
}

test("migrate adopt bridges legacy definitions semantic-first and stays idempotent", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  await writeCoreTokens(projectRoot);
  await mkdir(path.join(projectRoot, "src", "styles"), { recursive: true });
  await writeFile(path.join(projectRoot, "src", "styles", "legacy.css"), [
    ":root {",
    "  --brand: #2563eb;",
    "  --brand-rgb: rgb(37, 99, 235);",
    "  --mystery: #123456;",
    "  --bridged: var(--color-action-primary);",
    "}",
    ".btn { background: #2563eb; }",
    ""
  ].join("\n"));

  const plan = jsonOutput(run("migrate.mjs", ["--project", projectRoot, "--phase", "adopt"]));
  assert.equal(plan.status, "ready-to-apply");
  assert.equal(plan.writes, false);
  const edits = plan.changes.find((change) => change.file === "src/styles/legacy.css").edits;
  const brand = edits.find((edit) => edit.name === "--brand");
  assert.equal(brand.token, "color.action.primary");
  assert.equal(brand.replacement, "var(--color-action-primary)");
  const brandRgb = edits.find((edit) => edit.name === "--brand-rgb");
  assert.equal(brandRgb.token, "color.action.primary");
  assert.equal(plan.pending.some((item) => item.kind === "unmatched-definition" && item.name === "--mystery"), true);
  assert.equal(edits.some((edit) => edit.name === "--bridged"), false);

  const applied = jsonOutput(run("migrate.mjs", ["--project", projectRoot, "--phase", "adopt", "--apply", "--force"]));
  assert.equal(applied.status, "applied");
  assert.equal(applied.migrationReport, "design-system/MIGRATION.md");
  const css = await readFile(path.join(projectRoot, "src", "styles", "legacy.css"), "utf8");
  assert.equal(css.includes("--brand: var(--color-action-primary);"), true);
  assert.equal(css.includes("--brand-rgb: var(--color-action-primary);"), true);
  assert.equal(css.includes("--mystery: #123456;"), true);
  const report = await readFile(path.join(projectRoot, "design-system", "MIGRATION.md"), "utf8");
  assert.equal(report.includes("git revert"), true);
  assert.equal(report.includes("guard.mjs"), true);

  const again = jsonOutput(run("migrate.mjs", ["--project", projectRoot, "--phase", "adopt"]));
  assert.equal(again.status, "nothing-to-migrate");
  assert.equal(again.summary.editCount, 0);
});

test("migrate replace rewrites stylesheets and tailwind arbitrary values, keeps js and primitive-only literals pending", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  await writeCoreTokens(projectRoot);
  await mkdir(path.join(projectRoot, "src", "pages", "home"), { recursive: true });
  await writeFile(path.join(projectRoot, "src", "pages", "home", "page.css"), [
    ".hero { color: #2563eb; padding: 16px; margin: 0px; }",
    ".accent { color: #7c3aed; }",
    ""
  ].join("\n"));
  await writeFile(path.join(projectRoot, "src", "pages", "home", "Home.tsx"), [
    "export default function Home() {",
    "  return (",
    "    <div className=\"bg-[#2563eb] p-[16px]\" style={{ color: \"#2563eb\" }}>",
    "      hi",
    "    </div>",
    "  );",
    "}",
    ""
  ].join("\n"));

  const plan = jsonOutput(run("migrate.mjs", ["--project", projectRoot, "--phase", "replace"]));
  const cssEdits = plan.changes.find((change) => change.file === "src/pages/home/page.css").edits;
  assert.equal(cssEdits.some((edit) => edit.oldValue === "#2563eb" && edit.token === "color.action.primary"), true);
  assert.equal(cssEdits.some((edit) => edit.oldValue === "16px" && edit.token === "space.md"), true);
  assert.equal(cssEdits.some((edit) => edit.oldValue === "0px"), false);
  assert.equal(plan.pending.some((item) => item.kind === "primitive-only" && item.value === "#7c3aed"), true);
  const tsxEdits = plan.changes.find((change) => change.file === "src/pages/home/Home.tsx").edits;
  assert.equal(tsxEdits.some((edit) => edit.replacement === "bg-[var(--color-action-primary)]"), true);
  assert.equal(tsxEdits.some((edit) => edit.replacement === "p-[var(--space-md)]"), true);
  assert.equal(plan.pending.some((item) => item.kind === "js-literal" && item.suggestedToken === "color.action.primary"), true);

  jsonOutput(run("migrate.mjs", ["--project", projectRoot, "--phase", "replace", "--apply", "--force"]));
  const css = await readFile(path.join(projectRoot, "src", "pages", "home", "page.css"), "utf8");
  assert.equal(css.includes("color: var(--color-action-primary);"), true);
  assert.equal(css.includes("padding: var(--space-md);"), true);
  assert.equal(css.includes("margin: 0px;"), true);
  assert.equal(css.includes("color: #7c3aed;"), true);
  const tsx = await readFile(path.join(projectRoot, "src", "pages", "home", "Home.tsx"), "utf8");
  assert.equal(tsx.includes("bg-[var(--color-action-primary)]"), true);
  assert.equal(tsx.includes("color: \"#2563eb\""), true);
});

test("exemptions silence audit, drift review, and migrate; stale entries are detected", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  await writeCoreTokens(projectRoot);
  await mkdir(path.join(projectRoot, "src", "vendor"), { recursive: true });
  await writeFile(path.join(projectRoot, "src", "vendor", "lib.css"), ".v { color: #111111; padding: 3px; }\n.v2 { color: #111111; }\n");
  await writeFile(path.join(projectRoot, "src", "promo.css"), ".p { color: #ff00ff; background: #ff00ff; border-color: #2563eb; }\n");
  await writeJsonFile(path.join(projectRoot, "design-system", "exemptions.json"), {
    exemptions: [
      { path: "src/vendor/**", reason: "第三方库样式，随依赖升级" },
      { path: "src/promo.css", reason: "活动专用色，随活动整体下线", value: "#ff00ff" },
      { path: "src/deleted.css", reason: "已下线的页面" }
    ]
  });

  const audit = jsonOutput(run("audit.mjs", ["--project", projectRoot]));
  assert.equal(audit.exemptions.entryCount, 3);
  assert.equal(audit.exemptedFiles.includes("src/vendor/lib.css"), true);
  assert.equal(audit.repeatedStaticValues.colors.some((entry) => entry.value === "#ff00ff"), false);
  assert.equal(audit.repeatedStaticValues.colors.some((entry) => entry.value === "#111111"), false);

  const drift = jsonOutput(run("check-drift.mjs", [
    "--project", projectRoot,
    "--changed", "src/vendor/lib.css,src/promo.css"
  ]));
  assert.equal(drift.skippedFiles.some((entry) => entry.file === "src/vendor/lib.css" && entry.reason === "exempted-by-registry"), true);
  const promo = drift.scannedFiles.find((entry) => entry.file === "src/promo.css");
  assert.equal(promo.candidates.colors.includes("#ff00ff"), false);
  assert.equal(promo.candidates.colors.includes("#2563eb"), true);

  const plan = jsonOutput(run("migrate.mjs", ["--project", projectRoot, "--phase", "replace"]));
  assert.equal(plan.exemptedFiles.includes("src/vendor/lib.css"), true);
  const promoEdits = plan.changes.find((change) => change.file === "src/promo.css").edits;
  assert.equal(promoEdits.some((edit) => edit.oldValue === "#2563eb"), true);
  assert.equal(promoEdits.some((edit) => edit.oldValue === "#ff00ff"), false);
  assert.equal(plan.pending.some((item) => item.value === "#ff00ff"), false);

  const loaded = await loadExemptions(projectRoot);
  assert.equal(loaded.issues.length, 0);
  const stale = findStaleExemptions(loaded.entries, projectRoot);
  assert.deepEqual(stale.map((entry) => entry.path), ["src/deleted.css"]);

  await writeJsonFile(path.join(projectRoot, "design-system", "exemptions.json"), {
    exemptions: [{ path: "src/promo.css" }]
  });
  const invalid = await loadExemptions(projectRoot);
  assert.equal(invalid.issues.some((issue) => issue.code === "missing-exemption-reason"), true);
  assert.equal(invalid.issues[0].message.includes("必须写明理由"), true);
});

test("migrate refuses unsafe writes and settle records confirmed exemptions", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  await writeCoreTokens(projectRoot);
  await mkdir(path.join(projectRoot, "src"), { recursive: true });
  await writeFile(path.join(projectRoot, "src", "app.css"), ".a { color: #2563eb; outline-color: #123456; }\n");

  const refused = run("migrate.mjs", ["--project", projectRoot, "--phase", "replace", "--apply"]);
  assert.equal(refused.status, 2);
  assert.equal(refused.stderr.includes("--force"), true);
  const untouched = await readFile(path.join(projectRoot, "src", "app.css"), "utf8");
  assert.equal(untouched.includes("#2563eb"), true);

  const settle = jsonOutput(run("migrate.mjs", ["--project", projectRoot, "--phase", "settle"]));
  assert.equal(settle.status, "needs-decisions");
  assert.equal(settle.decisions.some((group) => group.kind === "unmanaged-literal"), true);
  assert.equal(settle.remainingReplacements.editCount > 0, true);

  const answersFile = path.join(projectRoot, "answers.json");
  await writeJsonFile(answersFile, {
    exemptions: [{ path: "src/app.css", reason: "试验页面，保持原样", value: "#123456" }]
  });
  const applied = jsonOutput(run("migrate.mjs", [
    "--project", projectRoot,
    "--phase", "settle",
    "--apply",
    "--exemptions-file", answersFile,
    "--force"
  ]));
  assert.equal(applied.applied.total, 1);
  assert.equal(existsSync(path.join(projectRoot, "design-system", "exemptions.json")), true);

  const replan = jsonOutput(run("migrate.mjs", ["--project", projectRoot, "--phase", "replace"]));
  assert.equal(replan.pending.some((item) => item.value === "#123456"), false);

  const badAnswers = path.join(projectRoot, "bad-answers.json");
  await writeJsonFile(badAnswers, { exemptions: [{ path: "src/app.css" }] });
  const rejected = run("migrate.mjs", [
    "--project", projectRoot,
    "--phase", "settle",
    "--apply",
    "--exemptions-file", badAnswers,
    "--force"
  ]);
  assert.equal(rejected.status, 2);
  assert.equal(rejected.stderr.includes("reason"), true);
});

test("status reports progress, adoption, and the next step", async (context) => {
  const emptyRoot = await createProject();
  context.after(() => rm(emptyRoot, { force: true, recursive: true }));
  const empty = jsonOutput(run("status.mjs", ["--project", emptyRoot]));
  assert.equal(empty.status, "not-initialized");
  assert.equal(empty.suggestions[0].includes("setup"), true);

  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  await writeCoreTokens(projectRoot);
  await mkdir(path.join(projectRoot, "src"), { recursive: true });
  await writeFile(path.join(projectRoot, "src", "page.css"), ".x { color: #2563eb; gap: var(--space-md); }\n");

  const before = jsonOutput(run("status.mjs", ["--project", projectRoot]));
  assert.equal(before.status, "in-progress");
  assert.equal(before.migration.replaceable, 1);
  assert.equal(before.suggestions.some((entry) => entry.includes("migrate --phase replace")), true);
  assert.equal(before.adoption.percent, 50);

  jsonOutput(run("migrate.mjs", ["--project", projectRoot, "--phase", "replace", "--apply", "--force"]));
  const after = jsonOutput(run("status.mjs", ["--project", projectRoot]));
  assert.equal(after.status, "unified");
  assert.equal(after.adoption.percent, 100);
  assert.equal(after.suggestions[0].includes("change"), true);
});

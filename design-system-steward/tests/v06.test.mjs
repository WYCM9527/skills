import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { blankComments } from "../scripts/lib.mjs";
import { chooseTokenForValue, propertyCategory, propertyForTailwindPrefix } from "../scripts/migrate.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..");

function run(script, argumentsList) {
  return spawnSync(process.execPath, [path.join(skillRoot, "scripts", script), ...argumentsList], { encoding: "utf8" });
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
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "design-system-steward-v06-"));
  await writeFile(path.join(projectRoot, "package.json"), '{"name":"v06-fixture","private":true}\n');
  spawnSync("git", ["init", "-q"], { cwd: projectRoot });
  spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "add", "-A"], { cwd: projectRoot });
  spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: projectRoot });
  return projectRoot;
}

/** 14px 同时是正文字号、小图标尺寸与单元格纵向内边距；16px 是间距与中图标；#111827 是主文字色与选中底。 */
async function writeCoreTokens(projectRoot) {
  await writeJsonFile(path.join(projectRoot, "design-system", "tokens", "primitives.tokens.json"), {
    color: {
      gray: { "900": { $type: "color", $value: { alpha: 1, colorSpace: "srgb", components: [0.0667, 0.0941, 0.1529], hex: "#111827" } } }
    },
    size: { "14": { $type: "dimension", $value: { unit: "px", value: 14 } }, "16": { $type: "dimension", $value: { unit: "px", value: 16 } } }
  });
  await writeJsonFile(path.join(projectRoot, "design-system", "tokens", "semantic.tokens.json"), {
    color: {
      text: { primary: { $type: "color", $value: "{color.gray.900}" } },
      action: { selected: { $type: "color", $value: "{color.gray.900}" } }
    },
    text: { body: { size: { $type: "dimension", $value: "{size.14}" } } },
    icon: { size: { sm: { $type: "dimension", $value: "{size.14}" }, md: { $type: "dimension", $value: "{size.16}" } } },
    table: { cell: { "padding-y": { $type: "dimension", $value: "{size.14}" } } },
    space: { md: { $type: "dimension", $value: "{size.16}" } }
  });
}

test("blankComments removes CSS / JS / HTML comment bodies without moving offsets", () => {
  const css = "a { color: red; /* 12px 示意 */ }\nb { width: 1px; }";
  const blanked = blankComments(css, ".css");
  assert.equal(blanked.length, css.length);
  assert.equal(blanked.includes("12px"), false);
  assert.equal(blanked.indexOf("width"), css.indexOf("width"));
  const js = "const url = 'http://x/y'; // #fff fallback\nconst c = `//not a comment ${a}`; /* 8px */ const w = 4;";
  const blankedJs = blankComments(js, ".ts");
  assert.equal(blankedJs.includes("#fff"), false);
  assert.equal(blankedJs.includes("8px"), false);
  assert.equal(blankedJs.includes("http://x/y"), true);
  assert.equal(blankedJs.includes("//not a comment"), true);
  const vue = "<template><!-- 24px --><div class=\"p-[16px]\" /></template>";
  assert.equal(blankComments(vue, ".vue").includes("24px"), false);
  assert.equal(blankComments(vue, ".vue").includes("p-[16px]"), true);
});

test("property category narrows candidates before deciding ambiguity", () => {
  const entries = [
    { cssVariable: "icon-size-sm", layer: "semantic", path: "icon.size.sm", type: "dimension" },
    { cssVariable: "table-cell-padding-y", layer: "semantic", path: "table.cell.padding-y", type: "dimension" },
    { cssVariable: "text-body-size", layer: "semantic", path: "text.body.size", type: "dimension" }
  ];
  assert.equal(propertyCategory("padding-top"), "spacing");
  assert.equal(propertyCategory("font-size"), "font-size");
  assert.equal(propertyCategory("transform"), null);
  const padding = chooseTokenForValue(entries, "padding");
  assert.equal(padding.match?.path, "table.cell.padding-y");
  assert.equal(padding.matchedBy, "property");
  const fontSize = chooseTokenForValue(entries, "font-size");
  assert.equal(fontSize.pending, "ambiguous-semantic");
  assert.deepEqual(fontSize.options.map((entry) => entry.path), ["icon.size.sm", "text.body.size"]);
  assert.equal(fontSize.narrowedBy, "font-size");
  assert.equal(fontSize.allOptions, 3);
  const unknown = chooseTokenForValue(entries, "transform");
  assert.equal(unknown.pending, "ambiguous-semantic");
  assert.equal(unknown.options.length, 3);
  assert.equal(propertyForTailwindPrefix("p", "dimension"), "padding");
  assert.equal(propertyForTailwindPrefix("text", "color"), "color");
  assert.equal(propertyForTailwindPrefix("text", "dimension"), "font-size");
  assert.equal(propertyForTailwindPrefix("rounded-tl", "dimension"), "border-radius");
  assert.equal(propertyForTailwindPrefix("border", "color"), "border-color");
});

test("migrate replace uses the CSS property, ignores comments, and settle --apply lands merge decisions", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  await writeCoreTokens(projectRoot);
  await mkdir(path.join(projectRoot, "src"), { recursive: true });
  await writeFile(path.join(projectRoot, "src", "app.css"), [
    "/* 老规范示意：14px 正文、#111827 近黑 */",
    ".cell { padding: 14px 20px; }",
    ".label { font-size: 14px; }",
    ".title { color: #111827; }",
    ".chip { background: #111827; }",
    ".note { width: 14px; }",
    ""
  ].join("\n"));
  await writeFile(path.join(projectRoot, "src", "Page.tsx"), [
    "// #111827 fallback in a comment",
    "export const Page = () => <div className=\"p-[16px] text-[16px]\" />;",
    ""
  ].join("\n"));
  spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "add", "-A"], { cwd: projectRoot });
  spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "fixture"], { cwd: projectRoot });

  const plan = jsonOutput(run("migrate.mjs", ["--project", projectRoot, "--phase", "replace"]));
  const cssEdits = plan.changes.find((change) => change.file === "src/app.css")?.edits ?? [];
  // padding 只能是单元格内边距；color 只能是文字色；background 只能是选中底；width 只能是图标尺寸
  assert.deepEqual(
    cssEdits.map((edit) => [edit.property, edit.token, edit.matchedBy]),
    [["color", "color.text.primary", "property"], ["background", "color.action.selected", "property"], ["padding", "table.cell.padding-y", "property"], ["width", "icon.size.sm", "property"]]
  );
  const fontSize = plan.pending.find((item) => item.property === "font-size" && item.value === "14px");
  assert.equal(fontSize.kind, "ambiguous-semantic");
  assert.deepEqual(fontSize.options, ["icon.size.sm", "text.body.size"]);
  assert.equal(fontSize.narrowedBy, "font-size");
  // 注释里的 14px / #111827 没有被算进任何清单
  assert.equal(plan.pending.some((item) => item.line === 1), false);
  assert.equal(plan.pending.some((item) => item.kind === "js-literal"), false);
  // Tailwind：p-[16px] 是间距，text-[16px] 是字号（只有 icon.size.md 命中 → 唯一）
  const tsxEdits = plan.changes.find((change) => change.file === "src/Page.tsx")?.edits ?? [];
  assert.deepEqual(tsxEdits.map((edit) => edit.replacement), ["p-[var(--space-md)]", "text-[var(--icon-size-md)]"]);

  // settle 只读：带 decisions 文件会给出 merge 预览但不写
  const decisionsFile = path.join(projectRoot, "decisions.json");
  await writeJsonFile(decisionsFile, {
    merges: [{ property: "font-size", token: "text.body.size", value: "14px" }],
    exemptions: [{ path: "src/app.css", reason: "20px 是这一处的排版留白，不纳管", value: "20px" }]
  });
  const preview = jsonOutput(run("migrate.mjs", ["--project", projectRoot, "--phase", "settle", "--decisions-file", decisionsFile]));
  assert.equal(preview.writes, false);
  assert.equal(preview.mergePlan.summary.editCount, 1);
  assert.equal(preview.mergePlan.changes[0].edits[0].kind, "merge");
  const before = await readFile(path.join(projectRoot, "src", "app.css"), "utf8");
  assert.equal(before.includes("font-size: 14px"), true);

  // settle --apply：改写 font-size 那一处，登记豁免，生成 MIGRATION.md
  const applied = jsonOutput(run("migrate.mjs", ["--project", projectRoot, "--phase", "settle", "--apply", "--decisions-file", decisionsFile, "--allow-dirty"]));
  assert.equal(applied.writes, true);
  assert.equal(applied.applied.merges.editCount, 1);
  assert.equal(applied.applied.exemptions.added, 1);
  assert.equal(applied.migrationReport, "design-system/MIGRATION.md");
  const after = await readFile(path.join(projectRoot, "src", "app.css"), "utf8");
  assert.equal(after.includes("font-size: var(--text-body-size)"), true);
  assert.equal(after.includes("padding: 14px 20px"), true);   // merge 只动 font-size 那一处
  assert.equal(existsSync(path.join(projectRoot, "design-system", "MIGRATION.md")), true);
  assert.equal(applied.decisions.some((group) => group.items.some((item) => item.property === "font-size" && item.value === "14px")), false);

  // 未知 Token 的 merge 在写入前被拒绝
  await writeJsonFile(decisionsFile, { merges: [{ token: "text.nope", value: "14px" }] });
  const rejected = run("migrate.mjs", ["--project", projectRoot, "--phase", "settle", "--apply", "--decisions-file", decisionsFile, "--allow-dirty"]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr + rejected.stdout, /unknown token/);
});

test("guard and status each state what they check and what they leave to the other", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  assert.equal(run("bootstrap.mjs", ["--project", projectRoot, "--source", "css-variables"]).status, 0);   // 脚手架带 style-dictionary 配置
  await writeCoreTokens(projectRoot);
  const sourceNodeModules = path.join(skillRoot, "node_modules");
  assert.equal(existsSync(path.join(sourceNodeModules, "style-dictionary")), true, "run npm install before the test suite");
  await mkdir(path.join(projectRoot, "node_modules", ".bin"), { recursive: true });
  await symlink(path.join(sourceNodeModules, "style-dictionary"), path.join(projectRoot, "node_modules", "style-dictionary"), "dir");
  await symlink(path.join(sourceNodeModules, ".bin", "style-dictionary"), path.join(projectRoot, "node_modules", ".bin", "style-dictionary"));
  jsonOutput(run("build-tokens.mjs", ["--project", projectRoot]));

  const status = jsonOutput(run("status.mjs", ["--project", projectRoot]));
  assert.match(status.notCovered, /guard/);
  assert.match(status.checks, /var\(--/);
  const guard = jsonOutput(run("guard.mjs", ["--project", projectRoot]));
  assert.equal(guard.status, "current");
  assert.match(guard.notCovered, /status/);
  assert.match(guard.checks, /dist/);
});

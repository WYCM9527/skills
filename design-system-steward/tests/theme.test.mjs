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
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "design-system-steward-theme-"));
  await writeFile(path.join(projectRoot, "package.json"), '{"name":"theme-fixture","private":true}\n');
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

async function bootstrap(projectRoot) {
  assert.equal(run("bootstrap.mjs", ["--project", projectRoot, "--source", "css-variables"]).status, 0);
}

async function writeCoreTokens(projectRoot) {
  const tokensRoot = path.join(projectRoot, "design-system", "tokens");
  await writeJson(path.join(tokensRoot, "primitives.tokens.json"), {
    color: {
      $type: "color",
      black: { $value: { alpha: 1, colorSpace: "srgb", components: [0.04, 0.04, 0.04] } },
      white: { $value: { alpha: 1, colorSpace: "srgb", components: [1, 1, 1] } }
    }
  });
  await writeJson(path.join(tokensRoot, "semantic.tokens.json"), {
    color: {
      $type: "color",
      surface: { default: { $value: "{color.white}" } },
      text: { primary: { $value: "{color.black}" } }
    }
  });
}

test("retired bootstrap theme flag never creates an unmanaged themes directory", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));

  const result = jsonOutput(run("bootstrap.mjs", [
    "--project", projectRoot,
    "--source", "css-variables",
    "--with-themes"
  ]));

  assert.equal(existsSync(path.join(projectRoot, "design-system", "themes")), false);
  assert.equal(result.deprecatedOptions.length, 1);
});

test("a Core-only v0.2 project preserves an existing unmanaged themes folder", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  await bootstrap(projectRoot);
  await writeCoreTokens(projectRoot);
  const legacyCss = path.join(projectRoot, "design-system", "dist", "themes", "legacy.css");
  await mkdir(path.dirname(legacyCss), { recursive: true });
  await writeFile(legacyCss, "/* existing legacy output; not managed by theme-map.json */\n");
  await createStyleDictionaryLinks(projectRoot);

  jsonOutput(run("build-tokens.mjs", ["--project", projectRoot]));
  assert.equal(await readFile(legacyCss, "utf8"), "/* existing legacy output; not managed by theme-map.json */\n");
});

test("audit records safe theme activation evidence as a reference-only candidate", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  const source = path.join(projectRoot, "src", "theme.css");
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, ':root { --surface: #fff; } [data-theme="dark"] { --surface: #111; }\n');
  const before = await readFile(source, "utf8");

  const report = jsonOutput(run("audit.mjs", ["--project", projectRoot]));

  assert.equal(report.writes, false);
  assert.equal(await readFile(source, "utf8"), before);
  assert.deepEqual(report.themeActivationEvidence, [{
    attribute: "data-theme",
    file: "src/theme.css",
    kind: "data-attribute",
    modes: ["dark"]
  }]);
  assert.deepEqual(report.themeCandidates[0].activation, { attribute: "data-theme", kind: "data-attribute" });
  assert.equal(report.themeCandidates[0].status, "reference-only");
});

test("managed Theme builds a delta, guard detects drift, and planning never rewrites UI", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  const entry = path.join(projectRoot, "src", "main.tsx");
  await mkdir(path.dirname(entry), { recursive: true });
  await writeFile(entry, "document.documentElement.setAttribute(\"data-theme\", \"dark\");\nexport function Root() { return <main />; }\n");
  const before = await readFile(entry, "utf8");

  await bootstrap(projectRoot);
  await writeCoreTokens(projectRoot);
  const scaffold = jsonOutput(run("scaffold-theme.mjs", [
    "--project", projectRoot,
    "--theme", "dark",
    "--default-theme", "light",
    "--activation", "data-attribute",
    "--attribute", "data-theme",
    "--reason", "The existing product has a confirmed dark reading mode.",
    "--source", "Existing visual specification approved by the project owner.",
    "--runtime-owner", "The application root data-theme attribute."
  ]));
  assert.equal(scaffold.uiSourceChanged, false);
  assert.equal(await readFile(entry, "utf8"), before);
  const themeDocument = await readFile(path.join(projectRoot, "design-system", "themes", "dark", "THEME.md"), "utf8");
  assert.equal(themeDocument.includes("{{"), false);
  await writeJson(path.join(projectRoot, "design-system", "themes", "dark", "tokens", "semantic.tokens.json"), {
    color: {
      $type: "color",
      surface: { default: { $value: "{color.black}" } },
      text: { primary: { $value: "{color.white}" } }
    }
  });
  await createStyleDictionaryLinks(projectRoot);

  const validation = jsonOutput(run("validate-system.mjs", ["--project", projectRoot]));
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.themeMap.activation, { attribute: "data-theme", kind: "data-attribute" });
  assert.equal(validation.themeMap.defaultTheme, "light");
  assert.equal(validation.themes[0].selector, ':root[data-theme="dark"]');

  const build = jsonOutput(run("build-tokens.mjs", ["--project", projectRoot]));
  assert.equal(build.valid, true);
  const dist = path.join(projectRoot, "design-system", "dist");
  const [themeCss, indexCss] = await Promise.all([
    readFile(path.join(dist, "themes", "dark.css"), "utf8"),
    readFile(path.join(dist, "index.css"), "utf8")
  ]);
  assert.equal(themeCss.includes(':root[data-theme="dark"]'), true);
  assert.equal(themeCss.includes("--color-surface-default: var(--color-black);"), true);
  assert.equal(/\n\s*--color-white:/.test(themeCss), false);
  assert.equal(indexCss.includes(themeCss.trim()), true);
  assert.equal(run("guard.mjs", ["--project", projectRoot]).status, 0);

  const driftCandidate = path.join(projectRoot, "src", "theme-candidate.css");
  await writeFile(driftCandidate, ".candidate { color: #123456; }\n");
  const guardedChange = jsonOutput(run("guard.mjs", [
    "--project", projectRoot,
    "--changed", "src/theme-candidate.css"
  ]));
  assert.equal(guardedChange.valid, true);
  assert.equal(guardedChange.status, "current-with-drift-candidates");
  assert.deepEqual(guardedChange.drift.candidateFiles, ["src/theme-candidate.css"]);

  const plan = jsonOutput(run("plan-theme-integration.mjs", ["--project", projectRoot, "--theme", "dark", "--entry", entry]));
  assert.equal(plan.writes, false);
  assert.equal(plan.uiSourceChanged, false);
  assert.equal(plan.status, "ready-for-second-confirmation");
  assert.equal(plan.minimalChangePreview.themeActivation.preview, '<html data-theme="dark">…</html>');
  assert.equal(plan.minimalChangePreview.themeActivation.detectedStaticActivation, true);
  assert.equal(plan.minimalChangePreview.themeActivation.needed, false);
  assert.equal(await readFile(entry, "utf8"), before);

  await writeFile(path.join(dist, "themes", "dark.css"), `${themeCss}\n/* stale */\n`);
  const stale = jsonFailure(run("guard.mjs", ["--project", projectRoot]));
  assert.deepEqual(stale.staleFiles, ["themes/dark.css"]);
});

test("media activation is generated only through the controlled prefers-color-scheme wrapper", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  await bootstrap(projectRoot);
  await writeCoreTokens(projectRoot);
  jsonOutput(run("scaffold-theme.mjs", [
    "--project", projectRoot,
    "--theme", "dark",
    "--default-theme", "light",
    "--activation", "media",
    "--reason", "Use the browser preference for the confirmed dark mode.",
    "--source", "Approved dark mode palette.",
    "--runtime-owner", "Browser prefers-color-scheme."
  ]));
  await writeJson(path.join(projectRoot, "design-system", "themes", "dark", "tokens", "semantic.tokens.json"), {
    color: {
      $type: "color",
      surface: { default: { $value: "{color.black}" } }
    }
  });
  await createStyleDictionaryLinks(projectRoot);

  jsonOutput(run("build-tokens.mjs", ["--project", projectRoot]));
  const css = await readFile(path.join(projectRoot, "design-system", "dist", "themes", "dark.css"), "utf8");
  assert.match(css, /^@media \(prefers-color-scheme: dark\) \{\n  :root \{/);
});

test("a Scope semantic delta with managed Themes is reported as a non-blocking decision", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  const page = path.join(projectRoot, "src", "showcase", "page.tsx");
  await mkdir(path.dirname(page), { recursive: true });
  await writeFile(page, "export function Showcase() { return <main />; }\n");
  await bootstrap(projectRoot);
  await writeCoreTokens(projectRoot);
  jsonOutput(run("scaffold-scope.mjs", [
    "--project", projectRoot,
    "--scope", "showcase",
    "--kind", "section",
    "--parent", "core",
    "--reason", "Showcase has a confirmed local surface treatment.",
    "--source-globs", "src/showcase/**"
  ]));
  jsonOutput(run("scaffold-theme.mjs", [
    "--project", projectRoot,
    "--theme", "dark",
    "--default-theme", "light",
    "--activation", "data-attribute",
    "--attribute", "data-theme",
    "--reason", "Confirmed dark mode.",
    "--source", "Approved dark mode palette.",
    "--runtime-owner", "Application root."
  ]));
  await writeJson(path.join(projectRoot, "design-system", "scopes", "showcase", "tokens", "semantic.tokens.json"), {
    color: { $type: "color", surface: { default: { $value: "{color.black}" } } }
  });
  await writeJson(path.join(projectRoot, "design-system", "themes", "dark", "tokens", "semantic.tokens.json"), {
    color: { $type: "color", surface: { default: { $value: "{color.black}" } } }
  });

  const validation = jsonOutput(run("validate-system.mjs", ["--project", projectRoot]));
  const warning = validation.issues.find((issue) => issue.code === "scope-theme-delta-not-managed");
  assert.equal(validation.valid, true);
  assert.equal(warning.severity, "warning");
});

test("validator rejects missing maps, unsafe activation, and Theme primitive deltas", async (context) => {
  const missingMapRoot = await createProject();
  const invalidRoot = await createProject();
  const referenceOnlyRoot = await createProject();
  context.after(async () => {
    await Promise.all([missingMapRoot, invalidRoot, referenceOnlyRoot].map((root) => rm(root, { force: true, recursive: true })));
  });

  await bootstrap(missingMapRoot);
  await writeCoreTokens(missingMapRoot);
  await mkdir(path.join(missingMapRoot, "design-system", "themes", "dark", "tokens"), { recursive: true });
  const missing = jsonFailure(run("validate-system.mjs", ["--project", missingMapRoot]));
  assert.equal(missing.issues.some((issue) => issue.code === "missing-theme-map"), true);

  await bootstrap(invalidRoot);
  await writeCoreTokens(invalidRoot);
  await mkdir(path.join(invalidRoot, "design-system", "themes", "dark", "tokens"), { recursive: true });
  await writeJson(path.join(invalidRoot, "design-system", "theme-map.json"), {
    activation: { kind: "selector", selector: ".anything" },
    defaultTheme: "light",
    themes: [{
      id: "dark",
      reason: "Unsafe fixture.",
      runtimeOwner: "Fixture root.",
      source: "Fixture."
    }],
    version: 1
  });
  const unsafe = jsonFailure(run("validate-system.mjs", ["--project", invalidRoot]));
  assert.equal(unsafe.issues.some((issue) => issue.code === "invalid-theme-activation"), true);

  await writeJson(path.join(invalidRoot, "design-system", "theme-map.json"), {
    activation: { attribute: "data-theme", kind: "data-attribute" },
    defaultTheme: "light",
    themes: [{
      id: "dark",
      reason: "Primitive fixture.",
      runtimeOwner: "Fixture root.",
      source: "Fixture."
    }],
    version: 1
  });
  await writeJson(path.join(invalidRoot, "design-system", "themes", "dark", "tokens", "primitives.tokens.json"), {
    color: {
      $type: "color",
      blacker: { $value: { alpha: 1, colorSpace: "srgb", components: [0, 0, 0] } }
    }
  });
  const primitive = jsonFailure(run("validate-system.mjs", ["--project", invalidRoot]));
  assert.equal(primitive.issues.some((issue) => issue.code === "theme-primitive-not-allowed"), true);

  await bootstrap(referenceOnlyRoot);
  const referenceOnly = jsonOutput(run("scaffold-theme.mjs", [
    "--project", referenceOnlyRoot,
    "--theme", "dark",
    "--default-theme", "light",
    "--activation", "class",
    "--reason", "Legacy class evidence is kept for reference.",
    "--status", "reference-only"
  ]));
  assert.equal(referenceOnly.theme.status, "reference-only");
  const referenceMap = JSON.parse(await readFile(path.join(referenceOnlyRoot, "design-system", "theme-map.json"), "utf8"));
  assert.equal(referenceMap.themes[0].source, "未确认（仅作参考）");
  assert.equal(referenceMap.themes[0].runtimeOwner, "未确认（仅作参考）");
});

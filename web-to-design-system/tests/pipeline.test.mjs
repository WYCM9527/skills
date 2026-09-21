// node --test tests/pipeline.test.mjs：夹具证据 → 起草 → 脚手架（项目 / 种子）→ steward validate（有 steward 时）→ build + guard（有 style-dictionary 时）
// → 对比度报告 → 预览板 → adopter 识别（有 adopter 时）。夹具 acme-evidence.json 是对 tests/fixtures/acme.html 的真实取证结果。
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { locateSteward } from "../scripts/lib/steward.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(HERE, "..", "scripts");
const EVIDENCE = path.join(HERE, "fixtures", "acme-evidence.json");
const REPO_ROOT = path.resolve(HERE, "..", "..");
// adopter 住在 Design-System 仓库：skills 克隆放在那个仓库里时是上一级的兄弟目录，单独克隆 skills 时找不到就跳过对应用例
const ADOPTER = [path.join(REPO_ROOT, "design-system-adopter", "scripts", "ds.mjs"), path.join(REPO_ROOT, "..", "design-system-adopter", "scripts", "ds.mjs")].find((candidate) => existsSync(candidate)) ?? "";
const run = (script, args, options = {}) => execFileSync("node", [path.join(SCRIPTS, script), ...args], { encoding: "utf8", ...options });
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const flat = (tree, prefix = [], acc = {}) => {
  for (const [key, value] of Object.entries(tree)) {
    if (key.startsWith("$")) continue;
    if (value && typeof value === "object" && "$value" in value) acc[[...prefix, key].join(".")] = value;
    else if (value && typeof value === "object") flat(value, [...prefix, key], acc);
  }
  return acc;
};

const work = mkdtempSync(path.join(tmpdir(), "w2ds-test-"));
const draftDir = path.join(work, "draft");
const projectDir = path.join(work, "project");
const seedDir = path.join(work, "seed");
mkdirSync(projectDir, { recursive: true });
const steward = locateSteward(REPO_ROOT);
const stewardScripts = steward ? path.join(steward.dir, "scripts") : null;
const styleDictionary = steward ? path.join(steward.dir, "node_modules", "style-dictionary") : null;
const canBuild = Boolean(styleDictionary && existsSync(path.join(styleDictionary, "package.json")) && readJson(path.join(styleDictionary, "package.json")).version === "5.5.2");

test("起草：颜色分族分档、角色判定、Theme delta、摘要与备注", () => {
  const out = run("draft-tokens.mjs", ["--evidence", EVIDENCE, "--out", draftDir, "--id", "acme", "--name", "Acme 采购"]);
  assert.match(out, /草稿已写到/);
  const primitives = flat(readJson(path.join(draftDir, "tokens", "primitives.tokens.json")));
  const semantic = flat(readJson(path.join(draftDir, "tokens", "semantic.tokens.json")));
  const notes = readJson(path.join(draftDir, "draft-notes.json"));

  // Primitive：品牌族 = 蓝，状态浅底不落入 neutral，白单列
  assert.equal(primitives["color.brand.500"].$value.hex, "#2563EB");
  assert.equal(primitives["color.white"].$value.hex, "#FFFFFF");
  assert.ok(Object.keys(primitives).some((key) => key.startsWith("color.green.1")), "green-100 状态浅底应在 green 族");
  assert.ok(!Object.keys(primitives).some((key) => /^color\.neutral\.\d+$/.test(key) && primitives[key].$value.hex === "#DCFCE7"), "状态浅底不能混进 neutral");
  assert.equal(primitives["spacing.4"].$value.value, 16);
  assert.equal(primitives["spacing.2-5"].$value.value, 10);
  assert.equal(primitives["font.size.md"].$value.value, 14);
  assert.equal(primitives["radius.full"].$value.value, 999);
  assert.ok(primitives["shadow.blur.1"] && primitives["shadow.y.1"], "阴影拆成 y / blur");
  assert.ok(Object.keys(primitives).some((key) => /^color\.neutral\.shadow-\d$/.test(key)), "阴影色单独成 primitive");
  assert.equal(primitives["duration.fast"]?.$value.value ?? primitives["duration.normal"].$value.value, 150);

  // Semantic：全部是 alias，描述带 [观察] / [推断]
  for (const [key, token] of Object.entries(semantic)) {
    assert.match(token.$value, /^\{[^{}]+\}$/, `${key} 必须是 alias`);
    assert.match(token.$description, /^\[(观察|推断)\]/, `${key} 描述要带来源前缀`);
  }
  assert.equal(semantic["color.bg.page"].$value, "{color.neutral.50}");
  assert.equal(semantic["color.bg.surface"].$value, "{color.white}");
  assert.equal(semantic["color.action.primary"].$value, "{color.brand.500}");
  assert.equal(semantic["color.text.on-primary"].$value, "{color.white}");
  assert.equal(semantic["color.action.primary-hover"].$value, "{color.brand.600}");
  assert.equal(semantic["color.text.primary"].$value, "{color.neutral.950}");
  assert.equal(semantic["color.text.secondary"].$value, "{color.neutral.700}");
  assert.equal(semantic["color.text.muted"].$value, "{color.neutral.500}");
  assert.equal(semantic["color.text.link"].$value, "{color.brand.500}");
  assert.equal(semantic["color.text.placeholder"].$value, "{color.neutral.400}");
  assert.equal(semantic["color.focus.ring"].$value, "{color.brand.ring}");
  assert.equal(semantic["focus.ring.width"].$value, "{border.width.ring}"); // 夹具只有 1px 边线，2px 焦点环不在阶梯里 → 新建 ring
  assert.equal(primitives["border.width.ring"].$value.value, 2);
  assert.equal(notes.roles["color.status.success"].source, "observed");
  assert.equal(notes.roles["color.status.warning"].source, "observed");
  assert.equal(notes.roles["color.status.error"].source, "observed");
  assert.equal(notes.roles["color.status.neutral"].source, "inferred");
  assert.equal(semantic["text.body.size"].$value, "{font.size.md}");
  assert.equal(semantic["control.height.md"].$value, "{size.control.md}");
  assert.equal(semantic["layout.topbar.height"].$value, "{size.topbar}");
  assert.equal(semantic["layout.breakpoint.mobile"].$value, "{size.viewport.mobile}");
  assert.ok(semantic["elevation.card.color"] && semantic["elevation.popover.blur"], "阴影两档进 elevation");

  // Theme：class 切换拿到暗色，delta 覆写页面底与正文色
  const themeMap = readJson(path.join(draftDir, "theme-map.json"));
  assert.equal(themeMap.defaultTheme, "light");
  assert.equal(themeMap.activation.kind, "class");
  assert.equal(themeMap.themes[0].id, "dark");
  const delta = flat(readJson(path.join(draftDir, "themes", "dark", "tokens", "semantic.tokens.json")));
  assert.ok(delta["color.bg.page"] && delta["color.text.primary"] && delta["color.border.default"], "dark delta 至少覆写页面底 / 正文 / 边线");
  for (const token of Object.values(delta)) assert.match(token.$value, /^\{color\./);

  // 摘要与备注
  const summary = readFileSync(path.join(draftDir, "audit-summary.md"), "utf8");
  assert.match(summary, /品牌族判定：blue/);
  assert.match(summary, /## 缺口/);
  assert.ok(notes.counts.observed > 60 && notes.counts.inferred > 10, `观察 ${notes.counts.observed} / 推断 ${notes.counts.inferred}`);
  assert.ok(notes.missing.some((entry) => entry.path === "color.bg.overlay"), "弹窗没打开 → overlay 应在缺口里");
  assert.equal(notes.brand.family, "blue");
});

test("起草：--brand 覆盖品牌族，--fill observed 不写推断", () => {
  const out = path.join(work, "draft-observed");
  run("draft-tokens.mjs", ["--evidence", EVIDENCE, "--out", out, "--id", "acme", "--fill", "observed", "--brand", "#dc2626"]);
  const notes = readJson(path.join(out, "draft-notes.json"));
  assert.equal(notes.brand.family, "red");
  assert.equal(notes.counts.inferred, 0);
  const semantic = flat(readJson(path.join(out, "tokens", "semantic.tokens.json")));
  assert.equal(semantic["color.action.primary"].$value, "{color.brand.500}");
  assert.equal(flat(readJson(path.join(out, "tokens", "primitives.tokens.json")))["color.brand.500"].$value.hex, "#DC2626");
});

test("脚手架（项目模式）：目录、文档占位、拒绝覆盖、--tokens-only", () => {
  const out = run("scaffold-system.mjs", ["--from", draftDir, "--project", projectDir, "--id", "acme", "--name", "Acme 采购"]);
  assert.match(out, /项目模式/);
  for (const file of ["design-system/tokens/primitives.tokens.json", "design-system/tokens/semantic.tokens.json", "design-system/scope-map.json", "design-system/theme-map.json", "design-system/themes/dark/tokens/semantic.tokens.json", "design-system/themes/dark/THEME.md", "design-system/style-dictionary.config.mjs", "design-system/DESIGN.md", "design-system/AUDIT.md", "design-system/dist/.gitkeep"]) {
    assert.ok(existsSync(path.join(projectDir, file)), file);
  }
  const design = readFileSync(path.join(projectDir, "design-system", "DESIGN.md"), "utf8");
  assert.match(design, /^# Acme 采购 设计系统/m);
  assert.match(design, /待填写/);
  assert.match(design, /Theme `dark`/);
  assert.doesNotMatch(design, /#[0-9A-Fa-f]{6}\b/, "DESIGN.md 不写 hex");
  const audit = readFileSync(path.join(projectDir, "design-system", "AUDIT.md"), "utf8");
  assert.match(audit, /### 推断角色清单[\s\S]*`color\.action\.primary-active`/);
  assert.match(audit, /### 缺口清单[\s\S]*`color\.bg\.overlay`/);
  const theme = readFileSync(path.join(projectDir, "design-system", "themes", "dark", "THEME.md"), "utf8");
  assert.match(theme, /激活方式：`:root\.dark`/);
  assert.match(theme, /`color\.text\.muted`|`color\.text\.link`/, "THEME.md 列出未覆写的随模式角色");
  assert.deepEqual(readJson(path.join(projectDir, "design-system", "scope-map.json")), { scopes: [], version: 1 });
  assert.ok(!readJson(path.join(projectDir, "design-system", "theme-map.json")).themes[0].tokens, "theme-map 里不带 tokens");

  const refused = spawnSync("node", [path.join(SCRIPTS, "scaffold-system.mjs"), "--from", draftDir, "--project", projectDir, "--id", "acme", "--name", "x"], { encoding: "utf8" });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /已存在/);
  assert.match(run("scaffold-system.mjs", ["--from", draftDir, "--project", projectDir, "--id", "acme", "--name", "Acme 采购", "--tokens-only"]), /仅 token 层/);
});

test("steward validate-system 通过", { skip: stewardScripts ? false : "本机没有 design-system-steward" }, () => {
  const result = JSON.parse(execFileSync("node", [path.join(stewardScripts, "validate-system.mjs"), "--project", projectDir], { encoding: "utf8" }));
  assert.equal(result.valid, true, JSON.stringify(result.issues ?? result, null, 1));
  assert.equal(result.core.tokenCount, 176);
});

test("steward build-tokens + guard current", { skip: canBuild ? false : "steward 的 node_modules 里没有 style-dictionary@5.5.2" }, () => {
  mkdirSync(path.join(projectDir, "node_modules"), { recursive: true });
  symlinkSync(styleDictionary, path.join(projectDir, "node_modules", "style-dictionary"));
  symlinkSync(path.join(steward.dir, "node_modules", ".bin"), path.join(projectDir, "node_modules", ".bin"));
  const built = JSON.parse(execFileSync("node", [path.join(stewardScripts, "build-tokens.mjs"), "--project", projectDir], { encoding: "utf8" }));
  assert.equal(built.valid, true);
  const css = readFileSync(path.join(projectDir, "design-system", "dist", "tokens.css"), "utf8");
  assert.match(css, /--color-action-primary: var\(--color-brand-500\);/);
  assert.match(css, /--color-brand-500: #2563EB;/);
  assert.match(readFileSync(path.join(projectDir, "design-system", "dist", "themes", "dark.css"), "utf8"), /^:root\.dark \{/m);
  const guard = JSON.parse(execFileSync("node", [path.join(stewardScripts, "guard.mjs"), "--project", projectDir], { encoding: "utf8" }));
  assert.equal(guard.status, "current");
});

test("对比度基线：两种模式都算，失败项退出 1，--soft 退出 0", () => {
  const result = spawnSync("node", [path.join(SCRIPTS, "check-contrast.mjs"), "--system", path.join(projectDir, "design-system"), "--json"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.report.map((mode) => mode.id), ["light", "dark"]);
  assert.ok(report.checked >= 40);
  const light = report.report[0].rows.find((row) => row.fg === "color.text.on-primary");
  assert.equal(light.ratio, 5.17);
  assert.equal(light.pass, true);
  const soft = spawnSync("node", [path.join(SCRIPTS, "check-contrast.mjs"), "--system", path.join(projectDir, "design-system"), "--soft", "--write", path.join(work, "contrast.md")], { encoding: "utf8" });
  assert.equal(soft.status, 0);
  assert.match(readFileSync(path.join(work, "contrast.md"), "utf8"), /## 模式：dark/);
});

test("预览板：内联解析值与 --css 两种形态，含模式切换与全部 token 表", () => {
  const board = path.join(work, "board.html");
  run("render-token-board.mjs", ["--system", path.join(projectDir, "design-system"), "--out", board, "--name", "Acme"]);
  const html = readFileSync(board, "utf8");
  assert.match(html, /--color-action-primary: #2563EB;/);
  assert.match(html, /:root\.dark \{/);
  assert.match(html, /data-theme-id="dark"/);
  assert.match(html, /<td><code>color\.action\.primary<\/code>/);
  run("render-token-board.mjs", ["--system", path.join(projectDir, "design-system"), "--out", path.join(work, "board-dist.html"), "--css", "design-system/dist/index.css"]);
  assert.match(readFileSync(path.join(work, "board-dist.html"), "utf8"), /<link rel="stylesheet" href="design-system\/dist\/index\.css">/);
});

test("脚手架（种子模式）：身份文件、桥接、模板、README / CHANGELOG / package.json", () => {
  const out = JSON.parse(run("scaffold-system.mjs", ["--from", draftDir, "--seed", seedDir, "--id", "acme", "--name", "Acme 采购", "--repo", "example/design-systems", "--path", "acme", "--npm", "@example/acme", "--json"]));
  assert.equal(out.mode, "seed");
  const identity = readJson(path.join(seedDir, "design-system.json"));
  for (const key of ["id", "name", "version", "upstream", "stacks", "owned"]) assert.ok(identity[key], `身份文件缺 ${key}`);
  assert.equal(identity.id, "acme");
  assert.equal(identity.upstream.tagPrefix, "acme-v");
  assert.equal(identity.upstream.npm, "@example/acme");
  for (const file of Object.values(identity.stacks.css).filter((value) => typeof value === "string" && value.includes("/"))) {
    assert.ok(existsSync(path.join(seedDir, file)), `栈引用的文件要存在：${file}`);
  }
  assert.ok(existsSync(path.join(seedDir, identity.agents)));
  assert.match(readFileSync(path.join(seedDir, "bridge", "base.css"), "utf8"), /var\(--color-bg-page\)/);
  assert.doesNotMatch(readFileSync(path.join(seedDir, "bridge", "base.css"), "utf8"), /#[0-9a-fA-F]{6}\b/, "桥接不写 hex");
  assert.equal(readJson(path.join(seedDir, "package.json")).name, "@example/acme");
  assert.match(readFileSync(path.join(seedDir, "README.md"), "utf8"), /^# Acme 采购 种子/m);
  assert.match(readFileSync(path.join(seedDir, "CHANGELOG.md"), "utf8"), /## 0\.1\.0/);
});

test("design-system-adopter 能识别并接入种子", { skip: ADOPTER ? false : "附近没有 design-system-adopter（它住在 Design-System 仓库）" }, () => {
  const adopt = path.join(work, "adopt");
  mkdirSync(path.join(adopt, "vendor"), { recursive: true });
  execFileSync("git", ["init", "-q", adopt]);
  execFileSync("cp", ["-R", seedDir, path.join(adopt, "vendor", "acme")]);
  const detected = execFileSync("node", [ADOPTER, "detect", "--project", adopt, "--json"], { encoding: "utf8" });
  assert.match(detected, /"id": "acme"/);
  const init = execFileSync("node", [ADOPTER, "init", "--project", adopt, "--system", "acme", "--stack", "css"], { encoding: "utf8" });
  assert.match(init, /已接入 Acme 采购/);
  assert.ok(existsSync(path.join(adopt, "design-system", "tokens", "semantic.tokens.json")));
  assert.ok(existsSync(path.join(adopt, "design-systems", "acme", "design-system.json")));
  const agents = execFileSync("node", [ADOPTER, "agents", "--project", adopt, "--stack", "css"], { encoding: "utf8" });
  assert.match(agents, /Acme 采购 · 纯 CSS/);
  assert.match(agents, /\[推断\]/);
});

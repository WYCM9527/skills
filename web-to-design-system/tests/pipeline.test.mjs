// node --test tests/pipeline.test.mjs：夹具证据 → 起草 → 脚手架（项目 / 种子）→ steward validate（有 steward 时）→ build + guard（有 style-dictionary 时）
// → 对比度报告 → 预览板 → adopter 识别（有 adopter 时）。夹具 acme-evidence.json 是对 tests/fixtures/acme.html 的真实取证结果。
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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
  assert.match(summary, /## 必须处理的缺口/);
  assert.match(summary, /## 可选角色未填/);
  assert.equal(notes.profile.id, "product", "夹具有状态徽标与状态类根变量 → 产品 UI");
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

test("起草：系统类型决定必须处理的缺口与可推断的角色——品牌站不发明状态色 / 危险色 / 选中态，中后台连 shell 一起要", () => {
  const brandOut = path.join(work, "draft-brand");
  run("draft-tokens.mjs", ["--evidence", EVIDENCE, "--out", brandOut, "--id", "acme", "--profile", "brand"]);
  const brandNotes = readJson(path.join(brandOut, "draft-notes.json"));
  assert.equal(brandNotes.profile.id, "brand");
  assert.equal(brandNotes.profile.source, "user");
  assert.ok(brandNotes.warnings.some((warning) => warning.includes("证据更像")), "用户指定与证据不一致要提醒");
  const brandInferred = Object.entries(brandNotes.roles).filter(([, role]) => role.source === "inferred").map(([rolePath]) => rolePath);
  assert.ok(!brandInferred.some((rolePath) => /^color\.status\.|danger|selected|skeleton|readonly|opacity\.disabled|layer\.(dropdown|toast)/.test(rolePath)), `品牌站不推断产品交互角色：${brandInferred.join(",")}`);
  assert.equal(brandNotes.roles["color.status.success"]?.source, "observed", "有证据的状态色照样写（观察不受类型限制）");
  assert.ok(!brandNotes.missing.some((entry) => entry.path.startsWith("color.status.") || entry.path.includes("danger")), "状态 / 危险色不在品牌站的必须处理清单里");
  assert.ok(brandNotes.optional.some((entry) => entry.path === "color.status.neutral" && entry.tier === "core"), "产品专属的 core 角色对品牌站是可选，不再推断");
  const adminOut = path.join(work, "draft-admin");
  run("draft-tokens.mjs", ["--evidence", EVIDENCE, "--out", adminOut, "--id", "acme", "--profile", "admin"]);
  const adminNotes = readJson(path.join(adminOut, "draft-notes.json"));
  assert.ok(adminNotes.missing.some((entry) => entry.tier === "shell"), "中后台：shell 层缺口进必须处理清单");
  assert.ok(adminNotes.counts.missing > brandNotes.counts.missing);
  assert.throws(() => run("draft-tokens.mjs", ["--evidence", EVIDENCE, "--out", path.join(work, "draft-bad"), "--id", "acme", "--profile", "marketing"], { stdio: "pipe" }));
});

test("起草：根字号偏离 16px 时按 rem 起草并记根字号；各页根字号不一致要警告", () => {
  const evidence = readJson(EVIDENCE);
  const withRoot = (root) => { for (const page of evidence.pages) for (const viewport of Object.values(page.viewports)) if (viewport.layout?.body) viewport.layout.body.rootFontSize = root; return evidence; };
  const remEvidence = path.join(work, "evidence-rem.json");
  writeFileSync(remEvidence, JSON.stringify(withRoot(9)));
  const out = path.join(work, "draft-rem");
  run("draft-tokens.mjs", ["--evidence", remEvidence, "--out", out, "--id", "acme"]);
  const primitives = flat(readJson(path.join(out, "tokens", "primitives.tokens.json")));
  const semantic = flat(readJson(path.join(out, "tokens", "semantic.tokens.json")));
  assert.equal(primitives["font.size.md"].$value.unit, "rem", "字号按 rem");
  assert.ok(Object.keys(primitives).filter((key) => key.startsWith("spacing.")).every((key) => primitives[key].$value.unit === "rem"), "间距按 rem");
  assert.deepEqual(primitives["size.root-font"].$value, { unit: "px", value: 9 });
  assert.equal(semantic["layout.root.font-size"].$value, "{size.root-font}");
  assert.equal(primitives["border.width.thin"]?.$value.unit ?? "px", "px", "边线宽保留 px");
  assert.equal(primitives["size.viewport.mobile"].$value.unit, "px", "断点保留 px");
  const notes = readJson(path.join(out, "draft-notes.json"));
  assert.ok(notes.warnings.some((warning) => warning.includes("根字号 9px")), "摘要里有 rem 模式警告");
  // --unit px 强制按 px
  run("draft-tokens.mjs", ["--evidence", remEvidence, "--out", path.join(work, "draft-rem-px"), "--id", "acme", "--unit", "px"]);
  assert.equal(flat(readJson(path.join(work, "draft-rem-px", "tokens", "primitives.tokens.json")))["font.size.md"].$value.unit, "px");
  // 一页根字号异常（站点 resize 脚本的 bug）
  const mixed = withRoot(16);
  mixed.pages.push(structuredClone(mixed.pages[0])); // 夹具只有一页，复制一页再把第一页的根字号改坏
  Object.values(mixed.pages[0].viewports)[0].layout.body.rootFontSize = 61.44;
  writeFileSync(remEvidence, JSON.stringify(mixed));
  run("draft-tokens.mjs", ["--evidence", remEvidence, "--out", path.join(work, "draft-mixed"), "--id", "acme"]);
  assert.ok(readJson(path.join(work, "draft-mixed", "draft-notes.json")).warnings.some((warning) => warning.includes("各页根字号不一致")));
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
  assert.match(audit, /### 必须处理的缺口[\s\S]*`color\.bg\.overlay`/);
  assert.match(audit, /系统类型：产品 UI/);
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

test("脚手架（发布模式）：<id>/seeds/<name> 布局、身份文件由仓库远端与路径推出、系统 README、根 README 表格行、迁移对照、Citrine 桥接与缺口", { skip: canBuild ? false : "需要 steward 的 style-dictionary 才能 --build" }, () => {
  const repo = path.join(work, "repo");
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "https://github.com/WYCM9527/Design-System.git"]);
  writeFileSync(path.join(repo, "README.md"), "# Design-System\n\n| 设计系统 | 定位 | 版本 |\n| --- | --- | --- |\n| [**Citrine · 黄晶**](citrine/) | 中后台 | 2.11.9 |\n\n## 其他\n");
  const citrineSeed = path.join(REPO_ROOT, "..", "citrine", "seeds", "brand-yellow-e");
  const withBridges = existsSync(path.join(citrineSeed, "bridge", "element-plus.css")) ? ["--with-citrine-bridges", citrineSeed] : [];
  // 先在种子目录放好 style-dictionary，--build 就不用联网安装
  const seedDir = path.join(repo, "acme", "seeds", "acme");
  mkdirSync(path.join(seedDir, "node_modules"), { recursive: true });
  symlinkSync(styleDictionary, path.join(seedDir, "node_modules", "style-dictionary"));
  symlinkSync(path.join(steward.dir, "node_modules", ".bin"), path.join(seedDir, "node_modules", ".bin"));
  const out = JSON.parse(run("scaffold-system.mjs", ["--from", draftDir, "--into-repo", repo, "--id", "acme", "--name", "Acme 采购", "--description", "采购中后台", ...withBridges, "--build", "--json"]));
  assert.equal(out.mode, "into-repo");
  assert.equal(out.identity.repo, "WYCM9527/Design-System");
  assert.equal(out.identity.path, "acme/seeds/acme");
  assert.equal(out.identity.npm, "@wycm9527/acme");
  assert.equal(out.build.ok, true);
  assert.ok(existsSync(path.join(seedDir, "design-system", "dist", "index.css")), "dist 随种子构建");
  assert.ok(!existsSync(path.join(seedDir, "design-system", "dist", ".gitkeep")));
  const identity = readJson(path.join(seedDir, "design-system.json"));
  assert.equal(identity.upstream.tagPrefix, "acme-v");
  assert.equal(identity.migration.roles, "migration/roles.json");
  const roles = readJson(path.join(seedDir, "migration", "roles.json"));
  assert.ok(roles.roles.some((entry) => entry.to === "color.text.primary" && entry.var === "--color-text-primary"));
  assert.ok(roles.roles.some((entry) => entry.to === "radius.md"), "radius 是 Primitive 也要进对照表");
  assert.ok(roles.roles.every((entry) => !roles.skipped.includes(entry.to)));
  const systemReadme = readFileSync(path.join(repo, "acme", "README.md"), "utf8");
  assert.match(systemReadme, /^版本 \*\*0\.1\.0\*\*/m);
  const rootReadme = readFileSync(path.join(repo, "README.md"), "utf8");
  assert.match(rootReadme, /\| \[\*\*Acme 采购\*\*\]\(acme\/\) \| 采购中后台 \| 0\.1\.0 \|/);
  assert.match(rootReadme, /Citrine · 黄晶/, "已有行不动");
  if (withBridges.length) {
    assert.deepEqual(out.identity.stacks, ["css", "element-plus", "shadcn"]);
    assert.ok(existsSync(path.join(seedDir, "bridge", "element-plus.css")) && existsSync(path.join(seedDir, "bridge", "recipes.css")));
    assert.ok(existsSync(path.join(seedDir, "templates", "entry-element-plus.css")) && existsSync(path.join(seedDir, "templates", "notes-shadcn.md")));
    assert.ok(out.bridge.missing.includes("color-bg-sidebar-selected"), "Citrine 桥接引用的侧栏选中底本系统没有 → 缺口");
    const pkg = readJson(path.join(seedDir, "package.json"));
    assert.equal(pkg.exports["./vue/*"], "./bridge/vue/*");
    assert.equal(pkg.exports["./echarts"].default, "./bridge/echarts.js");
    assert.ok(pkg.peerDependenciesMeta?.vue?.optional, "peer 依赖沿用来源种子的可选声明");
    assert.match(readFileSync(path.join(seedDir, "design-system", "AUDIT.md"), "utf8"), /## 桥接缺口[\s\S]*`--color-bg-sidebar-selected`/);
    const bridgeCheck = spawnSync("node", [path.join(SCRIPTS, "check-bridge-vars.mjs"), "--system", path.join(seedDir, "design-system"), "--bridge", path.join(seedDir, "bridge"), "--json"], { encoding: "utf8" });
    assert.equal(bridgeCheck.status, 1);
    assert.ok(JSON.parse(bridgeCheck.stdout).missing.length === out.bridge.missing.length);
  }
  // 重复写入：拒绝；--tokens-only 放行且不动 README
  assert.equal(spawnSync("node", [path.join(SCRIPTS, "scaffold-system.mjs"), "--from", draftDir, "--into-repo", repo, "--id", "acme", "--name", "x"], { encoding: "utf8" }).status, 2);
  // --path 与实际位置不一致 → 防呆
  const badPath = spawnSync("node", [path.join(SCRIPTS, "scaffold-system.mjs"), "--from", draftDir, "--into-repo", repo, "--id", "acme2", "--name", "x", "--path", "somewhere/else"], { encoding: "utf8" });
  assert.equal(badPath.status, 2);
  assert.match(badPath.stderr, /upstream\.path 必须等于/);

  // 发布门禁：版本 / 路径 / 身份文件全过，卡在「待填写」「[推断]」「对比度报告」三项上
  const gate = spawnSync("node", [path.join(SCRIPTS, "publish-check.mjs"), "--seed", seedDir, "--json"], { encoding: "utf8" });
  assert.equal(gate.status, 1);
  const report = JSON.parse(gate.stdout);
  const byName = Object.fromEntries(report.results.map((entry) => [entry.name, entry]));
  for (const name of ["upstream.path = 种子在仓库里的子路径", "upstream.repo = 仓库远端", "acme/README.md 版本行 = 版本", "仓库根 README 表格行 = 版本", "steward validate-system 通过", "steward guard = current（dist 与源一致）", "身份文件引用的文件都存在"]) {
    assert.equal(byName[name]?.status, "pass", name);
  }
  assert.equal(byName["DESIGN.md 没有「待填写 / 待确认」"].status, "fail");
  assert.equal(byName["token 描述里没有未确认的 [推断]"].status, "fail");
  assert.equal(report.failures, 3, JSON.stringify(report.results.filter((entry) => entry.status === "fail").map((entry) => entry.name)));
  // --allow-inferred 把推断降级为警告
  const soft = JSON.parse(spawnSync("node", [path.join(SCRIPTS, "publish-check.mjs"), "--seed", seedDir, "--allow-inferred", "--json"], { encoding: "utf8" }).stdout);
  assert.equal(soft.failures, 2);
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

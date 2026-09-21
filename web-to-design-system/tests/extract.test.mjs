// node --test tests/extract.test.mjs：真实取证冒烟——用 agent-browser 打开 tests/fixtures/acme.html，检查探针拿到了颜色 / 排版 / 组件样本、
// 两条路的暗色探测、悬停与焦点探针。本机没有 agent-browser 时跳过。
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const hasAgentBrowser = spawnSync("bash", ["-lc", "command -v agent-browser"], { encoding: "utf8" }).status === 0;

test("extract-evidence：本地夹具页面的运行时取证", { skip: hasAgentBrowser ? false : "本机没有 agent-browser", timeout: 120000 }, () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "w2ds-extract-")), "evidence.json");
  const url = `file://${path.join(HERE, "fixtures", "acme.html")}`;
  const stdout = execFileSync("node", [path.join(HERE, "..", "scripts", "extract-evidence.mjs"), url, "--out", out], { encoding: "utf8" });
  assert.match(stdout, /首屏 light/);
  const evidence = JSON.parse(readFileSync(out, "utf8"));
  const page = evidence.pages[0];
  const desktop = page.viewports.desktop;
  assert.ok(desktop.colors.length >= 12, `颜色条目 ${desktop.colors.length}`);
  assert.ok(desktop.colors.some((entry) => entry.key === "rgb(37, 99, 235)"), "应读到主色");
  assert.ok(desktop.pairs.some((entry) => entry.key.startsWith("rgb(15, 23, 42) | rgb(255, 255, 255)")), "应有正文 / 白底配对");
  assert.ok(desktop.fontSizes.some((entry) => entry.key === 14 || entry.key === "14"), "应读到 14px 正文");
  assert.ok(desktop.components.buttons.length >= 4 && desktop.components.inputs.length >= 1 && desktop.components.badges.length >= 3);
  assert.ok(desktop.components.inputs[0].placeholder, "应读到 ::placeholder 颜色");
  assert.ok(desktop.stylesheets.breakpoints.some((entry) => entry.key === "768px"));
  assert.ok(desktop.stylesheets.focusRules.length >= 1);
  assert.ok(desktop.themeHints.selectors.some((entry) => entry.key === ".dark"));
  assert.ok(Object.keys(desktop.rootVariables).includes("--primary"));
  assert.equal(page.modes.initial.scheme, "light");
  assert.equal(page.modes["toggle-dark"]?.changed, true, "class 切换应拿到暗色");
  assert.equal(page.modes["media-dark"]?.changed, true, "系统偏好应拿到暗色");
  assert.ok(page.interactions.hover.length >= 4 && page.interactions.hover.some((entry) => entry.changed.includes("background")));
  assert.ok(page.interactions.focus.some((entry) => /rgb\(37, 99, 235\)/.test(entry.after.outline)));
  assert.ok(page.viewports.tablet && page.viewports.mobile, "应有窄屏 / 手机视口");
  assert.equal(page.viewports.mobile.mode, "layout");
});

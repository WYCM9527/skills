#!/usr/bin/env node
// 虚拟项目：用刚提炼出来的设计系统渲染几张「真实网页」给人做视觉验证。页面模板按系统类型取（type.json 的 preview 列表），
// 只引用 token 变量——组合关系（页面底 / 表面 / 文字三档、主按钮、品牌色出现的位置、字号节奏、留白）在预览板的色块清单上看不出来，在这里一眼能看出来。
// 颜色类角色缺失会露出洋红：这个系统类型要求的角色没填。
//
// 两个时机：
//   起草后   node render-preview.mjs --draft /tmp/<id>-draft --evidence /tmp/<id>-evidence.json --out /tmp/<id>-preview --shots
//            （token 用内联解析值，不用构建；Agent 看图纠正角色判定后重起草）
//   写入后   node render-preview.mjs --system <种子>/design-system --evidence … --shots [--via-adopter]
//            （默认链接 dist/index.css + bridge/base.css，就是接入方拿到的东西；--via-adopter 走 ds.mjs export 再链接导出的文件）
//
// 用法：node render-preview.mjs (--system <design-system 目录> | --draft <草稿目录>) [--out <目录>] [--name <名称>]
//       [--type <类型 id>] [--types-dir <dir>] [--evidence <evidence.json>]（文案与来源站截图）
//       [--css <相对 out 的 css 路径>]（强制链接某个 css；默认 system 模式链接 dist/index.css，draft 模式内联）
//       [--via-adopter]（种子模式：用 design-system-adopter 的 export 拿 index.css / base.css）
//       [--radius-control <radius 档名>] [--radius-card <radius 档名>]（控件 / 卡片用哪档圆角；默认 md / lg；直角系统传 none）
//       [--local-css <file>]（追加一段本系统的配方 CSS，比如 hover 反白）
//       [--shots] [--viewports 1440x900,390x844] [--full] [--session <name>] [--agent-browser <bin>] [--json]

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { fileExists, parseArgs, printJson, readJson, reportError, requireAbsolutePath, skillRoot, writeText } from "./lib/args.mjs";
import { cssVariableName } from "./lib/dtcg.mjs";
import { findRepoRoot } from "./lib/repo.mjs";
import { inlineTokensCss, loadSystem, resolveIn } from "./lib/system.mjs";
import { loadTypes, resolveType, typePreviewPages } from "./lib/types.mjs";

const escape = (text) => String(text ?? "").replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const fill = (template, values) => template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (whole, key) => (key in values ? String(values[key]) : whole));
const clean = (text) => String(text ?? "").replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();

/** 从证据里挑文案：hero 标题取首页最长的标题，副标题优先中文长句，导航取 CTA 里 2～8 个字的短语（去掉与站名重复的），区块标题取其余页面的标题。 */
function pickCopy(evidence, name) {
  const pages = evidence?.pages ?? [];
  const desktop = (page) => Object.values(page.viewports ?? {})[0] ?? {};
  const hasCjk = (text) => /[\u3400-\u9fff]/.test(text);
  const headlines = [...new Set(pages.flatMap((page) => (desktop(page).texts?.headlines ?? []).map(clean)).filter((text) => text.length >= 2))];
  const ctas = [...new Set(pages.flatMap((page) => (desktop(page).texts?.ctas ?? []).map(clean)))].filter((text) => text.length >= 2 && text.length <= 8 && hasCjk(text) && !name.includes(text) && !text.includes(name));
  const firstPage = (desktop(pages[0] ?? {}).texts?.headlines ?? []).map(clean).filter(Boolean);
  const h1 = [...firstPage].sort((left, right) => right.length - left.length)[0] ?? headlines[0] ?? `${name} 让每一次决定都有来处`;
  const others = headlines.filter((text) => text !== h1 && text.length <= 24);
  const sub = others.find((text) => hasCjk(text) && text.length >= 6) ?? others.find((text) => text.length >= 6) ?? "一句话副标题：系统把网站上实测到的颜色、字号、间距收成 token，页面只引用用途名。";
  const sections = others.filter((text) => text !== sub && text.length <= 12 && hasCjk(text));
  const cta = ctas[0] ?? "立即开始";
  const nav = ctas.filter((text) => text !== cta);
  const pick = (list, index, fallback) => list[index] ?? fallback;
  return {
    CTA: cta,
    CTA2: pick(nav, 0, "了解更多"),
    EYEBROW: pick(sections, 0, "我们是谁"),
    H1: h1,
    H2: others.find((text) => hasCjk(text) && text.length >= 4 && text !== sub) ?? "用一段展示大字说明我们做什么",
    NAV1: pick(nav, 0, "产品"),
    NAV2: pick(nav, 1, "案例"),
    NAV3: pick(nav, 2, "关于"),
    NAV4: pick(nav, 3, "联系"),
    SECTION1: pick(sections, 0, "板块一"),
    SECTION2: pick(sections, 1, "板块二"),
    SECTION3: pick(sections, 2, "板块三"),
    SUB: sub
  };
}

function ab(agentBrowser, session, args, { allowFailure = false } = {}) {
  const result = spawnSync(agentBrowser, ["--session", session, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0 && !allowFailure) throw new Error(`agent-browser ${args.slice(0, 2).join(" ")} 失败：${(result.stderr || result.stdout || "").trim().slice(0, 400)}`);
  return result.status === 0;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const draftMode = typeof options.draft === "string";
  const systemRoot = requireAbsolutePath(path.resolve(process.cwd(), String(draftMode ? options.draft : options.system ?? "")), draftMode ? "--draft" : "--system");
  if (!existsSync(path.join(systemRoot, "tokens"))) throw new Error(`${systemRoot} 里没有 tokens/`);
  const outDir = requireAbsolutePath(path.resolve(process.cwd(), String(options.out ?? path.join(systemRoot, "preview"))), "--out");
  const seedRoot = draftMode ? null : path.dirname(systemRoot);
  const identity = !draftMode && (await fileExists(path.join(seedRoot, "design-system.json"))) ? await readJson(path.join(seedRoot, "design-system.json")) : null;
  const notes = draftMode && (await fileExists(path.join(systemRoot, "draft-notes.json"))) ? await readJson(path.join(systemRoot, "draft-notes.json")) : null;
  const name = String(options.name ?? identity?.name ?? notes?.name ?? path.basename(seedRoot ?? systemRoot));
  const evidence = typeof options.evidence === "string" ? await readJson(requireAbsolutePath(path.resolve(process.cwd(), options.evidence), "--evidence")) : null;

  // —— 系统类型 → 页面模板 ——
  const registry = await loadTypes({ dirs: String(options["types-dir"] ?? "").split(",").map((dir) => dir.trim()).filter(Boolean), startDir: systemRoot });
  const typeId = options.type !== undefined ? String(options.type) : identity?.type ?? identity?.profile ?? notes?.type?.id ?? "product";
  const systemType = resolveType(registry, typeId);
  const pages = typePreviewPages(systemType);
  if (!pages.length) throw new Error(`系统类型 ${systemType.id} 没有声明预览页（type.json 的 preview）`);

  // —— token CSS：内联 / 链接 dist / adopter export ——
  const system = await loadSystem(systemRoot);
  await mkdir(path.join(outDir, "shots"), { recursive: true });
  const cssLinks = [];
  let cssSource = "";
  if (options["via-adopter"] === true) {
    if (!seedRoot || !identity) throw new Error("--via-adopter 需要种子（design-system 目录旁边有 design-system.json）");
    const repoRoot = findRepoRoot(process.cwd()) ?? findRepoRoot(seedRoot);
    const adopter = [repoRoot && path.join(repoRoot, "design-system-adopter", "scripts", "ds.mjs"), path.join(skillRoot, "..", "design-system-adopter", "scripts", "ds.mjs"), path.join(skillRoot, "..", "..", "design-system-adopter", "scripts", "ds.mjs")].filter(Boolean).find((candidate) => existsSync(candidate));
    if (!adopter) throw new Error("找不到 design-system-adopter/scripts/ds.mjs（它住在 Design-System 仓库）");
    const project = await mkdir(path.join(os.tmpdir(), `w2ds-preview-${Date.now()}`), { recursive: true }).then(() => path.join(os.tmpdir(), `w2ds-preview-${Date.now()}`));
    await mkdir(project, { recursive: true });
    spawnSync("git", ["init", "-q", project]);
    const exported = spawnSync("node", [adopter, "export", "--project", project, "--system", seedRoot, "--to", path.join(outDir, "static"), "--force"], { encoding: "utf8" });
    if (exported.status !== 0) throw new Error(`ds.mjs export 失败：${(exported.stderr || exported.stdout).trim().slice(-600)}`);
    cssLinks.push("static/index.css", "static/base.css");
    cssSource = "design-system-adopter export（接入方拿到的纯 CSS 交付物）";
  } else if (typeof options.css === "string") {
    cssLinks.push(options.css);
    cssSource = options.css;
  } else if (!draftMode && (await fileExists(path.join(systemRoot, "dist", "index.css")))) {
    cssLinks.push(path.relative(outDir, path.join(systemRoot, "dist", "index.css")).split(path.sep).join("/"));
    const base = seedRoot ? path.join(seedRoot, "bridge", "base.css") : null;
    if (base && existsSync(base)) cssLinks.push(path.relative(outDir, base).split(path.sep).join("/"));
    cssSource = cssLinks.join(" + ");
  } else {
    await writeText(path.join(outDir, "tokens.css"), `${inlineTokensCss(system)}\n`);
    cssLinks.push("tokens.css");
    cssSource = "内联解析值（构建前）";
  }
  await copyFile(path.join(skillRoot, "assets", "preview", "preview.css"), path.join(outDir, "preview.css"));

  // —— 本系统的局部配方：圆角档、vw 缩放根字号、用户追加的 CSS ——
  const local = [];
  const radiusControl = String(options["radius-control"] ?? "md");
  const radiusCard = String(options["radius-card"] ?? "lg");
  local.push(`:root { --pv-radius-control: var(--radius-${radiusControl}, 0px); --pv-radius-card: var(--radius-${radiusCard}, 0px); }`);
  const rootFont = resolveIn(system, "size.root-font");
  const desktopWidth = evidence ? Object.values(evidence.pages?.[0]?.viewports ?? {})[0]?.width ?? 1440 : 1440;
  if (rootFont?.value?.value) {
    const divisor = Math.round((desktopWidth / rootFont.value.value) * 100) / 100;
    // 窄屏不跟着 vw 缩：站点自己在窄屏用另一套 rem 值（Tailwind 断点前缀），token 只收了桌面值，按桌面根字号渲染才看得清
    local.push(`/* vw 缩放的 rem 站点：复刻 html 根字号 = 100vw / ${divisor}（桌面 ${desktopWidth} 宽下 ${rootFont.value.value}px）；窄屏按桌面根字号 */\nhtml { font-size: calc(100vw / ${divisor}); }\n@media (max-width: 767px) { html { font-size: ${rootFont.value.value}px; } }`);
  }
  if (typeof options["local-css"] === "string") local.push(await readFile(requireAbsolutePath(path.resolve(process.cwd(), options["local-css"]), "--local-css"), "utf8"));
  await writeText(path.join(outDir, "preview.local.css"), `${local.join("\n\n")}\n`);

  // —— 渲染页面 ——
  const copy = pickCopy(evidence, name);
  const head = [...cssLinks, "preview.css", "preview.local.css"].map((href) => `<link rel="stylesheet" href="${escape(href)}">`).join("\n");
  const values = { ...copy, HEAD: head, NAME: escape(name), SOURCE: escape(evidence?.pages?.[0]?.url ?? identity?.upstream?.repo ?? systemType.label) };
  for (const key of Object.keys(copy)) values[key] = escape(copy[key]);
  const written = [];
  for (const { file, page } of pages) {
    const html = fill(await readFile(file, "utf8"), values);
    await writeText(path.join(outDir, `${page}.html`), html);
    written.push(`${page}.html`);
  }

  // —— 截图：每页 × 视口 × 模式；来源站首屏截图从证据目录拷来对照 ——
  const shots = [];
  const sources = [];
  if (evidence) {
    for (const [index, page] of (evidence.pages ?? []).entries()) {
      for (const [kind, file] of Object.entries(page.screenshots ?? {})) {
        if (!file || !existsSync(file)) continue;
        const target = path.join(outDir, "shots", `source-${index + 1}-${kind}.png`);
        await copyFile(file, target);
        sources.push({ file: path.relative(outDir, target).split(path.sep).join("/"), kind, url: page.url });
      }
    }
  }
  const themes = system.themes.filter((theme) => theme.selector && theme.status !== "reference-only");
  if (options.shots === true) {
    const agentBrowser = String(options["agent-browser"] ?? process.env.AGENT_BROWSER ?? "agent-browser");
    const session = String(options.session ?? "w2ds-preview");
    const viewports = String(options.viewports ?? "1440x900,390x844").split(",").map((entry) => entry.trim().split("x").map(Number)).filter((pair) => pair.length === 2 && pair.every(Number.isFinite));
    const full = options.full === true ? ["--full"] : [];
    try {
      for (const { page } of pages) {
        for (const [width, height] of viewports) {
          ab(agentBrowser, session, ["set", "viewport", String(width), String(height)]);
          ab(agentBrowser, session, ["open", `file://${path.join(outDir, `${page}.html`)}`]);
          ab(agentBrowser, session, ["wait", "400"], { allowFailure: true });
          const shot = path.join(outDir, "shots", `${page}-${width}.png`);
          ab(agentBrowser, session, ["screenshot", shot, ...full]);
          shots.push({ file: `shots/${page}-${width}.png`, page, theme: system.themeMap?.defaultTheme ?? "default", width });
          for (const theme of themes) {
            if (theme.id === system.themeMap?.defaultTheme) continue;
            const apply = system.themeMap.activation.kind === "data-attribute"
              ? `document.documentElement.setAttribute(${JSON.stringify(system.themeMap.activation.attribute)}, ${JSON.stringify(theme.id)})`
              : `document.documentElement.classList.add(${JSON.stringify(theme.id)})`;
            spawnSync(agentBrowser, ["--session", session, "eval", `${apply}; "ok"`], { encoding: "utf8" });
            ab(agentBrowser, session, ["wait", "200"], { allowFailure: true });
            const themed = path.join(outDir, "shots", `${page}-${width}-${theme.id}.png`);
            ab(agentBrowser, session, ["screenshot", themed, ...full]);
            shots.push({ file: `shots/${page}-${width}-${theme.id}.png`, page, theme: theme.id, width });
          }
        }
      }
    } finally {
      ab(agentBrowser, session, ["close"], { allowFailure: true });
    }
  }

  // —— 对照页 ——
  const checklist = [
    "页面底 / 表面 / 文字三档压在一起，是不是那个站的气质（明暗、冷暖、对比强弱）",
    "主按钮像不像来源站的主 CTA；次要按钮与它的对比够不够",
    "品牌色出现的位置和面积对不对——只在该被注意的地方出现，还是到处都是",
    "标题 → 正文 → 说明的字号节奏、行高、字重层次",
    "区块留白、卡片内边距、圆角纪律（直角 / 圆角 / 胶囊）",
    "有洋红 = 这个系统类型要求的角色没填；有另一模式的话切过去再看一遍"
  ];
  // 对照页：先把「来源站首屏 vs 第一张虚拟页」并排放，再列每页各视口 / 模式的截图，其余来源站截图折叠
  const figure = (file, caption) => `<figure><a href="${escape(file)}" target="_blank"><img src="${escape(file)}" loading="lazy"></a><figcaption>${escape(caption)}</figcaption></figure>`;
  const firstSourceDesktop = sources.find((entry) => entry.kind === "desktop");
  const firstShot = shots.find((shot) => shot.page === pages[0].page && shot.width === Math.max(...shots.map((entry) => entry.width)));
  const sideBySide = firstSourceDesktop && firstShot
    ? `<section><h2>并排看：来源站首屏 vs 虚拟项目「${escape(pages[0].page)}」</h2><div class="figs">${figure(firstSourceDesktop.file, `来源站 · ${firstSourceDesktop.url}`)}${figure(firstShot.file, `虚拟项目 · ${pages[0].page} · ${firstShot.width}px`)}</div></section>`
    : "";
  const pageCards = pages.map(({ page }) => {
    const mine = shots.filter((shot) => shot.page === page);
    const figures = mine.length
      ? mine.map((shot) => figure(shot.file, `${page} · ${shot.width}px · ${shot.theme}`)).join("")
      : `<p class="note">没有截图（加 --shots 生成）；直接打开 <a href="${page}.html" target="_blank">${page}.html</a> 看。</p>`;
    return `<section><h2>${escape(page)} <small><a href="${page}.html" target="_blank">打开页面</a></small></h2><div class="figs">${figures}</div></section>`;
  }).join("");
  const sourceCards = sources.length
    ? `<details><summary>来源站首屏全部截图（${sources.length} 张）</summary><div class="figs">${sources.map((entry) => figure(entry.file, `来源站 · ${entry.kind} · ${entry.url}`)).join("")}</div></details>`
    : "";
  const compare = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(name)} · 虚拟项目对照</title>
<style>
  body { margin: 0; padding: 24px; font: 14px/1.6 system-ui, sans-serif; background: #f4f4f5; color: #18181b; }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0; } h2 { font-size: 16px; margin: 24px 0 8px; } small { font-weight: 400; color: #71717a; } small a { color: inherit; }
  .meta { color: #71717a; } .check { background: #fff; border: 1px solid #e4e4e7; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; }
  .check ol { margin: 6px 0 0; padding-left: 20px; }
  .figs { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; }
  figure { margin: 0; background: #fff; border: 1px solid #e4e4e7; border-radius: 8px; padding: 8px; max-width: 100%; }
  figure img { display: block; max-height: 520px; max-width: min(100%, 600px); width: auto; border-radius: 4px; }
  figcaption { font-size: 12px; color: #71717a; margin-top: 6px; }
  .note { color: #71717a; }
  details { margin-top: 24px; } summary { cursor: pointer; color: #71717a; }
</style></head><body>
<header><h1>${escape(name)} · 虚拟项目对照</h1><span class="meta">系统类型 ${escape(systemType.label)}（${escape(systemType.id)}） · token 来自 ${escape(cssSource)} · ${new Date().toISOString().slice(0, 10)}</span></header>
<div class="check"><b>看图清单</b><ol>${checklist.map((item) => `<li>${escape(item)}</li>`).join("")}</ol></div>
${sideBySide}
${pageCards}
${sourceCards}
</body></html>
`;
  await writeText(path.join(outDir, "index.html"), compare);

  const result = { css: cssSource, out: outDir, pages: written, shots: shots.map((shot) => shot.file), sources: sources.length, type: systemType.id };
  if (options.json === true) return printJson(result);
  process.stdout.write(`${path.join(outDir, "index.html")}\n  系统类型 ${systemType.label}（${systemType.id}） · 页面 ${written.join(" / ")} · token 来自 ${cssSource}${shots.length ? ` · 截图 ${shots.length} 张` : " · 未截图（加 --shots）"}${sources.length ? ` · 来源站首屏 ${sources.length} 张` : ""}\n  看图清单：${checklist.map((item, index) => `${index + 1}) ${item}`).join("；")}\n`);
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

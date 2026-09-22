#!/usr/bin/env node
// 预览板：从 design-system/ 的 token 直接渲染一张自包含 HTML——语义色板（按角色分组）、Primitive 色族、字号 / 间距 / 圆角 / 线宽阶梯、
// 三层阴影、动效 / 层级 / 透明度表、只用语义变量拼出来的组件样例、全部 token 明细表；有 Theme 时带模式切换。
// 与原 web-to-design-md 的 markdown 驱动预览不同：这里的真相源是 token 文件，变量名与 steward 构建产物一致，
// 所以用 --css 指向 dist/index.css 时看到的就是构建结果；不带 --css 时用内联解析值兜底（构建前也能看）。
//
// 用法：node render-token-board.mjs --system <design-system 目录> --out <file.html> [--name <名称>] [--css <相对 out 的 dist/index.css 路径>]
//       [--profile brand|product|admin]（组件样例按系统类型取舍；默认读 <system>/../design-system.json 的 profile，没有就按 product）

import path from "node:path";

import { readFile } from "node:fs/promises";

import { parseArgs, reportError, requireAbsolutePath, requireStringOption, writeText } from "./lib/args.mjs";
import { aliasTarget, cssValueOf, cssVariableName } from "./lib/dtcg.mjs";
import { ROLE_BY_PATH, ROLE_GROUPS } from "./lib/roles.mjs";
import { allPaths, loadSystem, resolveIn } from "./lib/system.mjs";

const escape = (text) => String(text ?? "").replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const v = (tokenPath) => `var(--${cssVariableName(tokenPath)})`;

function inlineCss(system) {
  const lines = [];
  const block = (selector, tokens, theme) => {
    const body = [];
    for (const tokenPath of [...tokens.keys()].sort()) {
      const resolved = resolveIn(system, tokenPath, theme);
      if (resolved?.css) body.push(`  --${cssVariableName(tokenPath)}: ${resolved.css};`);
    }
    return body.length ? `${selector} {\n${body.join("\n")}\n}` : "";
  };
  lines.push(block(":root", system.core, null));
  for (const theme of system.themes) {
    if (theme.mediaQuery) {
      lines.push(`@media ${theme.mediaQuery} {\n${block(":root", theme.tokens, theme).replace(/^/gm, "  ")}\n}`);
    } else if (theme.selector) {
      lines.push(block(theme.selector, theme.tokens, theme));
    }
  }
  return lines.filter(Boolean).join("\n");
}

function swatch(tokenPath, { label, meta } = {}) {
  return `<div class="sw"><i style="background:${v(tokenPath)}"></i><b>${escape(label ?? tokenPath)}</b>${meta ? `<span>${escape(meta)}</span>` : ""}</div>`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const systemRoot = requireAbsolutePath(path.resolve(process.cwd(), requireStringOption(options, "system")), "--system");
  const outFile = requireAbsolutePath(path.resolve(process.cwd(), requireStringOption(options, "out")), "--out");
  const system = await loadSystem(systemRoot);
  if (system.core.size === 0) {
    throw new Error(`${systemRoot}/tokens 里没有 token`);
  }
  const name = String(options.name ?? path.basename(path.dirname(systemRoot)) ?? "设计系统");
  // 系统类型：品牌 / 内容站不展示状态胶囊、危险按钮、Tooltip 这类产品样例（它们只会露出后备值），换成导航项 / Hero 大字 / CTA
  let profile = options.profile === undefined ? null : String(options.profile);
  if (!profile) {
    try {
      const identity = JSON.parse(await readFile(path.join(systemRoot, "..", "design-system.json"), "utf8"));
      if (typeof identity.profile === "string") profile = identity.profile;
    } catch { /* 项目模式没有身份文件 */ }
  }
  profile = ["brand", "product", "admin"].includes(profile) ? profile : "product";
  const paths = allPaths(system);
  const has = (tokenPath) => system.core.has(tokenPath);
  const semantic = paths.filter((tokenPath) => aliasTarget(system.core.get(tokenPath)?.value));
  const primitives = paths.filter((tokenPath) => system.core.has(tokenPath) && !aliasTarget(system.core.get(tokenPath).value));

  // —— 语义色板按角色分组 ——
  const colorGroups = ROLE_GROUPS.filter(([group]) => ["bg", "text", "action", "border", "focus", "status", "brand", "icon", "chart", "data"].includes(group));
  const semanticColorSections = colorGroups.map(([group, zh]) => {
    const members = semantic.filter((tokenPath) => tokenPath.startsWith("color.") && system.core.get(tokenPath).type === "color" && (ROLE_BY_PATH.get(tokenPath)?.group === group || (!ROLE_BY_PATH.has(tokenPath) && tokenPath.split(".")[1] === group)));
    if (!members.length) return "";
    return `<section><h2>${escape(zh)} <small>${members.length}</small></h2><div class="grid">${members.map((tokenPath) => {
      const token = system.core.get(tokenPath);
      const target = aliasTarget(token.value);
      const resolved = resolveIn(system, tokenPath);
      const inferred = /^\[推断\]/.test(token.description ?? "");
      return swatch(tokenPath, { label: tokenPath.replace(/^color\./, ""), meta: `${target ? `→ ${target.replace(/^color\./, "")}` : ""} ${resolved?.css ?? ""}${inferred ? " · 推断" : ""}` });
    }).join("")}</div></section>`;
  }).join("");

  // —— Primitive 色族 ——
  const families = new Map();
  for (const tokenPath of primitives.filter((tokenPath) => tokenPath.startsWith("color.") && system.core.get(tokenPath).type === "color")) {
    const family = tokenPath.split(".")[1];
    families.set(family, [...(families.get(family) ?? []), tokenPath]);
  }
  const primitiveSections = [...families.entries()].map(([family, members]) => `<div class="family"><h3>${escape(family)}</h3><div class="grid">${members.map((tokenPath) => swatch(tokenPath, { label: tokenPath.split(".").slice(2).join("."), meta: cssValueOf(resolveIn(system, tokenPath)) })).join("")}</div></div>`).join("");

  // —— 阶梯 ——
  const dimensionLadder = (prefix, unitLabel) => primitives
    .filter((tokenPath) => tokenPath.startsWith(prefix) && system.core.get(tokenPath).type === "dimension")
    .map((tokenPath) => ({ css: cssValueOf(resolveIn(system, tokenPath)), tokenPath, value: resolveIn(system, tokenPath)?.value?.value ?? 0 }))
    .sort((left, right) => left.value - right.value)
    .map((entry) => `<div class="ladder-row"><code>${escape(entry.tokenPath)}</code><span class="${unitLabel}" style="--w:${v(entry.tokenPath)}"></span><small>${escape(entry.css)}</small></div>`)
    .join("");
  const typeRoles = ["text.caption.size", "text.small.size", "text.body-sm.size", "text.body.size", "text.title-sm.size", "text.title.size", "text.heading.size", "text.display.size", "text.hero.size"].filter(has);
  const typeRows = typeRoles.map((tokenPath) => `<div class="type-row"><code>${escape(tokenPath)}</code><span style="font-size:${v(tokenPath)};line-height:1.25">设计系统 Design System 0123</span><small>${escape(cssValueOf(resolveIn(system, tokenPath)))}</small></div>`).join("");
  const familyRows = paths.filter((tokenPath) => system.core.get(tokenPath)?.type === "fontFamily").map((tokenPath) => `<div class="type-row"><code>${escape(tokenPath)}</code><span style="font-family:${v(tokenPath)}">字体栈 The quick brown fox 0123</span><small>${escape(cssValueOf(resolveIn(system, tokenPath)))}</small></div>`).join("");
  const radiusRows = primitives.filter((tokenPath) => tokenPath.startsWith("radius.")).map((tokenPath) => `<div class="sw"><i class="radius" style="border-radius:${v(tokenPath)}"></i><b>${escape(tokenPath)}</b><span>${escape(cssValueOf(resolveIn(system, tokenPath)))}</span></div>`).join("");
  const elevationRows = ["card", "popover", "modal"].filter((level) => has(`elevation.${level}.blur`)).map((level) => `<div class="elev" style="box-shadow:0 ${v(`elevation.${level}.y`)} ${v(`elevation.${level}.blur`)} ${v(`elevation.${level}.color`)}"><b>elevation.${level}</b><small>${escape(["y", "blur", "color"].map((part) => cssValueOf(resolveIn(system, `elevation.${level}.${part}`))).join(" / "))}</small></div>`).join("");
  const simpleTable = (prefixes) => {
    const rows = paths.filter((tokenPath) => prefixes.some((prefix) => tokenPath.startsWith(prefix)) && ["number", "duration", "cubicBezier", "string", "fontWeight"].includes(system.core.get(tokenPath)?.type));
    return rows.length ? `<table><thead><tr><th>token</th><th>类型</th><th>值</th></tr></thead><tbody>${rows.map((tokenPath) => `<tr><td><code>${escape(tokenPath)}</code></td><td>${escape(system.core.get(tokenPath).type)}</td><td>${escape(cssValueOf(resolveIn(system, tokenPath)))}${aliasTarget(system.core.get(tokenPath).value) ? ` <small>→ ${escape(aliasTarget(system.core.get(tokenPath).value))}</small>` : ""}</td></tr>`).join("")}</tbody></table>` : "";
  };

  // —— 全部 token 明细 ——
  const themeHeaders = system.themes.map((theme) => `<th>${escape(theme.id)}</th>`).join("");
  const detailRows = paths.map((tokenPath) => {
    const token = system.core.get(tokenPath) ?? system.themes.map((theme) => theme.tokens.get(tokenPath)).find(Boolean);
    const target = aliasTarget(token?.value);
    const base = resolveIn(system, tokenPath);
    const themeCells = system.themes.map((theme) => {
      const resolved = resolveIn(system, tokenPath, theme);
      const changed = theme.tokens.has(tokenPath);
      return `<td class="${changed ? "changed" : ""}">${changed ? escape(cssValueOf(resolved)) : ""}</td>`;
    }).join("");
    return `<tr data-q="${escape(tokenPath.toLowerCase())}"><td><code>${escape(tokenPath)}</code></td><td>${escape(token?.type ?? "")}</td><td>${target ? `<code>{${escape(target)}}</code>` : ""}</td><td>${token?.type === "color" && base?.css ? `<i class="dot" style="background:${escape(base.css)}"></i>` : ""}${escape(base?.css ?? "")}</td>${themeCells}<td class="desc">${escape(token?.description ?? "")}</td></tr>`;
  }).join("");

  // —— 模式切换 ——
  const toggles = system.themes.map((theme) => {
    if (theme.mediaQuery) return `<span class="hint">Theme「${escape(theme.id)}」跟随系统偏好（${escape(theme.mediaQuery)}），切系统外观即可预览</span>`;
    const kind = system.themeMap.activation.kind;
    const attribute = system.themeMap.activation.attribute ?? "";
    return `<button type="button" data-theme-id="${escape(theme.id)}" data-kind="${kind}" data-attribute="${escape(attribute)}">切换 ${escape(theme.id)}</button>`;
  }).join("");

  const cssHref = typeof options.css === "string" ? options.css : null;
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escape(name)} · Token 预览板</title>
${cssHref ? `<link rel="stylesheet" href="${escape(cssHref)}">` : `<style id="tokens">\n${inlineCss(system)}\n</style>`}
<style>
  /* 预览板自身的壳层样式全部引用 token 变量，缺失的角色由后备值兜底 */
  /* vw 缩放的 rem 站点会带 layout.root.font-size：预览板按它渲染 rem 尺寸，否则按 16px */
  :root { color-scheme: light dark; font-size: var(--layout-root-font-size, 16px); }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--color-bg-page, #f5f5f5); color: var(--color-text-primary, #111); font-family: var(--font-family-body, system-ui, sans-serif); font-size: var(--text-body-size, 14px); line-height: var(--text-body-line-height, 1.6); }
  header { position: sticky; top: 0; z-index: var(--layer-sticky, 2); display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 12px 32px; background: var(--color-bg-surface, #fff); border-bottom: var(--border-width-default, 1px) solid var(--color-border-default, #ddd); }
  header h1 { margin: 0; font-size: var(--text-title-size, 16px); font-weight: var(--text-weight-strong, 600); }
  header .meta { color: var(--color-text-muted, #666); font-size: var(--text-small-size, 12px); }
  header button, .btn { height: var(--control-height-md, 36px); padding: 0 16px; border-radius: var(--radius-md, 8px); border: var(--border-width-default, 1px) solid var(--color-border-strong, #ccc); background: var(--color-bg-surface, #fff); color: var(--color-text-primary, #111); font: inherit; font-weight: var(--text-weight-label, 500); cursor: pointer; transition: background-color var(--motion-duration-fast, 150ms) var(--motion-easing-standard, ease); }
  header button:hover, .btn:hover { background: var(--color-action-secondary-hover, var(--color-bg-hover, #eee)); }
  .hint { color: var(--color-text-muted, #666); font-size: var(--text-small-size, 12px); }
  main { max-width: var(--layout-container-max-width, 1200px); margin: 0 auto; padding: var(--space-gutter, 32px); display: grid; gap: var(--space-stack, 24px); }
  section { background: var(--color-bg-surface, #fff); border: var(--border-width-default, 1px) solid var(--color-border-default, #ddd); border-radius: var(--radius-lg, 12px); padding: var(--space-card, 24px); box-shadow: 0 var(--elevation-card-y, 1px) var(--elevation-card-blur, 3px) var(--elevation-card-color, rgba(0,0,0,.06)); }
  h2 { margin: 0 0 16px; font-size: var(--text-heading-size, 20px); line-height: var(--text-heading-line-height, 1.3); font-weight: var(--text-weight-strong, 600); }
  h2 small, h3 small { color: var(--color-text-muted, #666); font-weight: var(--font-weight-regular, 400); font-size: var(--text-small-size, 12px); }
  h3 { margin: 16px 0 8px; font-size: var(--text-title-sm-size, 15px); font-weight: var(--text-weight-label, 500); color: var(--color-text-secondary, #444); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: var(--space-inline, 8px); }
  .sw { display: grid; grid-template-rows: 56px auto auto; gap: 4px; font-size: var(--text-small-size, 12px); }
  .sw i { display: block; border-radius: var(--radius-sm, 6px); border: var(--border-width-default, 1px) solid var(--color-border-default, #ddd); }
  .sw i.radius { background: var(--color-bg-subtle, #eee); border: var(--border-width-active, 2px) solid var(--color-border-strong, #999); }
  .sw b { font-weight: var(--text-weight-label, 500); word-break: break-all; }
  .sw span { color: var(--color-text-muted, #666); word-break: break-all; }
  .family + .family { margin-top: 8px; }
  .ladder-row, .type-row { display: grid; grid-template-columns: 220px 1fr auto; gap: 12px; align-items: center; padding: 6px 0; border-bottom: var(--border-width-default, 1px) solid var(--color-border-default, #eee); }
  .ladder-row span.px { display: block; height: 12px; width: var(--w); background: var(--color-action-primary, #333); border-radius: var(--radius-xs, 2px); }
  .ladder-row span.bw { display: block; height: 0; border-top: var(--w) solid var(--color-text-primary, #111); }
  .type-row span { color: var(--color-text-primary, #111); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  code, small { font-family: var(--font-family-code, ui-monospace, monospace); font-size: var(--text-small-size, 12px); }
  small { color: var(--color-text-muted, #666); }
  .elevs { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-stack, 24px); }
  .elev { padding: var(--space-card, 24px); border-radius: var(--radius-lg, 12px); background: var(--color-bg-elevated, var(--color-bg-surface, #fff)); }
  .elev b { display: block; font-weight: var(--text-weight-label, 500); }
  table { width: 100%; border-collapse: collapse; font-size: var(--text-body-sm-size, 13px); }
  th { text-align: left; font-weight: var(--text-weight-label, 500); color: var(--color-text-secondary, #444); background: var(--color-bg-subtle, #f5f5f5); padding: var(--table-cell-padding-y, 10px) var(--table-cell-padding-x, 12px); border-bottom: var(--border-width-default, 1px) solid var(--color-border-default, #ddd); }
  td { padding: var(--table-cell-padding-y, 10px) var(--table-cell-padding-x, 12px); border-bottom: var(--border-width-default, 1px) solid var(--color-border-default, #eee); vertical-align: top; }
  tr:hover td { background: var(--color-bg-hover, #f7f7f7); }
  td.changed { color: var(--color-text-link, inherit); font-weight: var(--text-weight-label, 500); }
  td.desc { color: var(--color-text-muted, #666); font-size: var(--text-small-size, 12px); max-width: 420px; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; border: 1px solid var(--color-border-default, #ddd); vertical-align: middle; }
  .samples { display: flex; flex-wrap: wrap; gap: var(--space-stack, 24px); align-items: flex-start; }
  .sample-card { flex: 1 1 320px; display: grid; gap: var(--space-inline, 8px); }
  .btn.primary { background: var(--color-action-primary); color: var(--color-text-on-primary, #fff); border-color: transparent; }
  .btn.primary:hover { background: var(--color-action-primary-hover, var(--color-action-primary)); }
  .btn.danger { background: var(--color-action-danger); color: var(--color-text-on-danger, #fff); border-color: transparent; }
  .btn.quiet { background: var(--color-action-quiet, transparent); border-color: transparent; color: var(--color-text-link, inherit); }
  .btn[disabled] { opacity: var(--opacity-disabled, .5); cursor: not-allowed; }
  .btn:focus-visible, .input:focus-visible { outline: var(--focus-ring-width, 3px) solid var(--color-focus-ring, #888); outline-offset: 2px; }
  .input { height: var(--control-height-md, 36px); padding: 0 12px; border-radius: var(--radius-md, 8px); border: var(--border-width-default, 1px) solid var(--color-border-input, #ccc); background: var(--color-bg-input, #fff); color: var(--color-text-primary, #111); font: inherit; width: 100%; }
  .input::placeholder { color: var(--color-text-placeholder, #999); }
  .input:focus { border-color: var(--color-border-focus, #333); outline: none; box-shadow: 0 0 0 var(--focus-ring-width, 3px) var(--color-focus-ring, rgba(0,0,0,.15)); }
  .badge { display: inline-flex; align-items: center; height: var(--control-height-xs, 22px); padding: 0 var(--spacing-2, 8px); border-radius: var(--radius-full, 999px); font-size: var(--text-caption-size, 12px); font-weight: var(--font-weight-regular, 400); }
  .badge.success { background: var(--color-status-success-bg); color: var(--color-status-success); }
  .badge.warning { background: var(--color-status-warning-bg); color: var(--color-status-warning); }
  .badge.error { background: var(--color-status-error-bg); color: var(--color-status-error); }
  .badge.info { background: var(--color-status-info-bg); color: var(--color-status-info); }
  .badge.neutral { background: var(--color-status-neutral-bg); color: var(--color-status-neutral); }
  .tooltip { display: inline-block; background: var(--color-bg-inverse, #111); color: var(--color-text-inverse, #fff); padding: 6px 10px; border-radius: var(--radius-sm, 6px); font-size: var(--text-small-size, 12px); }
  .card-sample { border: var(--border-width-default, 1px) solid var(--color-border-default, #ddd); border-radius: var(--radius-lg, 12px); padding: var(--space-card, 24px); background: var(--color-bg-surface, #fff); box-shadow: 0 var(--elevation-card-y, 1px) var(--elevation-card-blur, 3px) var(--elevation-card-color, rgba(0,0,0,.06)); }
  .card-sample p { margin: 4px 0 0; color: var(--color-text-secondary, #444); }
  .card-sample small { display: block; margin-top: 8px; }
  a { color: var(--color-text-link, inherit); text-decoration: var(--text-link-decoration, underline); }
  a:hover { color: var(--color-text-link-hover, inherit); }
  .search { margin-bottom: 12px; }
</style>
</head>
<body>
<header>
  <h1>${escape(name)} · Token 预览板</h1>
  <span class="meta">${system.core.size} 个 Core token${system.themes.length ? ` · Theme：${system.themes.map((theme) => `${theme.id}（${theme.tokens.size} 条 delta）`).join("、")}` : " · 无 Theme"} · ${cssHref ? `样式来自 ${escape(cssHref)}` : "样式为内联解析值（构建后用 --css 指向 dist/index.css）"}</span>
  ${toggles}
</header>
<main>
  <section>
    <h2>组件样例 <small>只用语义变量拼出来的，缺角色会露出后备值 · 系统类型 ${profile}</small></h2>
    <div class="samples">
      ${profile === "brand" ? `<div class="sample-card">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <span style="font-weight:var(--text-weight-label);padding:4px 10px;border-bottom:2px solid var(--color-border-current)">导航当前项</span>
          <span style="font-weight:var(--text-weight-label);padding:4px 10px;background:var(--color-bg-hover);color:var(--color-text-on-primary)">导航 hover</span>
          <button class="btn primary" type="button">主 CTA</button>
          <button class="btn" type="button">次要按钮</button>
        </div>
        <div style="font-size:var(--text-display-size);line-height:var(--text-display-line-height);font-weight:var(--text-display-weight);color:var(--color-text-brand);font-family:var(--font-family-heading, inherit)">Hero 大字 · text.brand</div>
        <input class="input" placeholder="联系表单 · color.text.placeholder">
        <p>正文 <a href="#">内容型链接</a> · <span style="color:var(--color-text-secondary)">次要文字</span> · <span style="color:var(--color-text-muted)">弱化文字</span></p>
      </div>` : `<div class="sample-card">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn primary" type="button">主按钮</button>
          <button class="btn" type="button">次要按钮</button>
          <button class="btn quiet" type="button">文字按钮</button>
          <button class="btn danger" type="button">危险</button>
          <button class="btn primary" type="button" disabled>禁用</button>
        </div>
        <input class="input" placeholder="占位符 · color.text.placeholder">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <span class="badge success">已通过</span><span class="badge warning">待审批</span><span class="badge error">已驳回</span><span class="badge info">提示</span><span class="badge neutral">草稿</span>
        </div>
        <div><span class="tooltip">Tooltip · bg.inverse + text.inverse</span></div>
        <p>正文 <a href="#">内容型链接</a> · <span style="color:var(--color-text-secondary)">次要文字</span> · <span style="color:var(--color-text-muted)">弱化文字</span> · <span style="color:var(--color-text-danger)">危险文字</span></p>
      </div>`}
      <div class="sample-card">
        <div class="card-sample">
          <b style="font-size:var(--text-title-size);font-weight:var(--text-weight-strong)">卡片标题 · text.title</b>
          <p>bg.surface + border.default + elevation.card；内边距 space.card。</p>
          <small>说明文字 · text.small + text.muted</small>
        </div>
        <div class="card-sample" style="background:var(--color-bg-subtle)"><small>bg.subtle 浅分区底</small></div>
      </div>
    </div>
  </section>
  ${semanticColorSections}
  <section><h2>Primitive 色族 <small>${escape([...families.keys()].join(" / "))}</small></h2>${primitiveSections}</section>
  <section><h2>字号阶梯与字体</h2>${typeRows}${familyRows}${simpleTable(["font.weight", "text.weight", "text.display.weight", "font.line-height", "text.body.line-height", "text.heading.line-height", "text.paragraph", "text.display.line-height", "text.hero.line-height", "font.letter-spacing", "text.tracking", "text.display.tracking", "text.link", "text.numeric"])}</section>
  <section><h2>间距</h2>${dimensionLadder("spacing.", "px")}<h3>语义留白</h3>${dimensionLadder("space.", "px") || ["space.inline", "space.stack", "space.gutter", "space.card"].filter(has).map((tokenPath) => `<div class="ladder-row"><code>${tokenPath}</code><span class="px" style="--w:${v(tokenPath)}"></span><small>${escape(cssValueOf(resolveIn(system, tokenPath)))} → ${escape(aliasTarget(system.core.get(tokenPath).value))}</small></div>`).join("")}</section>
  <section><h2>圆角与线宽</h2><div class="grid">${radiusRows}</div><h3>线宽</h3>${dimensionLadder("border.width.", "bw")}</section>
  ${elevationRows ? `<section><h2>层级阴影</h2><div class="elevs">${elevationRows}</div></section>` : ""}
  <section><h2>控件 / 图标 / 布局尺寸</h2>${dimensionLadder("size.", "px")}</section>
  <section><h2>动效 · 层级 · 透明度 · 其他</h2>${simpleTable(["duration.", "motion.", "easing.", "z.", "layer.", "opacity.", "icon.", "stroke-width."])}</section>
  <section>
    <h2>全部 token <small>${paths.length}</small></h2>
    <input class="input search" id="q" placeholder="按路径过滤，例如 color.text 或 spacing">
    <table><thead><tr><th>路径</th><th>类型</th><th>别名</th><th>默认值</th>${themeHeaders}<th>说明</th></tr></thead><tbody id="rows">${detailRows}</tbody></table>
  </section>
</main>
<script>
  for (const button of document.querySelectorAll("header button[data-theme-id]")) {
    button.addEventListener("click", () => {
      const html = document.documentElement;
      const { themeId, kind, attribute } = button.dataset;
      if (kind === "class") html.classList.toggle(themeId);
      else if (kind === "data-attribute") html.getAttribute(attribute) === themeId ? html.removeAttribute(attribute) : html.setAttribute(attribute, themeId);
    });
  }
  document.getElementById("q").addEventListener("input", (event) => {
    const needle = event.target.value.trim().toLowerCase();
    for (const row of document.querySelectorAll("#rows tr")) row.hidden = needle ? !row.dataset.q.includes(needle) : false;
  });
</script>
</body>
</html>
`;
  await writeText(outFile, html);
  process.stdout.write(`${outFile}\n  ${system.core.size} 个 Core token · ${semantic.length} 个语义别名 · ${primitives.length} 个 Primitive${system.themes.length ? ` · Theme ${system.themes.map((theme) => theme.id).join(" / ")}` : ""}\n`);
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

#!/usr/bin/env node
// 取证：用 agent-browser 打开真实页面，在浏览器运行时里统计「能变成 token 的东西」——颜色（按 color / background / border 用途、
// 面积、文字量、所落底色）、字号 / 字重 / 行高 / 字距 / 字体族、间距、圆角、线宽、阴影、时长 / 缓动、z-index、透明度、控件高度、
// 图标尺寸、布局尺寸、断点、主题线索与根变量；再做暗色探测（系统偏好模拟 + class / data 属性切换）和悬停 / 焦点探针。
// 产物是一份 JSON 证据（默认写到系统临时目录），交给 draft-tokens.mjs 起草。不截图、不静态抓 HTML。
//
// 用法：node extract-evidence.mjs <url> [<url> …] [--out <file.json>] [--viewports 1440x900,1024x768,390x844]
//       [--no-dark] [--no-hover] [--no-responsive] [--max-nodes 5000] [--settle 800] [--session <name>] [--keep-open]

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { parseArgs, reportError } from "./lib/args.mjs";
import { isDark, parseCssColor } from "./lib/color.mjs";

const options = parseArgs(process.argv.slice(2));
const urls = options.positional.filter(Boolean);
if (urls.length === 0) {
  console.error("用法：node extract-evidence.mjs <url> [<url> …] [--out <file.json>] [--viewports 1440x900,1024x768,390x844] [--no-dark] [--no-hover] [--no-responsive]");
  process.exit(1);
}

const MAX_NODES = Number(options["max-nodes"] ?? 5000);
const SETTLE_MS = Number(options.settle ?? 800);
const viewports = String(options.viewports ?? "1440x900,1024x768,390x844")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry, index) => {
    const [width, height] = entry.split("x").map(Number);
    if (!width || !height) {
      throw new Error(`--viewports 里的 ${entry} 不是 <宽>x<高>`);
    }
    return { height, name: index === 0 ? "desktop" : width < 600 ? "mobile" : "tablet", width };
  });

const outFile = options.out
  ? path.resolve(process.cwd(), String(options.out))
  : path.join(os.tmpdir(), `w2ds-evidence-${Date.now()}.json`);

// ---------------------------------------------------------------------------------------------------------------------
// 浏览器侧探针（在页面里执行，返回 JSON 字符串）。__MODE__：full = 全量；colors = 只取颜色与根变量（暗色对照）；layout = 排版 + 布局（其他视口）。

const PROBE = String.raw`
(() => {
  const MAX_NODES = __MAX_NODES__;
  const MODE = "__MODE__";
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const px = (value) => { const n = parseFloat(value); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
  const isTransparent = (color) => {
    if (!color || color === "transparent") return true;
    const m = color.match(/\/\s*([0-9.]+)\s*\)$/) || color.match(/rgba\([^)]*,\s*([0-9.]+)\s*\)$/);
    return Boolean(m && parseFloat(m[1]) === 0);
  };
  const isVisible = (el, rect, s) => rect.width > 0 && rect.height > 0 && s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
  const bump = (map, key, meta) => {
    if (key === null || key === undefined || key === "") return;
    const k = String(key);
    const cur = map.get(k) || { key: k, count: 0 };
    cur.count += 1;
    if (meta) for (const [name, value] of Object.entries(meta)) {
      if (typeof value === "number") cur[name] = (cur[name] || 0) + value;
      else if (value !== undefined && value !== null) {
        cur[name] = cur[name] || {};
        cur[name][value] = (cur[name][value] || 0) + 1;
      }
    }
    map.set(k, cur);
  };
  const top = (map, limit, sort = (a, b) => b.count - a.count) => [...map.values()].sort(sort).slice(0, limit);
  const topKeys = (obj, limit = 6) => obj ? Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, limit)) : undefined;
  const bgCache = new Map();
  const effectiveBackground = (el) => {
    let node = el;
    while (node && node.nodeType === 1) {
      if (bgCache.has(node)) return bgCache.get(node);
      const bg = getComputedStyle(node).backgroundColor;
      if (!isTransparent(bg)) { bgCache.set(el, bg); return bg; }
      node = node.parentElement;
    }
    const rootBg = getComputedStyle(document.documentElement).backgroundColor;
    return isTransparent(rootBg) ? "rgb(255, 255, 255)" : rootBg;
  };
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
  const ownTextLength = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).reduce((sum, n) => sum + n.textContent.trim().length, 0);
  const BUTTON_CLASS = /(^|[\s_-])(btn|button|cta)([\s_-]|$)/i;
  const kindOf = (el, s) => {
    const tag = el.tagName.toLowerCase();
    const cls = typeof el.className === "string" ? el.className : "";
    const role = el.getAttribute("role");
    if (tag === "button" || role === "button" || (tag === "input" && /^(submit|button|reset)$/.test(el.type)) || (tag === "a" && BUTTON_CLASS.test(cls))) return "button";
    if ((tag === "input" && !/^(hidden|checkbox|radio|submit|button|reset|range|file|color)$/.test(el.type)) || tag === "textarea" || tag === "select") return "input";
    if (tag === "input" && /^(checkbox|radio)$/.test(el.type)) return "toggle";
    if (tag === "a") return "link";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "img" || tag === "picture" || tag === "video") return "media";
    if (tag === "svg") return "icon";
    if (tag === "header" || tag === "nav" || role === "banner" || role === "navigation") return "nav";
    if (tag === "aside" || role === "complementary") return "aside";
    if (tag === "footer" || role === "contentinfo") return "footer";
    if (tag === "table" || tag === "th" || tag === "td" || tag === "tr") return "table";
    if (/(^|[\s_-])(badge|tag|chip|pill|label)([\s_-]|$)/i.test(cls) && el.getBoundingClientRect().height < 40) return "badge";
    if (/(^|[\s_-])(card|panel|tile|box|item)([\s_-]|$)/i.test(cls) || (s.boxShadow !== "none" && el.children.length > 1)) return "card";
    if (tag === "p" || tag === "li" || tag === "span" || tag === "label" || tag === "small" || tag === "td" || tag === "dd" || tag === "dt" || tag === "blockquote" || tag === "figcaption") return "text";
    if (tag === "section" || tag === "main" || tag === "article") return "section";
    return "block";
  };

  const colors = new Map(), pairs = new Map(), fontSizes = new Map(), weights = new Map(), lineHeights = new Map(), letterSpacings = new Map(),
    families = new Map(), spacing = new Map(), radii = new Map(), borderWidths = new Map(), shadows = new Map(), durations = new Map(),
    timings = new Map(), zIndexes = new Map(), opacities = new Map(), svgSizes = new Map(), iconHints = new Map(), maxWidths = new Map(),
    decorations = new Map();
  const buttons = [], inputs = [], headings = [], links = [], cards = [], badges = [], tables = [];
  const seenButtonSignatures = new Set();

  let processed = 0;
  const all = document.querySelectorAll("body, body *");
  for (const el of all) {
    if (processed >= MAX_NODES) break;
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript" || tag === "template") continue;
    const rect = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (!isVisible(el, rect, s)) continue;
    processed += 1;
    const kind = kindOf(el, s);
    const own = hasOwnText(el);
    const textLen = own ? ownTextLength(el) : 0;
    const area = Math.round(rect.width * rect.height);

    // —— 颜色 ——
    if (own) {
      const bg = effectiveBackground(el);
      bump(colors, s.color, { text: textLen, kinds: kind, textCount: 1 });
      bump(pairs, s.color + " | " + bg, { text: textLen, kinds: kind, size: px(s.fontSize) >= 18.66 || (px(s.fontSize) >= 14 && parseInt(s.fontWeight, 10) >= 700) ? "large" : "normal" });
    }
    if (!isTransparent(s.backgroundColor)) bump(colors, s.backgroundColor, { bg: 1, area, kinds: kind });
    if (s.borderTopStyle !== "none" && px(s.borderTopWidth) > 0 && !isTransparent(s.borderTopColor)) {
      bump(colors, s.borderTopColor, { border: 1, kinds: kind });
      bump(borderWidths, px(s.borderTopWidth), { kinds: kind });
    }
    if (s.backgroundImage && s.backgroundImage !== "none" && /gradient/.test(s.backgroundImage)) bump(colors, "gradient:" + s.backgroundImage.slice(0, 160), { bg: 1, area, kinds: kind });

    if (MODE === "colors") continue;

    // —— 文字 ——
    if (own) {
      const size = px(s.fontSize);
      const weight = parseInt(s.fontWeight, 10);
      bump(fontSizes, size, { kinds: kind, text: textLen });
      bump(weights, weight, { kinds: kind });
      bump(families, s.fontFamily, { kinds: kind });
      const lh = px(s.lineHeight);
      if (lh && size) bump(lineHeights, Math.round((lh / size) * 100) / 100, { kinds: kind });
      if (s.letterSpacing && s.letterSpacing !== "normal" && size) bump(letterSpacings, Math.round((px(s.letterSpacing) / size) * 1000) / 1000, { kinds: kind });
      if (s.textDecorationLine && s.textDecorationLine !== "none") bump(decorations, s.textDecorationLine, { kinds: kind });
      if (s.textTransform && s.textTransform !== "none") bump(decorations, "transform:" + s.textTransform, { kinds: kind });
    }

    // —— 间距 / 圆角 / 阴影 / 动效 / 层级 / 透明度 ——
    for (const prop of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]) {
      const v = px(s[prop]); if (v && v > 0 && v <= 200) bump(spacing, v, { padding: 1, kinds: kind });
    }
    for (const prop of ["rowGap", "columnGap"]) {
      const v = px(s[prop]); if (v && v > 0 && v <= 200 && (s.display.includes("flex") || s.display.includes("grid"))) bump(spacing, v, { gap: 1, kinds: kind });
    }
    for (const prop of ["marginTop", "marginBottom"]) {
      const v = px(s[prop]); if (v && v > 0 && v <= 200) bump(spacing, v, { margin: 1, kinds: kind });
    }
    const radius = s.borderTopLeftRadius;
    if (radius && radius !== "0px") {
      const rv = radius.includes("%") ? "full" : px(radius);
      if (rv !== null) bump(radii, rv >= 999 || rv === "full" || (typeof rv === "number" && rv >= rect.height / 2 && rect.height <= 64) ? "full" : rv, { kinds: kind, raw: radius.includes("%") ? "percent" : undefined });
    }
    if (s.boxShadow && s.boxShadow !== "none") bump(shadows, s.boxShadow, { kinds: kind });
    if (s.transitionDuration && s.transitionDuration !== "0s") {
      for (const part of s.transitionDuration.split(",")) { const ms = Math.round(parseFloat(part) * (part.trim().endsWith("ms") ? 1 : 1000)); if (ms > 0) bump(durations, ms, { kinds: kind }); }
      for (const part of s.transitionTimingFunction.split(/,(?![^(]*\))/)) bump(timings, clean(part), { kinds: kind });
    }
    if (s.animationDuration && s.animationDuration !== "0s") for (const part of s.animationDuration.split(",")) { const ms = Math.round(parseFloat(part) * (part.trim().endsWith("ms") ? 1 : 1000)); if (ms > 0) bump(durations, ms, { animation: 1, kinds: kind }); }
    if (s.zIndex !== "auto" && s.position !== "static") bump(zIndexes, parseInt(s.zIndex, 10), { position: s.position, kinds: kind });
    if (s.opacity !== "1") bump(opacities, Math.round(parseFloat(s.opacity) * 100) / 100, { disabled: el.matches("[disabled], [aria-disabled='true'], .disabled, .is-disabled") ? 1 : 0, kinds: kind });
    if (s.maxWidth && s.maxWidth.endsWith("px") && px(s.maxWidth) >= 480 && Math.abs(rect.width - px(s.maxWidth)) < 2) bump(maxWidths, px(s.maxWidth), { kinds: kind });

    // —— 组件样本 ——
    if (kind === "button" && buttons.length < 40) {
      const sig = [s.backgroundColor, s.color, s.borderTopColor, Math.round(rect.height), s.fontSize, s.fontWeight, s.borderTopLeftRadius].join("|");
      if (!seenButtonSignatures.has(sig)) {
        seenButtonSignatures.add(sig);
        buttons.push({ text: clean(el.textContent).slice(0, 40), height: Math.round(rect.height), width: Math.round(rect.width), paddingX: px(s.paddingLeft), paddingY: px(s.paddingTop), radius: s.borderTopLeftRadius,
          fontSize: px(s.fontSize), fontWeight: parseInt(s.fontWeight, 10), background: s.backgroundColor, color: s.color, borderColor: s.borderTopColor, borderWidth: px(s.borderTopWidth), shadow: s.boxShadow, onBackground: effectiveBackground(el.parentElement || el), className: clean(el.className).slice(0, 80), tag });
      }
    } else if (kind === "input" && inputs.length < 16) {
      let placeholder = null; try { placeholder = getComputedStyle(el, "::placeholder").color; } catch (e) {}
      inputs.push({ type: el.type || tag, height: Math.round(rect.height), paddingX: px(s.paddingLeft), radius: s.borderTopLeftRadius, fontSize: px(s.fontSize), background: s.backgroundColor, color: s.color, placeholder,
        borderColor: s.borderTopColor, borderWidth: px(s.borderTopWidth), shadow: s.boxShadow, onBackground: effectiveBackground(el.parentElement || el) });
    } else if (kind === "heading" && headings.length < 24) {
      headings.push({ tag, text: clean(el.textContent).slice(0, 80), fontSize: px(s.fontSize), fontWeight: parseInt(s.fontWeight, 10), lineHeight: px(s.lineHeight), letterSpacing: s.letterSpacing, color: s.color, fontFamily: s.fontFamily.split(",")[0].trim().replace(/^['"]|['"]$/g, ""), onBackground: effectiveBackground(el) });
    } else if (kind === "link" && own && links.length < 24) {
      links.push({ text: clean(el.textContent).slice(0, 40), color: s.color, decoration: s.textDecorationLine, fontWeight: parseInt(s.fontWeight, 10), fontSize: px(s.fontSize), onBackground: effectiveBackground(el), inParagraph: Boolean(el.closest("p, li, td, dd")), inNav: Boolean(el.closest("nav, header, footer")) });
    } else if (kind === "card" && cards.length < 16 && area > 12000) {
      cards.push({ background: s.backgroundColor, borderColor: s.borderTopStyle !== "none" ? s.borderTopColor : null, borderWidth: px(s.borderTopWidth), radius: s.borderTopLeftRadius, shadow: s.boxShadow, padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(px), width: Math.round(rect.width), onBackground: effectiveBackground(el.parentElement || el), className: clean(el.className).slice(0, 80) });
    } else if (kind === "badge" && badges.length < 16) {
      badges.push({ text: clean(el.textContent).slice(0, 24), background: s.backgroundColor, color: s.color, borderColor: s.borderTopStyle !== "none" ? s.borderTopColor : null, radius: s.borderTopLeftRadius, height: Math.round(rect.height), fontSize: px(s.fontSize), fontWeight: parseInt(s.fontWeight, 10), paddingX: px(s.paddingLeft), className: clean(el.className).slice(0, 60) });
    } else if (tag === "th" || tag === "td") {
      if (tables.length < 12) tables.push({ tag, paddingY: px(s.paddingTop), paddingX: px(s.paddingLeft), background: s.backgroundColor, color: s.color, fontSize: px(s.fontSize), fontWeight: parseInt(s.fontWeight, 10), borderBottom: s.borderBottomStyle !== "none" ? s.borderBottomColor : null });
    } else if (kind === "icon") {
      bump(svgSizes, Math.round(rect.width) + "x" + Math.round(rect.height), { kinds: kindOf(el.parentElement || el, getComputedStyle(el.parentElement || el)) });
      const sw = el.getAttribute("stroke-width") || (el.querySelector("[stroke-width]") || {}).getAttribute?.("stroke-width");
      if (sw) bump(iconHints, "stroke-width:" + sw);
      const cls = clean(el.getAttribute("class") || "") + " " + clean((el.parentElement && el.parentElement.className) || "");
      for (const lib of ["lucide", "i-icon", "iconpark", "anticon", "el-icon", "material", "fa-", "heroicon", "tabler", "phosphor", "remix", "feather", "octicon"]) if (cls.toLowerCase().includes(lib)) bump(iconHints, "lib:" + lib);
      if (el.getAttribute("fill") === "none" || el.querySelector("path[fill='none'], path:not([fill])")) bump(iconHints, "style:outline"); else bump(iconHints, "style:filled");
    }
  }

  // —— 布局 ——
  const layout = {};
  const header = [...document.querySelectorAll("header, nav, [role=banner]")].find((el) => { const r = el.getBoundingClientRect(); return r.width > innerWidth * 0.6 && r.height > 0 && r.top < 200; });
  if (header) { const hs = getComputedStyle(header); const hr = header.getBoundingClientRect(); layout.header = { height: Math.round(hr.height), position: hs.position, background: hs.backgroundColor, borderBottom: hs.borderBottomStyle !== "none" ? hs.borderBottomColor : null, shadow: hs.boxShadow, backdrop: hs.backdropFilter || hs.webkitBackdropFilter || "none" }; }
  const side = [...document.querySelectorAll("aside, nav, [class*='sidebar'], [class*='side-nav'], [class*='sidenav']")].find((el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.height > innerHeight * 0.5 && r.width > 48 && r.width < 420 && (st.position === "fixed" || st.position === "sticky" || r.left < 8); });
  if (side) { const ss = getComputedStyle(side); layout.sidebar = { width: Math.round(side.getBoundingClientRect().width), background: ss.backgroundColor, borderRight: ss.borderRightStyle !== "none" ? ss.borderRightColor : null }; }
  layout.containerMaxWidths = top(maxWidths, 6);
  layout.sections = [...document.querySelectorAll("main > *, body > section, section")].filter((el) => { const r = el.getBoundingClientRect(); return r.height > 80 && r.width > innerWidth * 0.5; }).slice(0, 16).map((el) => { const st = getComputedStyle(el); return { tag: el.tagName.toLowerCase(), paddingTop: px(st.paddingTop), paddingBottom: px(st.paddingBottom), paddingLeft: px(st.paddingLeft), background: st.backgroundColor, text: clean(el.textContent).slice(0, 60) }; });
  layout.body = { background: getComputedStyle(document.body).backgroundColor, color: getComputedStyle(document.body).color, fontSize: px(getComputedStyle(document.body).fontSize), fontFamily: getComputedStyle(document.body).fontFamily, lineHeight: getComputedStyle(document.body).lineHeight, rootFontSize: px(getComputedStyle(document.documentElement).fontSize), rootBackground: getComputedStyle(document.documentElement).backgroundColor, fontSmoothing: getComputedStyle(document.body).webkitFontSmoothing || null };

  // —— 样式表：断点 + 主题线索 + 焦点规则 ——
  const breakpoints = new Map(); const themeSelectors = new Map(); const focusRules = []; let rulesScanned = 0; let inaccessibleSheets = 0;
  const THEME_MARK = /\.dark\b|\.light\b|\[data-theme|\[data-mode|\[data-color-mode|\[data-color-scheme|\.theme-dark|\.theme-light|\.dark-mode|\.night/;
  const walkRules = (rules, media) => {
    for (const rule of rules) {
      if (rulesScanned++ > 20000) return;
      if (rule.type === 4) { // CSSMediaRule
        const text = rule.conditionText || rule.media.mediaText;
        for (const m of text.matchAll(/(min|max)-width:\s*([0-9.]+)(px|em|rem)/g)) bump(breakpoints, (m[3] === "px" ? Math.round(parseFloat(m[2])) : Math.round(parseFloat(m[2]) * 16)) + "px", { bound: m[1] });
        if (/prefers-color-scheme\s*:\s*dark/.test(text)) bump(themeSelectors, "@media (prefers-color-scheme: dark)");
        if (/prefers-reduced-motion/.test(text)) bump(themeSelectors, "@media (prefers-reduced-motion)");
        walkRules(rule.cssRules || [], text); continue;
      }
      if (rule.cssRules && rule.type !== 1) { walkRules(rule.cssRules, media); continue; }
      const sel = rule.selectorText; if (!sel) continue;
      const tm = sel.match(THEME_MARK); if (tm) bump(themeSelectors, tm[0]);
      if (/:focus-visible|:focus(?!-within)/.test(sel) && focusRules.length < 12) { const st = rule.style; focusRules.push({ selector: sel.slice(0, 120), outline: st.outline || [st.outlineWidth, st.outlineStyle, st.outlineColor].filter(Boolean).join(" "), outlineOffset: st.outlineOffset, boxShadow: st.boxShadow, borderColor: st.borderColor }); }
      if (rule.cssRules && rule.cssRules.length) walkRules(rule.cssRules, media); // CSS 嵌套（Tailwind v4 的 &:is(.dark *)）
    }
  };
  for (const sheet of document.styleSheets) { try { walkRules(sheet.cssRules, null); } catch (e) { inaccessibleSheets += 1; } }

  // —— 根变量 / 主题状态 / 切换控件 ——
  const rootStyle = getComputedStyle(document.documentElement);
  const rootVariables = {}; let varCount = 0;
  for (const name of rootStyle) { if (name.startsWith("--") && varCount < 400) { const v = clean(rootStyle.getPropertyValue(name)); if (v) { rootVariables[name] = v.slice(0, 120); varCount += 1; } } }
  const html = document.documentElement;
  const toggles = [...document.querySelectorAll("button, a, [role=switch], [role=button], input[type=checkbox]")].filter((el) => /theme|dark|light|night|appearance|主题|暗色|夜间|深色|浅色|外观/i.test((el.getAttribute("aria-label") || "") + " " + (el.getAttribute("title") || "") + " " + clean(el.textContent).slice(0, 40) + " " + (el.className || ""))).slice(0, 6).map((el) => ({ tag: el.tagName.toLowerCase(), text: clean(el.textContent).slice(0, 40), ariaLabel: el.getAttribute("aria-label"), className: clean(el.className).slice(0, 80) }));
  const themeHints = { htmlClass: clean(html.className), htmlData: Object.fromEntries([...html.attributes].filter((a) => a.name.startsWith("data-")).map((a) => [a.name, a.value.slice(0, 40)])), bodyClass: clean(document.body.className), bodyData: Object.fromEntries([...document.body.attributes].filter((a) => a.name.startsWith("data-")).map((a) => [a.name, a.value.slice(0, 40)])), colorScheme: rootStyle.colorScheme, metaThemeColor: [...document.querySelectorAll("meta[name=theme-color]")].map((m) => m.content), selectors: top(themeSelectors, 12), toggles };

  const texts = { headlines: [...document.querySelectorAll("h1, h2")].map((el) => clean(el.textContent)).filter(Boolean).slice(0, 10), ctas: [...document.querySelectorAll("button, a")].filter((el) => kindOf(el, getComputedStyle(el)) === "button").map((el) => clean(el.textContent)).filter((t) => t && t.length < 40).slice(0, 12) };

  const out = {
    mode: MODE, title: document.title, url: location.href, lang: html.lang || null, viewport: { width: innerWidth, height: innerHeight }, documentHeight: html.scrollHeight, nodesProcessed: processed, nodesTotal: all.length,
    colors: top(colors, 120).map((c) => ({ ...c, kinds: topKeys(c.kinds) })),
    pairs: top(pairs, 80).map((p) => ({ ...p, kinds: topKeys(p.kinds), size: topKeys(p.size) })),
    layout: { body: layout.body, header: layout.header, sidebar: layout.sidebar },
    themeHints, rootVariables
  };
  if (MODE !== "colors") Object.assign(out, {
    fontSizes: top(fontSizes, 24).map((f) => ({ ...f, kinds: topKeys(f.kinds) })), weights: top(weights, 8).map((w) => ({ ...w, kinds: topKeys(w.kinds) })), lineHeights: top(lineHeights, 12).map((l) => ({ ...l, kinds: topKeys(l.kinds) })),
    letterSpacings: top(letterSpacings, 8).map((l) => ({ ...l, kinds: topKeys(l.kinds) })), families: top(families, 8).map((f) => ({ ...f, kinds: topKeys(f.kinds) })), decorations: top(decorations, 8).map((d) => ({ ...d, kinds: topKeys(d.kinds) })),
    spacing: top(spacing, 40).map((v) => ({ ...v, kinds: topKeys(v.kinds) })), radii: top(radii, 16).map((r) => ({ ...r, kinds: topKeys(r.kinds) })), borderWidths: top(borderWidths, 8).map((b) => ({ ...b, kinds: topKeys(b.kinds) })),
    shadows: top(shadows, 14).map((s) => ({ ...s, kinds: topKeys(s.kinds) })), durations: top(durations, 12).map((d) => ({ ...d, kinds: topKeys(d.kinds) })), timings: top(timings, 8).map((t) => ({ ...t, kinds: topKeys(t.kinds) })),
    zIndexes: top(zIndexes, 12).map((z) => ({ ...z, kinds: topKeys(z.kinds), position: topKeys(z.position) })), opacities: top(opacities, 8).map((o) => ({ ...o, kinds: topKeys(o.kinds) })),
    icons: { sizes: top(svgSizes, 10).map((i) => ({ ...i, kinds: topKeys(i.kinds) })), hints: top(iconHints, 10) },
    components: { buttons, inputs, headings, links, cards, badges, tables },
    layout: { ...out.layout, containerMaxWidths: layout.containerMaxWidths, sections: layout.sections },
    stylesheets: { breakpoints: top(breakpoints, 12).map((b) => ({ ...b, bound: topKeys(b.bound) })), focusRules, rulesScanned, inaccessibleSheets, count: document.styleSheets.length },
    texts
  });
  return JSON.stringify(out);
})()
`;

const HOVER_MARK = String.raw`
(() => {
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const style = document.createElement("style"); style.id = "__w2ds_notransition"; style.textContent = "*, *::before, *::after { transition-duration: 0s !important; transition-delay: 0s !important; animation-duration: 0s !important; }"; document.head.appendChild(style);
  const BUTTON_CLASS = /(^|[\s_-])(btn|button|cta)([\s_-]|$)/i;
  const isVisible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden"; };
  const candidates = [...document.querySelectorAll("button, a[href], [role=button], input[type=submit]")].filter(isVisible);
  const seen = new Set(); const picked = [];
  const order = [(el) => el.tagName === "BUTTON" || el.getAttribute("role") === "button" || BUTTON_CLASS.test(el.className || ""), (el) => Boolean(el.closest("nav, header")), () => true];
  for (const pass of order) for (const el of candidates) {
    if (picked.length >= 8 || picked.includes(el) || !pass(el)) continue;
    const text = clean(el.textContent).slice(0, 40); const s = getComputedStyle(el);
    const sig = text + "|" + s.backgroundColor + "|" + s.color; if (!text || seen.has(sig)) continue; seen.add(sig); picked.push(el);
  }
  const read = (el) => { const s = getComputedStyle(el); return { color: s.color, background: s.backgroundColor, borderColor: parseFloat(s.borderTopWidth) > 0 ? s.borderTopColor : "none", shadow: s.boxShadow, decoration: s.textDecorationLine, transform: s.transform, opacity: s.opacity, outline: s.outlineStyle !== "none" ? [s.outlineWidth, s.outlineStyle, s.outlineColor].join(" ") : "none", outlineOffset: s.outlineOffset }; };
  return JSON.stringify(picked.map((el, i) => { el.setAttribute("data-w2ds-probe", String(i)); return { index: i, text: clean(el.textContent).slice(0, 40), tag: el.tagName.toLowerCase(), className: clean(el.className).slice(0, 60), before: read(el) }; }));
})()
`;

const HOVER_READ = (index) => String.raw`
(() => { const el = document.querySelector('[data-w2ds-probe="${index}"]'); if (!el) return JSON.stringify(null); el.scrollIntoView({ block: "center" }); const s = getComputedStyle(el);
  return JSON.stringify({ color: s.color, background: s.backgroundColor, borderColor: parseFloat(s.borderTopWidth) > 0 ? s.borderTopColor : "none", shadow: s.boxShadow, decoration: s.textDecorationLine, transform: s.transform, opacity: s.opacity, outline: s.outlineStyle !== "none" ? [s.outlineWidth, s.outlineStyle, s.outlineColor].join(" ") : "none", outlineOffset: s.outlineOffset, focused: document.activeElement === el }); })()
`;

const HOVER_CLEANUP = String.raw`
(() => { document.getElementById("__w2ds_notransition")?.remove(); for (const el of document.querySelectorAll("[data-w2ds-probe]")) el.removeAttribute("data-w2ds-probe"); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return JSON.stringify(true); })()
`;

// 切换另一模式：data 属性直接改值；class 方式加目标类的同时摘掉互斥类（next-themes 会在 html 上放 light / dark），revert 时原样还回。
const TOGGLE_CLASS = (mode, token, attribute) => String.raw`
(() => { const html = document.documentElement; const attr = ${JSON.stringify(attribute || null)}; const token = ${JSON.stringify(token)}; const apply = ${JSON.stringify(mode)} === "apply";
  const counterparts = { dark: ["light", "theme-light", "light-mode"], light: ["dark", "theme-dark", "dark-mode", "night"] }[token.replace(/^theme-|-mode$/g, "")] || [];
  if (attr) { if (apply) { html.setAttribute("__w2ds_prev", html.getAttribute(attr) || ""); html.setAttribute(attr, token); } else { const prev = html.getAttribute("__w2ds_prev"); if (prev) html.setAttribute(attr, prev); else html.removeAttribute(attr); html.removeAttribute("__w2ds_prev"); } }
  else if (apply) { const removed = counterparts.filter((cls) => html.classList.contains(cls)); html.setAttribute("__w2ds_removed", removed.join(" ")); for (const cls of removed) html.classList.remove(cls); html.classList.add(token); }
  else { html.classList.remove(token); for (const cls of (html.getAttribute("__w2ds_removed") || "").split(" ").filter(Boolean)) html.classList.add(cls); html.removeAttribute("__w2ds_removed"); }
  return JSON.stringify({ htmlClass: html.className, attr: attr ? html.getAttribute(attr) : null }); })()
`;

// ---------------------------------------------------------------------------------------------------------------------
// agent-browser 驱动

function which(binary) {
  const result = spawnSync("bash", ["-lc", `command -v ${binary}`], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim().split("\n")[0] : null;
}

const agentBrowser = which("agent-browser");
if (!agentBrowser) {
  console.error("找不到 agent-browser：本 skill 只用它取证，不回退到静态抓取。先安装 / 暴露到 PATH（agent-browser --help 能跑）再重试。");
  process.exit(2);
}

const session = String(options.session ?? `w2ds-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`);

function ab(args, { input, allowFailure = false } = {}) {
  const result = spawnSync(agentBrowser, ["--session", session, ...args], { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  const ok = result.status === 0;
  if (!ok && !allowFailure) {
    throw new Error(`agent-browser ${args.slice(0, 2).join(" ")} 失败：${(result.stderr || result.stdout || "").trim().slice(0, 600)}`);
  }
  return { ok, stderr: (result.stderr || "").trim(), stdout: (result.stdout || "").trim() };
}

function evalJson(expression, { allowFailure = false } = {}) {
  const result = ab(["eval", "--stdin"], { allowFailure, input: `${expression}\n` });
  if (!result.ok) {
    return null;
  }
  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      let parsed = JSON.parse(lines[index]);
      if (typeof parsed === "string") {
        parsed = JSON.parse(parsed);
      }
      return parsed;
    } catch {
      // 继续往上找
    }
  }
  try {
    let parsed = JSON.parse(result.stdout);
    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed);
    }
    return parsed;
  } catch {
    if (allowFailure) {
      return null;
    }
    throw new Error(`agent-browser eval 没有返回 JSON：${result.stdout.slice(-400)}`);
  }
}

function wait(ms) {
  ab(["wait", String(ms)], { allowFailure: true });
}

function settle() {
  ab(["wait", "--load", "networkidle"], { allowFailure: true });
  wait(SETTLE_MS);
}

function scrollSweep() {
  const height = Number(evalJson("JSON.stringify(document.documentElement.scrollHeight)", { allowFailure: true })) || 4000;
  const step = 900;
  const steps = Math.min(14, Math.ceil(height / step));
  for (let index = 1; index <= steps; index += 1) {
    evalJson(`(() => { window.scrollTo(0, ${index * step}); return JSON.stringify(true); })()`, { allowFailure: true });
    wait(120);
  }
  evalJson("(() => { window.scrollTo(0, 0); return JSON.stringify(true); })()", { allowFailure: true });
  wait(250);
}

function probe(mode) {
  return evalJson(PROBE.replace("__MAX_NODES__", String(MAX_NODES)).replace("__MODE__", mode));
}

/** 页面明暗：body / html 背景 → 面积最大的不透明底色 → 正文文字色反推（深字 = 亮色页）。很多站点 body 是透明的，底色画在某个 wrapper 上。 */
function pageScheme(probeResult) {
  const bodyBg = parseCssColor(probeResult?.layout?.body?.background) || parseCssColor(probeResult?.layout?.body?.rootBackground);
  if (bodyBg && bodyBg.a > 0) {
    return isDark(bodyBg) ? "dark" : "light";
  }
  const largest = (probeResult?.colors ?? [])
    .filter((entry) => entry.bg > 0 && !entry.key.startsWith("gradient:"))
    .map((entry) => ({ area: entry.area ?? 0, rgba: parseCssColor(entry.key) }))
    .filter((entry) => entry.rgba && entry.rgba.a >= 0.9)
    .sort((left, right) => right.area - left.area)[0];
  if (largest) {
    return isDark(largest.rgba) ? "dark" : "light";
  }
  const text = parseCssColor(probeResult?.layout?.body?.color);
  return text && !isDark(text) ? "dark" : "light";
}

function detectClassToggle(themeHints) {
  const selectors = (themeHints?.selectors ?? []).map((entry) => entry.key);
  const attr = selectors.find((selector) => /^\[data-/.test(selector));
  if (attr) {
    const attribute = attr.slice(1).replace(/[=\]].*$/, "");
    return { attribute, token: "dark" };
  }
  const cls = selectors.find((selector) => /^\.(dark|theme-dark|dark-mode|night)$/.test(selector));
  if (cls) {
    return { attribute: null, token: cls.slice(1) };
  }
  return null;
}

function hoverAndFocusProbes() {
  const marked = evalJson(HOVER_MARK, { allowFailure: true });
  if (!Array.isArray(marked) || marked.length === 0) {
    return { focus: [], hover: [] };
  }
  const hover = [];
  const focus = [];
  for (const entry of marked) {
    const selector = `[data-w2ds-probe="${entry.index}"]`;
    ab(["scrollintoview", selector], { allowFailure: true });
    const hovered = ab(["hover", selector], { allowFailure: true });
    wait(180);
    const after = hovered.ok ? evalJson(HOVER_READ(entry.index), { allowFailure: true }) : null;
    if (after) {
      const changed = Object.keys(after).filter((key) => key !== "focused" && after[key] !== entry.before[key]);
      hover.push({ ...entry, after, changed });
    }
    ab(["hover", "body"], { allowFailure: true });
    const focused = ab(["focus", selector], { allowFailure: true });
    wait(120);
    const focusState = focused.ok ? evalJson(HOVER_READ(entry.index), { allowFailure: true }) : null;
    if (focusState?.focused) {
      const changed = Object.keys(focusState).filter((key) => key !== "focused" && focusState[key] !== entry.before[key]);
      focus.push({ index: entry.index, text: entry.text, tag: entry.tag, before: entry.before, after: focusState, changed });
    }
    evalJson("(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); return JSON.stringify(true); })()", { allowFailure: true });
  }
  evalJson(HOVER_CLEANUP, { allowFailure: true });
  return { focus, hover };
}

async function extractOne(url) {
  const entry = { interactions: null, modes: {}, url, viewports: {} };
  const [desktop, ...others] = viewports;
  ab(["set", "viewport", String(desktop.width), String(desktop.height)]);
  ab(["set", "media", "light"], { allowFailure: true });
  ab(["open", url]);
  settle();
  scrollSweep();

  const full = probe("full");
  entry.title = full.title;
  entry.finalUrl = full.url;
  entry.lang = full.lang;
  entry.viewports[desktop.name] = { ...full, viewportName: desktop.name, width: desktop.width, height: desktop.height };
  const initialScheme = pageScheme(full);
  entry.modes.initial = { scheme: initialScheme, source: "first-load" };

  if (options["no-dark"] !== true) {
    const wanted = initialScheme === "dark" ? "light" : "dark";
    // 1) 系统偏好模拟
    ab(["set", "media", wanted], { allowFailure: true });
    ab(["reload"], { allowFailure: true });
    settle();
    const mediaProbe = probe("colors");
    const mediaScheme = pageScheme(mediaProbe);
    entry.modes[`media-${wanted}`] = { changed: mediaScheme !== initialScheme, probe: mediaProbe, scheme: mediaScheme, source: `set media ${wanted} + reload` };
    ab(["set", "media", initialScheme], { allowFailure: true });
    ab(["reload"], { allowFailure: true });
    settle();
    // 2) class / data 属性切换（有选择器证据时）
    const toggle = detectClassToggle(full.themeHints);
    if (toggle) {
      const applied = evalJson(TOGGLE_CLASS("apply", toggle.token, toggle.attribute), { allowFailure: true });
      wait(250);
      const classProbe = probe("colors");
      const classScheme = pageScheme(classProbe);
      entry.modes[`toggle-${toggle.token}`] = { activation: toggle.attribute ? { attribute: toggle.attribute, kind: "data-attribute" } : { kind: "class" }, applied, changed: classScheme !== initialScheme, probe: classProbe, scheme: classScheme, source: toggle.attribute ? `html[${toggle.attribute}="${toggle.token}"]` : `html.${toggle.token}` };
      evalJson(TOGGLE_CLASS("revert", toggle.token, toggle.attribute), { allowFailure: true });
      wait(150);
    }
  }

  if (options["no-hover"] !== true) {
    entry.interactions = hoverAndFocusProbes();
  }

  if (options["no-responsive"] !== true) {
    for (const viewport of others) {
      ab(["set", "viewport", String(viewport.width), String(viewport.height)], { allowFailure: true });
      wait(400);
      evalJson("(() => { window.scrollTo(0, 0); return JSON.stringify(true); })()", { allowFailure: true });
      const layoutProbe = probe("layout");
      entry.viewports[viewport.name] = { ...layoutProbe, viewportName: viewport.name, width: viewport.width, height: viewport.height };
    }
    ab(["set", "viewport", String(desktop.width), String(desktop.height)], { allowFailure: true });
  }
  return entry;
}

async function main() {
  const started = Date.now();
  const results = { extractedAt: new Date().toISOString(), pages: [], tooling: { agentBrowser, session, viewports }, version: 1 };
  try {
    for (const url of urls) {
      process.stderr.write(`取证 ${url}\n`);
      results.pages.push(await extractOne(url));
    }
  } finally {
    if (options["keep-open"] !== true) {
      ab(["close"], { allowFailure: true });
    }
  }
  results.tooling.elapsedMs = Date.now() - started;
  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  await fsp.writeFile(outFile, JSON.stringify(results, null, 2));
  const summary = results.pages.map((page) => {
    const desktop = Object.values(page.viewports)[0];
    const modes = Object.entries(page.modes).filter(([key, value]) => key !== "initial" && value.changed).map(([key]) => key);
    return `  ${page.url} → ${desktop?.colors?.length ?? 0} 色 · ${desktop?.fontSizes?.length ?? 0} 档字号 · 首屏 ${page.modes.initial?.scheme}${modes.length ? ` · 另一模式可得：${modes.join(", ")}` : " · 未发现另一模式"} · 悬停样本 ${page.interactions?.hover?.length ?? 0}`;
  });
  process.stdout.write(`${outFile}\n${summary.join("\n")}\n`);
}

main().catch((error) => {
  reportError(error);
  if (options["keep-open"] !== true) {
    ab(["close"], { allowFailure: true });
  }
  process.exitCode = 2;
});

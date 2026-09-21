#!/usr/bin/env node
// 起草：把 extract-evidence 的证据 JSON 变成一份符合本仓库 token 规范的草稿——
//   tokens/primitives.tokens.json    值：按 OKLCH 色族 / 明度分档命名的颜色，spacing 按 4px 阶梯命名，radius / font / size / border / shadow / duration / easing / z / opacity
//   tokens/semantic.tokens.json      用途：按 references/semantic-roles.md 的角色词表起别名；$description 以 [观察] / [推断] 开头写明证据
//   themes/<id>/tokens/semantic.tokens.json + theme-map.json   只有取证时真的拿到另一模式（系统偏好或 class / data 切换生效）才生成
//   audit-summary.md                 给人和 Agent 看的证据摘要 + 角色覆盖率 + 缺口清单
//   draft-notes.json                 机器可读：每个角色的来源与证据、缺口、警告
// 草稿不是终稿：Agent 要按 semantic-roles.md 逐角色核对，补齐缺口、纠正判断，再 scaffold-system.mjs 写入并交给 steward 校验。
//
// 用法：node draft-tokens.mjs --evidence <file.json> --out <dir> [--id <system-id>] [--name <名称>] [--min-count 2] [--brand #hex] [--fill inferred|observed]

import path from "node:path";

import { parseArgs, printJson, readJson, reportError, requireAbsolutePath, requireStringOption, writeJson, writeText } from "./lib/args.mjs";
import { contrastRatio, hueFamily, isDark, parseCssColor, rgbaToOklch, toHex } from "./lib/color.mjs";
import { aliasToken, colorToken, cubicBezierToken, dimensionToken, durationToken, fontFamilyToken, fontWeightToken, hasPath, numberToken, setPath, sortTokenTree, stringToken } from "./lib/dtcg.mjs";
import { desktopProbe, detectBaseUnit, isMonoStack, kindScore, mergeColors, mergeCounts, mergePairs, parseBoxShadow, parseFontFamily, parseTimingFunction } from "./lib/evidence.mjs";
import { detectBrandFamily, Palette } from "./lib/palette.mjs";
import { ROLE_BY_PATH, ROLES } from "./lib/roles.mjs";

const OBSERVED = "[观察]";
const INFERRED = "[推断]";

class Draft {
  constructor({ allowInferred = true } = {}) {
    this.allowInferred = allowInferred;
    this.primitives = {};
    this.semantic = {};
    this.theme = {};
    this.notes = { missing: [], roles: {}, warnings: [] };
  }

  primitive(tokenPath, token) {
    if (!hasPath(this.primitives, tokenPath)) {
      setPath(this.primitives, tokenPath, token);
    }
    return tokenPath;
  }

  /** 语义别名；同一角色只登记一次（先到先得——观察在前、推断在后由调用顺序保证）。target 为空、或 --fill observed 下的推断项，静默跳过。 */
  role(tokenPath, type, target, { source, evidence }) {
    if (hasPath(this.semantic, tokenPath) || !target || (source === "inferred" && !this.allowInferred)) {
      return false;
    }
    const meta = ROLE_BY_PATH.get(tokenPath);
    setPath(this.semantic, tokenPath, aliasToken(type, target, `${source === "observed" ? OBSERVED : INFERRED} ${evidence}`.trim()));
    this.notes.roles[tokenPath] = { evidence, source, target, tier: meta?.tier ?? "custom" };
    return true;
  }

  target(tokenPath) {
    return this.notes.roles[tokenPath]?.target ?? null;
  }

  themeRole(tokenPath, type, target, evidence) {
    if (hasPath(this.theme, tokenPath) || !target || this.target(tokenPath) === target) {
      return false;
    }
    setPath(this.theme, tokenPath, aliasToken(type, target, `${OBSERVED} ${evidence}`.trim()));
    return true;
  }

  warn(message) {
    this.notes.warnings.push(message);
  }
}

const mostCommon = (values) => {
  const counts = new Map();
  for (const value of values) {
    if (value !== null && value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
};

function countTokens(tree, prefix = "", acc = {}) {
  for (const [key, value] of Object.entries(tree)) {
    if (key.startsWith("$")) continue;
    if (value && typeof value === "object" && Object.hasOwn(value, "$value")) acc[`${prefix}${key}`] = true;
    else if (value && typeof value === "object") countTokens(value, `${prefix}${key}.`, acc);
  }
  return Object.keys(acc).length;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const evidencePath = requireAbsolutePath(path.resolve(process.cwd(), requireStringOption(options, "evidence")), "--evidence");
  const outDir = requireAbsolutePath(path.resolve(process.cwd(), requireStringOption(options, "out")), "--out");
  const MIN_COUNT = Number(options["min-count"] ?? 2);
  const FILL_INFERRED = (options.fill ?? "inferred") !== "observed";
  const systemId = String(options.id ?? "extracted");
  const systemName = String(options.name ?? systemId);

  // -------------------------------------------------------------------------------------------------------------------
  // 读证据、合并

  const evidence = await readJson(evidencePath);
  const pages = evidence.pages ?? [];
  if (pages.length === 0) {
    throw new Error("证据里没有页面（pages 为空）");
  }
  const probes = pages.map(desktopProbe).filter(Boolean);
  const primary = probes[0];
  const { colors, gradients } = mergeColors(probes);
  const mergedInto = new Map();
  for (const color of colors.values()) {
    for (const merged of color.merged ?? []) mergedInto.set(merged, color.hex);
  }
  const canonical = (hex) => mergedInto.get(hex) ?? hex;
  const pairs = mergePairs(probes, canonical);
  const components = { badges: [], buttons: [], cards: [], headings: [], inputs: [], links: [], tables: [] };
  for (const probe of probes) {
    for (const key of Object.keys(components)) components[key].push(...(probe.components?.[key] ?? []));
  }
  const interactions = { focus: [], hover: [] };
  for (const page of pages) {
    interactions.hover.push(...(page.interactions?.hover ?? []));
    interactions.focus.push(...(page.interactions?.focus ?? []));
  }
  const rootVariables = Object.assign({}, ...probes.map((probe) => probe.rootVariables ?? {}));
  const stats = {
    borderWidths: mergeCounts(probes, "borderWidths"),
    decorations: mergeCounts(probes, "decorations", { numeric: false }),
    durations: mergeCounts(probes, "durations"),
    families: mergeCounts(probes, "families", { numeric: false }),
    fontSizes: mergeCounts(probes, "fontSizes"),
    letterSpacings: mergeCounts(probes, "letterSpacings"),
    lineHeights: mergeCounts(probes, "lineHeights"),
    opacities: mergeCounts(probes, "opacities"),
    radii: mergeCounts(probes, "radii", { numeric: false }),
    shadows: mergeCounts(probes, "shadows", { numeric: false }),
    spacing: mergeCounts(probes, "spacing"),
    timings: mergeCounts(probes, "timings", { numeric: false }),
    weights: mergeCounts(probes, "weights"),
    zIndexes: mergeCounts(probes, "zIndexes")
  };
  const iconSizes = mergeCounts(probes.map((probe) => ({ sizes: probe.icons?.sizes ?? [] })), "sizes", { numeric: false });
  const iconHints = mergeCounts(probes.map((probe) => ({ hints: probe.icons?.hints ?? [] })), "hints", { numeric: false });
  const breakpoints = mergeCounts(probes.map((probe) => ({ breakpoints: probe.stylesheets?.breakpoints ?? [] })), "breakpoints", { numeric: false });
  const focusRules = probes.flatMap((probe) => probe.stylesheets?.focusRules ?? []);
  const viewportArea = (primary.viewport?.width ?? 1440) * (primary.viewport?.height ?? 900);

  // 单位：根字号明显偏离 16px 的站点（vw 缩放的 rem 方案，html { font-size: 100vw / N }）按 px 起草没有意义——尺寸类 token 换算成 rem，
  // 并把桌面视口下的根字号记成 Primitive；边线宽、断点、焦点环仍用 px。--unit px|rem|auto（默认 auto）
  const rootFontSize = Number(primary.layout?.body?.rootFontSize) || 16;
  const rootByPage = evidence.pages.map((page) => ({ root: Number(Object.values(page.viewports)[0]?.layout?.body?.rootFontSize) || 16, url: page.url }));
  const rootOutliers = rootByPage.filter((page) => Math.abs(page.root - rootFontSize) / rootFontSize > 0.05);
  const rootWarning = rootOutliers.length
    ? `各页根字号不一致：${rootByPage.map((page) => `${page.root}px ← ${page.url}`).join("；")}——同一站点根字号应相同，多半是站点的 resize 脚本在探针切换视口后算错了；这些页的尺寸证据不可信，重新取证（extract 会在每页 open 后 reload），仍不一致就把出问题的 URL 从取证列表里去掉`
    : null; // draft 对象在后面才创建，警告在间距段落里发出
  const unitOption = String(options.unit ?? "auto");
  const useRem = unitOption === "rem" || (unitOption === "auto" && Math.abs(rootFontSize - 16) > 2);
  const toRem = (px) => Math.round((px / rootFontSize) * 1000) / 1000;
  const dim = (px, description) => (useRem ? dimensionToken(toRem(px), "rem", `${description}（${Math.round(px * 100) / 100}px @ 根字号 ${rootFontSize}px）`) : dimensionToken(px, "px", description));
  const fmtPx = (px) => (useRem ? `${toRem(px)}rem（${Math.round(px * 100) / 100}px）` : `${px}px`);

  const hexOf = (css) => {
    const rgba = parseCssColor(css);
    return rgba && rgba.a > 0 ? canonical(toHex(rgba)) : null;
  };
  const opaqueHexOf = (css) => {
    const rgba = parseCssColor(css);
    return rgba && rgba.a >= 0.999 ? canonical(toHex({ ...rgba, a: 1 })) : null;
  };
  const rgbaOfHex = (hex) => parseCssColor(hex);
  const lightnessOf = (hex) => rgbaToOklch(rgbaOfHex(hex)).L;
  const familyOfHex = (hex) => hueFamily(rgbaToOklch(rgbaOfHex(hex)));
  const contrast = (fgHex, bgHex) => contrastRatio(rgbaOfHex(fgHex), rgbaOfHex(bgHex));
  const varColor = (names) => names.map((name) => rootVariables[name]).find((value) => value && parseCssColor(value)) ?? null;

  // 另一模式
  const initialScheme = pages[0].modes?.initial?.scheme ?? "light";
  const alternate = (() => {
    const entries = Object.entries(pages[0].modes ?? {}).filter(([key, value]) => key !== "initial" && value?.changed && value.probe);
    entries.sort(([leftKey], [rightKey]) => (leftKey.startsWith("toggle") ? -1 : 1) - (rightKey.startsWith("toggle") ? -1 : 1));
    const [key, value] = entries[0] ?? [];
    return key ? { key, ...value } : null;
  })();
  const alternateColors = alternate ? mergeColors([alternate.probe]).colors : new Map();
  const alternatePairs = alternate ? mergePairs([alternate.probe], (hex) => hex) : new Map();

  // -------------------------------------------------------------------------------------------------------------------
  // hex 级判定（不依赖调色板命名）

  const opaqueColors = [...colors.values()].filter((color) => color.rgba.a >= 1);
  const bodyBg = opaqueHexOf(primary.layout?.body?.background) ?? opaqueHexOf(primary.layout?.body?.rootBackground);
  const largestBg = opaqueColors.filter((color) => color.bg > 0).sort((left, right) => right.area - left.area)[0];
  const pageBg = bodyBg ?? largestBg?.hex ?? null;
  const pageIsDark = pageBg ? isDark(rgbaOfHex(pageBg)) : false;
  // 表面必须与页面底同调（对比 ≤ 1.6）：深底站点里的白色内容区不是「卡片表面」，是反色区块（bg.inverse）
  const surfaceCandidates = opaqueColors
    .filter((color) => color.bg > 0 && color.hex !== pageBg && (color.area > viewportArea * 0.01 || color.bg >= 3))
    .filter((color) => familyOfHex(color.hex) === "neutral" || lightnessOf(color.hex) > 0.95 || lightnessOf(color.hex) < 0.2)
    .filter((color) => !pageBg || contrast(color.hex, pageBg) <= 1.6)
    .map((color) => ({ color, score: color.bg + kindScore(color.kinds, { card: 3, input: 2, nav: 1, section: 2 }) }))
    .sort((left, right) => right.score - left.score);
  const surfaceBg = surfaceCandidates[0]?.color.hex ?? pageBg;
  const baseBg = surfaceBg ?? pageBg;
  const subtleCandidates = opaqueColors
    .filter((color) => color.bg > 0 && color.hex !== pageBg && color.hex !== surfaceBg && familyOfHex(color.hex) === "neutral")
    .filter((color) => baseBg && contrast(color.hex, baseBg) >= 1.02 && contrast(color.hex, baseBg) <= 1.35)
    .sort((left, right) => right.bg - left.bg);
  const inverseCandidates = opaqueColors
    .filter((color) => color.bg > 0 && pageBg && isDark(color.rgba) !== pageIsDark && color.hex !== pageBg)
    .filter((color) => familyOfHex(color.hex) === "neutral" || lightnessOf(color.hex) < 0.15)
    .sort((left, right) => right.area - left.area);
  // 文字色允许半透明（Bootstrap / Material 的次要文字是 rgba(…, .75) 这类），对比度按叠在底色上算；太透的（< 0.5）不算文字
  const textColors = [...colors.values()].filter((color) => color.rgba.a >= 0.5 && color.text > 0 && baseBg && contrast(color.hex, baseBg) >= 2.2).sort((left, right) => right.text - left.text);
  // 只看色度：近白 / 近黑本来就是低色度；不能按明度放行，否则代码高亮的浅青、浅黄会混进文字三档
  const neutralText = textColors.filter((color) => familyOfHex(color.hex) === "neutral");
  const primaryText = neutralText[0] ?? textColors[0] ?? null;
  const primaryContrast = primaryText ? contrast(primaryText.hex, baseBg) : 0;
  // 正文之外的中性文字色按对比度排：最深的一档是 secondary，最浅但仍 ≥ 3:1 的是 muted（文字量只用来过滤噪声）
  const pickTextTiers = (pool, primaryHex, primaryRatio, background) => {
    const tiers = pool
      .filter((color) => color.hex !== primaryHex && (color.text >= 10 || color.textCount >= 2))
      .map((color) => ({ color, ratio: contrast(color.hex, background) }))
      .filter((entry) => entry.ratio >= 3 && entry.ratio < primaryRatio - 0.8)
      .sort((left, right) => right.ratio - left.ratio);
    const secondary = tiers[0] ?? null;
    const muted = tiers.length > 1 && tiers.at(-1).ratio < secondary.ratio - 0.5 ? tiers.at(-1) : null;
    return { muted: muted?.color ?? null, secondary: secondary?.color ?? null };
  };
  const { muted: mutedText, secondary: secondaryText } = primaryText ? pickTextTiers(neutralText, primaryText.hex, primaryContrast, baseBg) : { muted: null, secondary: null };

  // 按钮分组
  const buttonGroups = new Map();
  for (const button of components.buttons) {
    const bg = opaqueHexOf(button.background);
    if (!bg) continue;
    const group = buttonGroups.get(bg) ?? { bg, count: 0, textColors: [], texts: [] };
    group.count += 1;
    group.texts.push(button.text);
    group.textColors.push(opaqueHexOf(button.color));
    buttonGroups.set(bg, group);
  }
  const brandOverride = options.brand ? parseCssColor(String(options.brand)) : null;
  const brandDetection = detectBrandFamily({ buttons: components.buttons, colors, headings: components.headings, links: components.links, viewportArea });
  const chromaticButtons = [...buttonGroups.values()].filter((group) => familyOfHex(group.bg) !== "neutral" && group.bg !== surfaceBg && group.bg !== pageBg);
  // 品牌族要么有该族的实底按钮，要么得分够高（≥ 6）；否则只是代码高亮 / 插图里的有彩色，按色相名保留，不封为 brand
  const detectedScore = brandDetection.ranking[0]?.[1] ?? 0;
  const detectedHasButton = chromaticButtons.some((group) => familyOfHex(group.bg) === brandDetection.family);
  const brandFamily = brandOverride ? hueFamily(rgbaToOklch(brandOverride)) : (detectedHasButton || detectedScore >= 6 ? brandDetection.family : null);
  const brandButtons = chromaticButtons.filter((group) => brandFamily && familyOfHex(group.bg) === brandFamily);
  const darkNeutralButtons = [...buttonGroups.values()].filter((group) => familyOfHex(group.bg) === "neutral" && pageBg && isDark(rgbaOfHex(group.bg)) !== pageIsDark);
  const primaryGroup = (brandButtons.length ? brandButtons : chromaticButtons.length ? chromaticButtons : darkNeutralButtons).sort((left, right) => right.count - left.count)[0] ?? null;
  const primaryVar = varColor(["--primary", "--color-primary", "--brand", "--color-brand", "--accent", "--color-accent", "--el-color-primary", "--ant-color-primary", "--bs-primary", "--mantine-primary-color-filled", "--vp-c-brand-1"]);
  // 品牌色：--brand 指定 > 品牌族里的按钮填充 > 品牌族里最常见的颜色。主操作色：按钮证据 > 根变量 > 品牌色——两者常常不同（深底站点主按钮是白的）
  const brandHex = brandOverride
    ? canonical(toHex({ ...brandOverride, a: 1 }))
    : brandButtons[0]?.bg ?? opaqueColors.filter((color) => brandFamily && familyOfHex(color.hex) === brandFamily).sort((left, right) => right.count - left.count)[0]?.hex ?? null;
  let primaryHex = primaryGroup?.bg ?? (primaryVar ? hexOf(primaryVar) : null) ?? brandHex;
  const primarySource = primaryGroup ? `${primaryGroup.count} 个按钮的填充（如「${primaryGroup.texts.slice(0, 2).join("」「")}」）` : primaryVar ? "根变量里的主色" : brandOverride ? "用户指定的品牌色（页面上没有实底按钮）" : brandHex ? "品牌族里最常见的颜色（页面上没有实底按钮）" : null;
  const onPrimaryObserved = primaryGroup && primaryGroup.bg === primaryHex ? mostCommon(primaryGroup.textColors.filter(Boolean)) : null;
  const onPrimaryFallback = primaryHex && !onPrimaryObserved
    ? (contrast("#ffffff", primaryHex) >= contrast(primaryText?.hex ?? "#111111", primaryHex) ? "#ffffff" : primaryText?.hex ?? "#111111")
    : null;
  const dangerGroup = [...buttonGroups.values()].filter((group) => familyOfHex(group.bg) === "red" && group.bg !== primaryHex).sort((left, right) => right.count - left.count)[0] ?? null;
  const dangerVar = varColor(["--destructive", "--danger", "--color-danger", "--error", "--color-error", "--red", "--el-color-danger", "--ant-color-error", "--bs-danger", "--vp-c-danger-1"]);
  const dangerHex = dangerGroup?.bg ?? (dangerVar ? hexOf(dangerVar) : null);
  const onDangerObserved = dangerGroup ? mostCommon(dangerGroup.textColors.filter(Boolean)) : null;

  // 状态色：只认显式线索（徽标类名 / 根变量名 / 危险按钮）
  const statusVarNames = {
    error: ["--error", "--color-error", "--danger", "--color-danger", "--destructive", "--red", "--el-color-danger", "--ant-color-error", "--bs-danger", "--vp-c-danger-1"],
    info: ["--info", "--color-info", "--el-color-info", "--ant-color-info", "--bs-info", "--vp-c-tip-1"],
    success: ["--success", "--color-success", "--green", "--el-color-success", "--ant-color-success", "--bs-success", "--vp-c-success-1"],
    warning: ["--warning", "--color-warning", "--warn", "--el-color-warning", "--ant-color-warning", "--bs-warning", "--vp-c-warning-1"]
  };
  const statusBgSuffixes = ["-bg", "-light", "-soft", "-subtle", "-background", "-light-9", "-bg-container", "-bg-subtle"];
  const statusClass = { error: /error|danger|fail|negative|destructive/i, info: /info|notice/i, success: /success|positive|\bok\b|done/i, warning: /warn|caution|pending/i };
  const statusPicks = {};
  for (const status of Object.keys(statusVarNames)) {
    const badge = components.badges.find((entry) => statusClass[status].test(entry.className) || statusClass[status].test(entry.text));
    if (badge && opaqueHexOf(badge.color)) {
      statusPicks[status] = { bg: opaqueHexOf(badge.background), evidence: `徽标「${badge.text}」（class ${badge.className.slice(0, 30)}）`, fg: opaqueHexOf(badge.color) };
      continue;
    }
    for (const name of statusVarNames[status]) {
      if (rootVariables[name] && parseCssColor(rootVariables[name])) {
        const bgName = statusBgSuffixes.map((suffix) => name + suffix).find((candidate) => rootVariables[candidate] && parseCssColor(rootVariables[candidate]));
        statusPicks[status] = { bg: bgName ? hexOf(rootVariables[bgName]) : null, evidence: `根变量 ${name}`, fg: hexOf(rootVariables[name]) };
        break;
      }
    }
    if (!statusPicks[status] && status === "error" && dangerHex) {
      statusPicks[status] = { bg: null, evidence: "同危险按钮填充", fg: dangerHex };
    }
  }
  const chartVars = [1, 2, 3, 4, 5, 6].map((index) => rootVariables[`--chart-${index}`]).filter((value) => value && parseCssColor(value));

  // 链接
  const contentLinks = components.links.filter((link) => link.inParagraph);
  const linkPool = contentLinks.length ? contentLinks : components.links.filter((link) => !link.inNav);
  const linkColor = mostCommon(linkPool.map((link) => opaqueHexOf(link.color)).filter(Boolean));
  const linkHoverEntries = interactions.hover.filter((entry) => entry.tag === "a" && entry.changed?.includes("color"));
  const linkHover = linkHoverEntries.find((entry) => opaqueHexOf(entry.before.color) === linkColor) ?? linkHoverEntries[0] ?? null;
  const linkHoverIsContent = Boolean(linkHover && opaqueHexOf(linkHover.before.color) === linkColor);
  const primaryHover = primaryHex ? interactions.hover.find((entry) => opaqueHexOf(entry.before.background) === primaryHex && entry.changed?.includes("background")) : null;
  const hoverBgEntries = interactions.hover.filter((entry) => entry.changed?.includes("background") && opaqueHexOf(entry.before.background) !== primaryHex);
  const hoverBg = mostCommon(hoverBgEntries.map((entry) => opaqueHexOf(entry.after.background)).filter((hex) => hex && familyOfHex(hex) === "neutral"));
  const focusBorder = mostCommon([
    ...interactions.focus.map((entry) => (entry.changed?.includes("borderColor") ? opaqueHexOf(entry.after.borderColor) : null)),
    ...focusRules.map((rule) => (rule.borderColor ? opaqueHexOf(rule.borderColor) : null))
  ].filter(Boolean));
  const inputBg = mostCommon(components.inputs.map((input) => opaqueHexOf(input.background)).filter(Boolean));
  // 占位符色与输入框文字色相同 = 没有单独设占位符样式（el-select 的只读输入框这类），不算证据
  const placeholder = mostCommon(components.inputs.map((input) => (hexOf(input.placeholder) && hexOf(input.placeholder) !== hexOf(input.color) ? hexOf(input.placeholder) : null)).filter(Boolean));
  // 输入框边线：border，或 Element / shadcn 常用的 inset 1px box-shadow
  const insetBorderColor = (shadow) => parseBoxShadow(shadow).find((layer) => layer.inset && layer.spread >= 1 && layer.blur === 0 && layer.color)?.color ?? null;
  const inputBorder = mostCommon(components.inputs.map((input) => (input.borderWidth > 0 ? opaqueHexOf(input.borderColor) : hexOf(insetBorderColor(input.shadow)))).filter(Boolean));
  // 边线允许半透明（rgba(0,0,0,.08) 这类分隔线很常见），alias 指向带 alpha 的 Primitive，对比度按叠底算
  const borderColors = [...colors.values()].filter((color) => color.border > 0 && color.rgba.a >= 0.05).sort((left, right) => right.border - left.border);
  const neutralBorders = borderColors.filter((color) => familyOfHex(color.hex) === "neutral" && color.hex !== surfaceBg && color.hex !== pageBg);

  // 阴影分档
  const shadowLayers = [];
  for (const shadow of stats.shadows) {
    // 去掉 inset、颜色全透明、零偏移零模糊零扩散的占位层（Tailwind 的 shadow 工具类会留下 5 层 rgba(0,0,0,0) 0 0 0 0）
    const layers = parseBoxShadow(shadow.key).filter((layer) => {
      const color = layer.color ? parseCssColor(layer.color) : null;
      return !layer.inset && color && color.a > 0 && (layer.blur > 0 || layer.spread > 0 || layer.y !== 0 || layer.x !== 0);
    });
    if (layers.length === 0) continue;
    const representative = layers.reduce((best, layer) => (layer.blur + Math.abs(layer.y) > best.blur + Math.abs(best.y) ? layer : best), layers[0]);
    shadowLayers.push({ count: shadow.count, formula: shadow.key, kinds: shadow.kinds, layers, representative, weight: representative.blur + Math.abs(representative.y) });
  }
  shadowLayers.sort((left, right) => right.count - left.count);
  const distinctShadows = [];
  for (const shadow of shadowLayers) {
    if (!distinctShadows.some((existing) => Math.abs(existing.weight - shadow.weight) <= 2)) distinctShadows.push(shadow);
  }
  distinctShadows.sort((left, right) => left.weight - right.weight);
  const shadowLevels = distinctShadows.slice(0, 3);

  // 焦点环
  let focusRingWidth = null;
  const ringCandidates = [];
  // `outline-style: auto` 是浏览器默认焦点环（站点没写自己的焦点样式），不算证据。颜色可能是 rgb(37, 99, 235) 这种带空格的函数写法，按括号深度切词。
  const splitOutsideParens = (text) => {
    const parts = [];
    let depth = 0;
    let current = "";
    for (const character of text) {
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (/\s/.test(character) && depth === 0) {
        if (current) parts.push(current);
        current = "";
        continue;
      }
      current += character;
    }
    if (current) parts.push(current);
    return parts;
  };
  const outlineColorOf = (outline) => (outline && outline !== "none" && !/\bauto\b/.test(outline) ? splitOutsideParens(outline).find((part) => parseCssColor(part)) ?? null : null);
  const outlineWidthOf = (outline) => {
    const part = outlineColorOf(outline) ? outline.match(/(\d+(?:\.\d+)?)px/) : null;
    return part ? Number(part[1]) : null;
  };
  for (const entry of interactions.focus) {
    const outlineColor = outlineColorOf(entry.after?.outline);
    if (outlineColor) ringCandidates.push({ color: outlineColor, evidence: `焦点 outline「${entry.text}」` });
    for (const layer of parseBoxShadow(entry.after?.shadow)) {
      if (layer.color && parseCssColor(layer.color) && layer.spread > 0) ringCandidates.push({ color: layer.color, evidence: `焦点环 box-shadow「${entry.text}」` });
      if (!focusRingWidth && layer.spread > 0 && layer.blur === 0) focusRingWidth = layer.spread;
    }
    if (!focusRingWidth) focusRingWidth = outlineWidthOf(entry.after?.outline);
  }
  for (const rule of focusRules) {
    const outlineColor = outlineColorOf(rule.outline);
    if (outlineColor) ringCandidates.push({ color: outlineColor, evidence: `样式表 ${rule.selector.slice(0, 40)} 的 outline` });
    for (const layer of parseBoxShadow(rule.boxShadow)) {
      if (layer.color && parseCssColor(layer.color) && layer.spread > 0) ringCandidates.push({ color: layer.color, evidence: `样式表 ${rule.selector.slice(0, 40)} 的焦点环` });
      if (!focusRingWidth && layer.spread > 0 && layer.blur === 0) focusRingWidth = layer.spread;
    }
    if (!focusRingWidth) focusRingWidth = outlineWidthOf(rule.outline);
  }
  // 环的语义是半透明光晕：有半透明候选时优先它，不透明的 outline 色留给 border.focus
  const translucentRings = ringCandidates.filter((candidate) => (parseCssColor(candidate.color)?.a ?? 1) < 1);
  const ringPick = mostCommon((translucentRings.length ? translucentRings : ringCandidates).map((candidate) => hexOf(candidate.color)));
  const opaqueOutline = mostCommon(ringCandidates.filter((candidate) => (parseCssColor(candidate.color)?.a ?? 1) >= 1).map((candidate) => hexOf(candidate.color)));

  // -------------------------------------------------------------------------------------------------------------------
  // 调色板：收齐所有颜色后只命名一次

  const palette = new Palette({ brandFamily });
  const usageSummary = (color) => {
    const parts = [];
    if (color.text) parts.push(`文字 ${color.textCount} 处`);
    if (color.bg) parts.push(`底色 ${color.bg} 处`);
    if (color.border) parts.push(`边线 ${color.border} 处`);
    const kinds = Object.entries(color.kinds ?? {}).sort((left, right) => right[1] - left[1]).slice(0, 3).map(([kind]) => kind);
    return `${parts.join("、")}${kinds.length ? `（${kinds.join(" / ")}）` : ""}`;
  };
  for (const color of colors.values()) {
    // 只出现一次也要收的情形：大面积底、承载了一段文字（段落色常常只命中一个 p）、成对出现的边线
    const important = color.area > viewportArea * 0.02 || color.text >= 40 || color.border >= 2;
    if (color.count >= MIN_COUNT || important) palette.add(color.hex, { count: color.count, description: `${OBSERVED} ${usageSummary(color)}` });
  }
  for (const button of components.buttons) {
    palette.add(button.background, { count: 2, description: `${OBSERVED} 按钮填充「${button.text}」` });
    palette.add(button.color, { count: 1, description: `${OBSERVED} 按钮文字「${button.text}」` });
    if (button.borderWidth > 0) palette.add(button.borderColor, { count: 1, description: `${OBSERVED} 按钮边线「${button.text}」` });
  }
  for (const input of components.inputs) {
    palette.add(input.background, { count: 1, description: `${OBSERVED} 输入框底` });
    if (input.borderWidth > 0) palette.add(input.borderColor, { count: 1, description: `${OBSERVED} 输入框边线` });
    palette.add(input.placeholder, { count: 1, description: `${OBSERVED} 输入框占位符` });
  }
  for (const badge of components.badges) {
    palette.add(badge.background, { count: 1, description: `${OBSERVED} 徽标底「${badge.text}」` });
    palette.add(badge.color, { count: 1, description: `${OBSERVED} 徽标文字「${badge.text}」` });
  }
  for (const link of components.links) palette.add(link.color, { count: 1, description: `${OBSERVED} 链接「${link.text}」` });
  for (const entry of interactions.hover) {
    for (const key of ["background", "color", "borderColor"]) {
      if (entry.changed?.includes(key)) palette.add(entry.after[key], { count: 1, description: `${OBSERVED} 悬停后的${key === "background" ? "底色" : key === "color" ? "文字" : "边线"}「${entry.text}」` });
    }
  }
  for (const entry of interactions.focus) {
    if (entry.changed?.includes("borderColor")) palette.add(entry.after.borderColor, { count: 1, description: `${OBSERVED} 焦点边线「${entry.text}」` });
  }
  for (const rule of focusRules) {
    if (rule.borderColor) palette.add(rule.borderColor, { count: 1, description: `${OBSERVED} 样式表 ${rule.selector.slice(0, 40)} 的焦点边线` });
  }
  for (const candidate of ringCandidates) palette.add(candidate.color, { count: 1, description: `${OBSERVED} ${candidate.evidence}`, usage: "ring" });
  for (const level of shadowLevels) palette.add(level.representative.color, { count: 1, description: `${OBSERVED} 阴影色，出现 ${level.count} 处`, usage: "shadow" });
  for (const color of colors.values()) {
    if (color.rgba.a < 0.9 && color.rgba.a > 0.2 && color.bg > 0 && color.area > viewportArea * 0.3 && isDark({ ...color.rgba, a: 1 })) {
      palette.add(color.hex, { count: color.count, description: `${OBSERVED} 大面积半透明深底（弹窗遮罩）`, usage: "overlay" });
    }
  }
  if (brandHex) palette.add(brandHex, { count: 3, description: brandOverride ? `${OBSERVED} 用户指定的品牌色` : `${OBSERVED} 品牌色` });
  if (primaryVar && primaryHex === hexOf(primaryVar)) palette.add(primaryHex, { count: 2, description: `${OBSERVED} 根变量里的主色` });
  if (onPrimaryFallback) palette.add(onPrimaryFallback, { count: 1, description: `${INFERRED} 主按钮文字候选` });
  palette.add("#ffffff", { count: 1, description: `${OBSERVED} 白` });
  // 被角色判定选中的颜色一律进调色板（哪怕只出现一次），否则别名找不到目标会被静默跳过
  for (const [hex, description] of [
    [pageBg, "页面底"], [surfaceBg, "卡片 / 区块底"], [subtleCandidates[0]?.hex, "浅分区底"], [inverseCandidates[0]?.hex, "反色底"],
    [primaryText?.hex, "正文色"], [secondaryText?.hex, "次要文字色"], [mutedText?.hex, "弱化文字色"],
    [linkColor, "链接色"], [linkHover ? opaqueHexOf(linkHover.after.color) : null, "链接悬停色"],
    [primaryHex, "主操作色"], [onPrimaryObserved, "主按钮文字"], [primaryHover ? opaqueHexOf(primaryHover.after.background) : null, "主按钮悬停"],
    [dangerHex, "危险色"], [onDangerObserved, "危险按钮文字"], [hoverBg, "悬停底"],
    [borderColors[0]?.hex, "边线"], [neutralBorders[0]?.hex, "中性边线"], [neutralBorders[1]?.hex, "第二档边线"],
    [inputBorder, "输入框边线"], [inputBg, "输入框底"], [placeholder, "占位符"], [focusBorder, "焦点边线"]
  ]) {
    if (hex) palette.add(hex, { count: 1, description: `${OBSERVED} ${description}` });
  }
  for (const [status, pick] of Object.entries(statusPicks)) {
    palette.add(pick.fg, { count: 1, description: `${OBSERVED} ${status} 状态色（${pick.evidence}）` });
    if (pick.bg) palette.add(pick.bg, { count: 1, description: `${OBSERVED} ${status} 状态浅底` });
  }
  if (chartVars.length >= 3) chartVars.forEach((value, index) => palette.add(value, { count: 1, description: `${OBSERVED} 根变量 --chart-${index + 1}` }));
  for (const color of alternateColors.values()) {
    if (color.count >= MIN_COUNT || color.area > viewportArea * 0.02 || color.text > 200 || color.border >= 2) {
      palette.add(color.hex, { count: color.count, description: `${OBSERVED} ${alternate.scheme === "dark" ? "暗色" : "亮色"}模式：${usageSummary(color)}` });
    }
  }
  palette.assignNames();

  const draft = new Draft({ allowInferred: FILL_INFERRED });
  for (const entry of palette.entries.values()) {
    draft.primitive(entry.path, colorToken(entry.rgba, [...entry.descriptions].slice(0, 3).join("；")));
  }
  const aliasOf = (css) => (css ? palette.pathOf(css) : null);
  const white = palette.pathOf("#ffffff");

  // -------------------------------------------------------------------------------------------------------------------
  // 颜色角色

  if (pageBg) draft.role("color.bg.page", "color", aliasOf(pageBg), { evidence: bodyBg ? "body 背景色" : "面积最大的底色", source: "observed" });
  else draft.warn("没找到页面底色：body 与 html 都是透明，也没有大面积底色");
  if (surfaceBg) {
    draft.role("color.bg.surface", "color", aliasOf(surfaceBg), {
      evidence: surfaceBg === pageBg ? "页面上没有与页面底不同的卡片底，先与 bg.page 同值" : `卡片 / 区块底色，${surfaceCandidates[0].color.bg} 处`,
      source: surfaceBg === pageBg ? "inferred" : "observed"
    });
  }
  if (subtleCandidates[0]) draft.role("color.bg.subtle", "color", aliasOf(subtleCandidates[0].hex), { evidence: `比 surface 略深的中性底，${subtleCandidates[0].bg} 处`, source: "observed" });
  else if (pageBg && surfaceBg && pageBg !== surfaceBg && FILL_INFERRED) draft.role("color.bg.subtle", "color", aliasOf(pageBg), { evidence: "没有单独的浅分区底，借用页面底", source: "inferred" });
  if (inputBg) draft.role("color.bg.input", "color", aliasOf(inputBg), { evidence: `${components.inputs.length} 个输入框的背景色`, source: "observed" });
  else if (surfaceBg && FILL_INFERRED) draft.role("color.bg.input", "color", aliasOf(surfaceBg), { evidence: "页面上没有输入框，先与 surface 同值", source: "inferred" });
  if (inverseCandidates[0]) draft.role("color.bg.inverse", "color", aliasOf(inverseCandidates[0].hex), { evidence: `与页面明暗相反的中性底（${Object.keys(inverseCandidates[0].kinds ?? {}).slice(0, 2).join(" / ") || "区块"}）`, source: "observed" });
  const overlayEntry = [...palette.entries.values()].find((entry) => entry.usage.has("overlay"));
  if (overlayEntry) draft.role("color.bg.overlay", "color", overlayEntry.path, { evidence: "观察到大面积半透明深底", source: "observed" });

  if (primaryText) {
    draft.role("color.text.primary", "color", aliasOf(primaryText.hex), { evidence: `承载最多文字（约 ${primaryText.text} 字）的文字色，对 surface ${primaryContrast}:1`, source: "observed" });
    if (secondaryText) {
      draft.role("color.text.secondary", "color", aliasOf(secondaryText.hex), { evidence: `第二常见的中性文字色，对比 ${contrast(secondaryText.hex, baseBg)}:1`, source: "observed" });
      if (mutedText) draft.role("color.text.muted", "color", aliasOf(mutedText.hex), { evidence: `第三档中性文字色，对比 ${contrast(mutedText.hex, baseBg)}:1`, source: "observed" });
      else if (FILL_INFERRED) draft.role("color.text.muted", "color", aliasOf(secondaryText.hex), { evidence: "只有两档中性文字色，muted 先与 secondary 同值", source: "inferred" });
    } else if (FILL_INFERRED) {
      draft.role("color.text.secondary", "color", aliasOf(primaryText.hex), { evidence: "只观察到一档正文色，secondary 先同值", source: "inferred" });
      draft.role("color.text.muted", "color", aliasOf(primaryText.hex), { evidence: "同上", source: "inferred" });
    }
  } else {
    draft.warn("没找到正文文字色（所有文字色对底色对比都低于 2.2:1？）");
  }
  if (placeholder) draft.role("color.text.placeholder", "color", aliasOf(placeholder), { evidence: `${components.inputs.length} 个输入框的 ::placeholder`, source: "observed" });
  if (inverseCandidates[0]) {
    const onInverse = [...pairs.values()].filter((pair) => pair.bg === inverseCandidates[0].hex).sort((left, right) => right.text - left.text)[0];
    if (onInverse) draft.role("color.text.inverse", "color", aliasOf(onInverse.fg), { evidence: "落在反色底上最常见的文字色", source: "observed" });
  }
  if (FILL_INFERRED) {
    draft.role("color.text.inverse", "color", pageIsDark ? aliasOf(primaryText?.hex) : white ?? aliasOf(surfaceBg), { evidence: pageIsDark ? "暗色页面：反色文字先取正文色" : "亮色页面：反色文字取白", source: "inferred" });
    if (primaryText) draft.role("color.bg.inverse", "color", aliasOf(primaryText.hex), { evidence: "没有观察到反色区块，先用正文色当深底（Tooltip / 深色 Toast）", source: "inferred" });
  }

  if (linkColor) {
    const chromatic = familyOfHex(linkColor) !== "neutral";
    draft.role("color.text.link", "color", aliasOf(linkColor), { evidence: `${linkPool.length} 个${contentLinks.length ? "正文内" : ""}链接的颜色${chromatic ? "" : "（无色系链接：靠下划线识别）"}`, source: "observed" });
    const decoration = mostCommon(linkPool.map((link) => link.decoration).filter(Boolean));
    if (decoration && decoration !== "none") draft.primitive("text.link.decoration", stringToken(decoration, `${OBSERVED} ${linkPool.length} 个链接的 text-decoration`));
  } else if (primaryText && FILL_INFERRED) {
    draft.role("color.text.link", "color", aliasOf(primaryText.hex), { evidence: "页面上没有正文链接，先用正文色", source: "inferred" });
  }
  if (linkHover && linkHoverIsContent) draft.role("color.text.link-hover", "color", aliasOf(linkHover.after.color), { evidence: `悬停探针：链接「${linkHover.text}」变色`, source: "observed" });
  else if (linkHover) draft.role("color.text.link-hover", "color", aliasOf(linkHover.after.color), { evidence: `悬停探针只命中导航链接「${linkHover.text}」的变色，内容型链接的 hover 未观察到`, source: "inferred" });
  else if (draft.target("color.text.link") && FILL_INFERRED) {
    const neighbor = palette.neighbor(linkColor ?? primaryText?.hex, pageIsDark ? "lighter" : "darker");
    draft.role("color.text.link-hover", "color", neighbor?.path ?? draft.target("color.text.link"), { evidence: neighbor ? "同族相邻一档" : "未观察到链接悬停变化，先同值", source: "inferred" });
  }

  if (primaryHex) {
    draft.role("color.action.primary", "color", aliasOf(primaryHex), { evidence: primarySource, source: primaryGroup || primaryVar ? "observed" : "inferred" });
    if (onPrimaryObserved) draft.role("color.text.on-primary", "color", aliasOf(onPrimaryObserved), { evidence: `主按钮上的文字色，对比 ${contrast(onPrimaryObserved, primaryHex)}:1`, source: "observed" });
    else if (FILL_INFERRED && onPrimaryFallback) draft.role("color.text.on-primary", "color", aliasOf(onPrimaryFallback), { evidence: `按对比度选白 / 深字：${contrast(onPrimaryFallback, primaryHex)}:1`, source: "inferred" });
    if (primaryHover) draft.role("color.action.primary-hover", "color", aliasOf(primaryHover.after.background), { evidence: `悬停探针：「${primaryHover.text}」填充变化`, source: "observed" });
    else if (FILL_INFERRED) {
      const neighbor = palette.neighbor(primaryHex, pageIsDark ? "lighter" : "darker");
      draft.role("color.action.primary-hover", "color", neighbor?.path ?? aliasOf(primaryHex), { evidence: neighbor ? "未观察到悬停变化，取同族相邻一档" : "未观察到悬停变化，先与静息同值", source: "inferred" });
    }
    if (FILL_INFERRED) {
      draft.role("color.action.primary-active", "color", draft.target("color.action.primary-hover") ?? aliasOf(primaryHex), { evidence: "按下态先与 hover 同值", source: "inferred" });
      const brandTarget = aliasOf(brandHex) ?? aliasOf(primaryHex);
      const brandNote = brandHex && brandHex !== primaryHex ? `品牌色 ${brandHex}（与主按钮填充不同）` : "默认用主色";
      draft.role("color.brand.indicator", "color", brandTarget, { evidence: `指示条${brandNote}`, source: brandOverride ? "observed" : "inferred" });
      draft.role("color.bg.brand", "color", brandTarget, { evidence: `大面积品牌面${brandNote}`, source: "inferred" });
      if (brandHex && brandHex !== primaryHex) {
        const onBrand = contrast("#ffffff", brandHex) >= contrast(primaryText?.hex ?? "#111111", brandHex) ? white : aliasOf(primaryText?.hex);
        draft.role("color.text.on-brand", "color", onBrand, { evidence: `按对比度选白 / 正文色：${contrast(onBrand === white ? "#ffffff" : primaryText?.hex ?? "#111111", brandHex)}:1`, source: "inferred" });
        draft.role("color.text.brand", "color", brandTarget, { evidence: "品牌大字（≥ 20px 展示性文字）用品牌色", source: "inferred" });
      } else {
        draft.role("color.text.on-brand", "color", draft.target("color.text.on-primary"), { evidence: "同主按钮文字", source: "inferred" });
      }
    }
  } else {
    draft.warn("没找到主操作色：页面上没有实底按钮、根变量里也没有 --primary 之类；用 --brand #hex 指定");
  }
  if (dangerHex) {
    draft.role("color.action.danger", "color", aliasOf(dangerHex), { evidence: dangerGroup ? `${dangerGroup.count} 个红色按钮` : "根变量里的危险色", source: "observed" });
    draft.role("color.text.on-danger", "color", onDangerObserved ? aliasOf(onDangerObserved) : white, { evidence: onDangerObserved ? "危险按钮上的文字" : "默认白字", source: onDangerObserved ? "observed" : "inferred" });
    if (FILL_INFERRED) {
      const neighbor = palette.neighbor(dangerHex, "darker");
      draft.role("color.action.danger-hover", "color", neighbor?.path ?? aliasOf(dangerHex), { evidence: neighbor ? "同族深一档" : "先与静息同值", source: "inferred" });
      draft.role("color.action.danger-active", "color", draft.target("color.action.danger-hover"), { evidence: "同 hover", source: "inferred" });
      draft.role("color.text.danger", "color", aliasOf(dangerHex), { evidence: "危险文字先与填充同值（暗色下要换亮红）", source: "inferred" });
    }
  }

  if (hoverBg) draft.role("color.bg.hover", "color", aliasOf(hoverBg), { evidence: `悬停探针：${hoverBgEntries.length} 个元素 hover 后的中性底`, source: "observed" });
  else if (FILL_INFERRED && surfaceBg) {
    const step = subtleCandidates[0] ? aliasOf(subtleCandidates[0].hex) : palette.neighbor(surfaceBg, pageIsDark ? "lighter" : "darker")?.path ?? (pageBg !== surfaceBg ? aliasOf(pageBg) : null);
    draft.role("color.bg.hover", "color", step, { evidence: "未观察到悬停底，取比 surface 深一档的中性色", source: "inferred" });
  }
  if (FILL_INFERRED) {
    draft.role("color.action.secondary-hover", "color", draft.target("color.bg.hover"), { evidence: "次要按钮悬停底同 bg.hover", source: "inferred" });
    draft.role("color.bg.elevated", "color", aliasOf(surfaceBg), { evidence: `浮层表面先同 surface${pageIsDark ? "（暗色页面：接入时应比 surface 亮一档）" : ""}`, source: "inferred" });
    draft.role("color.bg.skeleton", "color", draft.target("color.bg.subtle") ?? draft.target("color.bg.hover"), { evidence: "骨架屏底借用浅分区底", source: "inferred" });
    draft.role("color.bg.skeleton-highlight", "color", aliasOf(surfaceBg), { evidence: "骨架屏流光借用 surface", source: "inferred" });
    draft.role("color.bg.readonly", "color", draft.target("color.bg.subtle"), { evidence: "只读字段底借用浅分区底", source: "inferred" });
  }

  if (neutralBorders[0]) {
    draft.role("color.border.default", "color", aliasOf(neutralBorders[0].hex), { evidence: `最常见的中性边线，${neutralBorders[0].border} 处`, source: "observed" });
    const strong = neutralBorders.slice(1).find((color) => baseBg && contrast(color.hex, baseBg) > contrast(neutralBorders[0].hex, baseBg) + 0.3);
    if (strong) draft.role("color.border.strong", "color", aliasOf(strong.hex), { evidence: `比 default 深的边线，${strong.border} 处`, source: "observed" });
    else if (FILL_INFERRED) {
      const neighbor = palette.neighbor(neutralBorders[0].hex, pageIsDark ? "lighter" : "darker");
      draft.role("color.border.strong", "color", neighbor?.path ?? aliasOf(neutralBorders[0].hex), { evidence: neighbor ? "同族深一档" : "只有一档边线，先同值", source: "inferred" });
    }
  } else if (borderColors[0]) {
    draft.role("color.border.default", "color", aliasOf(borderColors[0].hex), { evidence: `最常见的边线色（有彩色），${borderColors[0].border} 处`, source: "observed" });
  }
  if (inputBorder) draft.role("color.border.input", "color", aliasOf(inputBorder), { evidence: `${components.inputs.length} 个输入框的边线`, source: "observed" });
  else if (FILL_INFERRED) draft.role("color.border.input", "color", draft.target("color.border.strong") ?? draft.target("color.border.default"), { evidence: "没有输入框样本，借用 border.strong", source: "inferred" });
  if (ringPick) draft.role("color.focus.ring", "color", aliasOf(ringPick), { evidence: `焦点探针 / :focus-visible 规则里的环色 ${ringPick}`, source: "observed" });
  if (focusBorder) draft.role("color.border.focus", "color", aliasOf(focusBorder), { evidence: "焦点探针 / :focus 规则：边线变色", source: "observed" });
  else if (opaqueOutline) draft.role("color.border.focus", "color", aliasOf(opaqueOutline), { evidence: "焦点 outline 色（不透明）", source: "observed" });
  else if (FILL_INFERRED && primaryHex) {
    draft.role("color.border.focus", "color", aliasOf(primaryHex), { evidence: "未观察到焦点样式，先用主色（Citrine 用近黑，接入时按品牌决定）", source: "inferred" });
    draft.role("color.focus.ring", "color", aliasOf(primaryHex), { evidence: "焦点环先用主色实色；建议改为主色 30～40% 的半透明 Primitive", source: "inferred" });
  }

  for (const [status, pick] of Object.entries(statusPicks)) {
    draft.role(`color.status.${status}`, "color", aliasOf(pick.fg), { evidence: pick.evidence, source: "observed" });
    if (pick.bg) draft.role(`color.status.${status}-bg`, "color", aliasOf(pick.bg), { evidence: pick.evidence, source: "observed" });
  }
  if (FILL_INFERRED && draft.target("color.text.secondary")) {
    draft.role("color.status.neutral", "color", draft.target("color.text.secondary"), { evidence: "中性状态文字借用 text.secondary", source: "inferred" });
    draft.role("color.status.neutral-bg", "color", draft.target("color.bg.subtle") ?? draft.target("color.bg.hover"), { evidence: "中性状态浅底借用 bg.subtle", source: "inferred" });
    draft.role("color.icon.default", "color", draft.target("color.text.secondary"), { evidence: "独立图标默认色同 text.secondary", source: "inferred" });
    draft.role("color.icon.muted", "color", draft.target("color.text.muted"), { evidence: "装饰图标同 text.muted", source: "inferred" });
  }
  if (chartVars.length >= 3) chartVars.forEach((value, index) => draft.role(`color.chart.${index + 1}`, "color", aliasOf(hexOf(value)), { evidence: `根变量 --chart-${index + 1}`, source: "observed" }));

  // -------------------------------------------------------------------------------------------------------------------
  // 字体

  const bodyStack = parseFontFamily(primary.layout?.body?.fontFamily ?? stats.families[0]?.key);
  if (bodyStack.length) {
    draft.primitive("font.family.sans", fontFamilyToken(bodyStack, `${OBSERVED} body 字体栈`));
    draft.role("font.family.body", "fontFamily", "font.family.sans", { evidence: `body 的 font-family：${bodyStack.slice(0, 3).join(", ")}`, source: "observed" });
  }
  const monoStack = stats.families.map((entry) => parseFontFamily(entry.key)).find((stack) => isMonoStack(stack));
  if (monoStack) {
    draft.primitive("font.family.mono", fontFamilyToken(monoStack, `${OBSERVED} 页面上出现的等宽字体栈`));
    draft.role("font.family.code", "fontFamily", "font.family.mono", { evidence: "等宽字体栈", source: "observed" });
  }
  const headingFamily = mostCommon(components.headings.map((heading) => heading.fontFamily).filter(Boolean));
  if (headingFamily && bodyStack[0] && headingFamily.toLowerCase() !== bodyStack[0].toLowerCase()) {
    const stack = parseFontFamily(stats.families.find((entry) => parseFontFamily(entry.key)[0]?.toLowerCase() === headingFamily.toLowerCase())?.key ?? headingFamily);
    draft.primitive("font.family.display", fontFamilyToken(stack, `${OBSERVED} 标题字体栈（与正文不同）`));
    draft.role("font.family.heading", "fontFamily", "font.family.display", { evidence: `标题用 ${headingFamily}`, source: "observed" });
  }

  // 字号阶梯：正文 = md，向下 sm / xs / 2xs，向上 lg / xl / 2xl…
  const textKinds = { block: 1, link: 1, text: 3 };
  const bodySizeEntry = [...stats.fontSizes].sort((left, right) => (right.text ?? 0) * (1 + kindScore(right.kinds, textKinds) / (right.count || 1)) - (left.text ?? 0) * (1 + kindScore(left.kinds, textKinds) / (left.count || 1)))[0];
  const bodySize = bodySizeEntry ? Number(bodySizeEntry.key) : primary.layout?.body?.fontSize ?? 16;
  const headingSizes = new Set(components.headings.map((heading) => heading.fontSize));
  const mergedSizes = [];
  for (const entry of stats.fontSizes.map((item) => ({ ...item, value: Number(item.key) })).filter((item) => item.value >= 10 && item.value <= 160 && (item.count >= MIN_COUNT || headingSizes.has(item.value) || item.value === bodySize)).sort((left, right) => right.count - left.count)) {
    const host = mergedSizes.find((existing) => Math.abs(existing.value - entry.value) < 1);
    if (host) host.count += entry.count;
    else mergedSizes.push({ ...entry });
  }
  mergedSizes.sort((left, right) => left.value - right.value);
  const below = mergedSizes.filter((entry) => entry.value < bodySize).sort((left, right) => right.value - left.value).slice(0, 3);
  // 比正文大的档最多 8 个：超出时留最常用的 7 个 + 最大的那个（hero 大字不能丢），再按值升序命名
  const aboveAll = mergedSizes.filter((entry) => entry.value > bodySize);
  let above = aboveAll;
  if (aboveAll.length > 8) {
    const keep = new Set([...aboveAll].sort((left, right) => right.count - left.count).slice(0, 7).map((entry) => entry.value));
    keep.add(aboveAll.at(-1).value);
    above = aboveAll.filter((entry) => keep.has(entry.value));
  }
  const sizeName = new Map([[bodySize, "md"]]);
  below.forEach((entry, index) => sizeName.set(entry.value, ["sm", "xs", "2xs"][index]));
  above.forEach((entry, index) => sizeName.set(entry.value, ["lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl"][index]));
  for (const [value, name] of sizeName) {
    const entry = mergedSizes.find((candidate) => candidate.value === value) ?? bodySizeEntry;
    draft.primitive(`font.size.${name}`, dim(value, `${OBSERVED} 出现 ${entry?.count ?? 0} 处${name === "md" ? "，正文字号" : ""}${headingSizes.has(value) ? "，用于标题" : ""}`));
  }
  const sizePath = (value) => (value !== undefined && sizeName.has(value) ? `font.size.${sizeName.get(value)}` : null);
  const nearestSize = (value) => {
    if (!value) return null;
    let best = null;
    for (const candidate of sizeName.keys()) if (!best || Math.abs(candidate - value) < Math.abs(best - value)) best = candidate;
    return sizePath(best);
  };
  // 标题字号只认比正文大的 h1 / h2：SEO 用的隐藏标题、逐字动画的空 h2 常是 9px 之类的怪值
  const h1Size = mostCommon(components.headings.filter((heading) => heading.tag === "h1" && heading.fontSize > bodySize).map((heading) => heading.fontSize));
  const h2Size = mostCommon(components.headings.filter((heading) => heading.tag === "h2" && heading.fontSize > bodySize).map((heading) => heading.fontSize));
  draft.role("text.body.size", "dimension", "font.size.md", { evidence: `承载最多文字的字号 ${fmtPx(bodySize)}`, source: "observed" });
  draft.role("text.body-sm.size", "dimension", sizePath(below[0]?.value) ?? "font.size.md", { evidence: below[0] ? `正文下一档 ${below[0].value}px` : "没有比正文小的字号，先同正文", source: below[0] ? "observed" : "inferred" });
  draft.role("text.small.size", "dimension", sizePath(below[1]?.value) ?? sizePath(below[0]?.value) ?? "font.size.md", { evidence: below[1] ? `${below[1].value}px` : "复用 body-sm", source: below[1] ? "observed" : "inferred" });
  draft.role("text.caption.size", "dimension", sizePath(below.at(-1)?.value) ?? "font.size.md", { evidence: below.length ? `最小字号 ${below.at(-1).value}px` : "没有小字号样本", source: below.length ? "observed" : "inferred" });
  draft.role("text.title-sm.size", "dimension", sizePath(above[0]?.value) ?? "font.size.md", { evidence: above[0] ? `正文上一档 ${above[0].value}px` : "没有更大的字号", source: above[0] ? "observed" : "inferred" });
  draft.role("text.title.size", "dimension", sizePath(above[1]?.value) ?? sizePath(above[0]?.value) ?? "font.size.md", { evidence: above[1] ? `${above[1].value}px` : "复用 title-sm", source: above[1] ? "observed" : "inferred" });
  draft.role("text.heading.size", "dimension", nearestSize(h2Size) ?? sizePath(above[2]?.value) ?? sizePath(above.at(-1)?.value) ?? "font.size.md", { evidence: h2Size ? `h2 字号 ${h2Size}px` : "取阶梯里的更大一档", source: h2Size ? "observed" : "inferred" });
  draft.role("text.display.size", "dimension", nearestSize(h1Size) ?? sizePath(above.at(-1)?.value) ?? "font.size.md", { evidence: h1Size ? `h1 字号 ${h1Size}px` : "取阶梯最大档", source: h1Size ? "observed" : "inferred" });
  draft.role("text.hero.size", "dimension", sizePath(above.at(-1)?.value) ?? "font.size.md", { evidence: above.length ? `最大字号 ${above.at(-1).value}px` : "无更大字号", source: above.length ? "observed" : "inferred" });

  // 字重
  const weightNames = { 100: "thin", 200: "extralight", 300: "light", 400: "regular", 500: "medium", 600: "semibold", 700: "bold", 800: "extrabold", 900: "black" };
  const weightValues = stats.weights.map((entry) => Number(entry.key)).filter((value) => weightNames[value]);
  for (const entry of stats.weights) {
    const value = Number(entry.key);
    if (weightNames[value]) draft.primitive(`font.weight.${weightNames[value]}`, fontWeightToken(value, `${OBSERVED} 出现 ${entry.count} 处（${Object.keys(entry.kinds ?? {}).slice(0, 3).join(" / ")}）`));
  }
  const hasWeight = (value) => weightValues.includes(value);
  const labelWeight = hasWeight(500) ? 500 : hasWeight(600) ? 600 : hasWeight(400) ? 400 : weightValues[0];
  const strongWeight = hasWeight(600) ? 600 : hasWeight(700) ? 700 : hasWeight(500) ? 500 : weightValues[0];
  const brandWeight = hasWeight(700) ? 700 : hasWeight(800) ? 800 : strongWeight;
  const buttonWeight = mostCommon(components.buttons.map((button) => button.fontWeight));
  if (labelWeight) draft.role("text.weight.label", "fontWeight", `font.weight.${weightNames[labelWeight]}`, { evidence: `按钮 / 标签类字重 ${labelWeight}${buttonWeight === labelWeight ? "（按钮样本一致）" : ""}`, source: buttonWeight === labelWeight ? "observed" : "inferred" });
  if (strongWeight) draft.role("text.weight.strong", "fontWeight", `font.weight.${weightNames[strongWeight]}`, { evidence: `强调字重 ${strongWeight}`, source: "inferred" });
  if (brandWeight) draft.role("text.weight.brand", "fontWeight", `font.weight.${weightNames[brandWeight]}`, { evidence: `品牌 / 大字字重 ${brandWeight}`, source: "inferred" });
  const h1Weight = mostCommon(components.headings.filter((heading) => heading.tag === "h1").map((heading) => heading.fontWeight));
  if (h1Weight && weightNames[h1Weight]) {
    draft.primitive(`font.weight.${weightNames[h1Weight]}`, fontWeightToken(h1Weight, `${OBSERVED} h1 字重`));
    draft.role("text.display.weight", "fontWeight", `font.weight.${weightNames[h1Weight]}`, { evidence: `h1 字重 ${h1Weight}`, source: "observed" });
  }

  // 行高 / 字距
  const lineHeights = stats.lineHeights.map((entry) => ({ ...entry, value: Number(entry.key) })).filter((entry) => entry.value >= 0.9 && entry.value <= 2.4);
  if (lineHeights.length) {
    // 正文行高按「承载的文字量」选，不按元素个数：逐字动画的单字 span 行高 1 会灌大元素数，但字数少
    const byCount = [...lineHeights].sort((left, right) => ((right.text ?? 0) || right.count) - ((left.text ?? 0) || left.count));
    const normal = byCount[0].value;
    const tight = Math.min(...lineHeights.map((entry) => entry.value));
    const relaxed = Math.max(...lineHeights.map((entry) => entry.value));
    draft.primitive("font.line-height.normal", numberToken(normal, `${OBSERVED} 最常见的行高（${byCount[0].count} 处）`));
    draft.role("text.body.line-height", "number", "font.line-height.normal", { evidence: `正文行高 ${normal}`, source: "observed" });
    if (tight < normal - 0.05) {
      draft.primitive("font.line-height.tight", numberToken(tight, `${OBSERVED} 最紧的行高（标题）`));
      draft.role("text.heading.line-height", "number", "font.line-height.tight", { evidence: `标题行高 ${tight}`, source: "observed" });
      draft.role("text.display.line-height", "number", "font.line-height.tight", { evidence: "同标题", source: "inferred" });
      draft.role("text.hero.line-height", "number", "font.line-height.tight", { evidence: "同标题", source: "inferred" });
    } else {
      draft.role("text.heading.line-height", "number", "font.line-height.normal", { evidence: "没有更紧的行高，先同正文", source: "inferred" });
    }
    if (relaxed > normal + 0.05) {
      draft.primitive("font.line-height.relaxed", numberToken(relaxed, `${OBSERVED} 最松的行高（成段说明）`));
      draft.role("text.paragraph.line-height", "number", "font.line-height.relaxed", { evidence: `成段文字行高 ${relaxed}`, source: "observed" });
    }
  }
  const negativeTracking = stats.letterSpacings.map((entry) => Number(entry.key)).filter((value) => value < 0);
  const positiveTracking = stats.letterSpacings.map((entry) => Number(entry.key)).filter((value) => value > 0);
  if (negativeTracking.length) {
    const value = Math.max(...negativeTracking);
    draft.primitive("font.letter-spacing.tight", dimensionToken(value, "em", `${OBSERVED} 负字距（标题 / 大字）`));
    draft.role("text.display.tracking", "dimension", "font.letter-spacing.tight", { evidence: `大字负字距 ${value}em`, source: "observed" });
  }
  if (positiveTracking.length) {
    const value = Math.max(...positiveTracking);
    draft.primitive("font.letter-spacing.wide", dimensionToken(value, "em", `${OBSERVED} 正字距（全大写小字 / 标签）`));
    draft.role("text.tracking.caps", "dimension", "font.letter-spacing.wide", { evidence: `放宽字距 ${value}em`, source: "observed" });
  }
  if (stats.decorations.some((entry) => entry.key === "transform:uppercase")) draft.warn("页面有全大写文字（text-transform: uppercase）——中文系统通常不套用，DESIGN.md 里要写清适用范围");
  if (primary.layout?.body?.fontSmoothing === "antialiased") draft.warn("body 用了 -webkit-font-smoothing: antialiased——Mac 上会把中文削细一档（Citrine 明令禁止），DESIGN.md「文字渲染」里决定是否沿用");

  // -------------------------------------------------------------------------------------------------------------------
  // 间距：一律按 4px 阶梯命名（spacing.<px/4>，半步 -5）；不在 2px 网格上的值记为漂移

  const spacingEntries = stats.spacing.map((entry) => ({ ...entry, value: Number(entry.key) })).filter((entry) => entry.value > 0 && entry.value <= 160);
  const baseUnit = detectBaseUnit(spacingEntries);
  // px 模式：2px 网格、按 px/4 命名（半步 -5）；rem 模式：0.01rem 网格、按 rem×100 命名（spacing.20 = 0.2rem，与「1rem = 100px 设计稿」的读法一致）
  const onGridTest = (value) => (useRem ? Math.abs(toRem(value) * 100 - Math.round(toRem(value) * 100)) < 0.05 : value % 2 === 0);
  const onGrid = spacingEntries.filter((entry) => onGridTest(entry.value) && entry.count >= MIN_COUNT).sort((left, right) => right.count - left.count).slice(0, 18);
  const offGrid = spacingEntries.filter((entry) => !onGridTest(entry.value) && entry.count >= MIN_COUNT * 2);
  const spacingKey = (value) => (useRem ? String(Math.round(toRem(value) * 100)) : value % 4 === 0 ? String(value / 4) : `${Math.floor(value / 4)}-5`);
  for (const entry of onGrid) {
    const usage = ["padding", "gap", "margin"].filter((prop) => entry[prop]).map((prop) => `${prop} ${entry[prop]}`).join("、");
    draft.primitive(`spacing.${spacingKey(entry.value)}`, dim(entry.value, `${OBSERVED} ${usage}${!useRem && entry.value % 4 ? "（半步，只给控件内部）" : ""}`));
  }
  if (offGrid.length) draft.warn(`不在${useRem ? " 0.01rem" : " 2px"} 网格上的间距：${offGrid.map((entry) => `${fmtPx(entry.value)}×${entry.count}`).join("、")}——按角色收进最近的阶梯，或在 AUDIT.md 记为漂移`);
  if (rootWarning) draft.warn(rootWarning);
  if (useRem) draft.warn(`根字号 ${rootFontSize}px 而不是 16px：站点用 vw 缩放的 rem 方案，尺寸类 token 已换算成 rem（1rem = ${rootFontSize}px @ 桌面视口 ${primary.viewport?.width ?? 1440}），根字号记在 size.root-font；接入项目必须复刻 html 根字号规则，否则所有尺寸按 16px 解释会缩小 ${Math.round(rootFontSize / 16 * 10) / 10} 倍`);
  const spacingPath = (value) => (value && hasPath(draft.primitives, `spacing.${spacingKey(value)}`) ? `spacing.${spacingKey(value)}` : null);
  const gapEntries = onGrid.filter((entry) => entry.gap);
  const inlineGap = gapEntries.filter((entry) => entry.value <= 12).sort((left, right) => right.gap - left.gap)[0];
  const stackGap = gapEntries.filter((entry) => entry.value >= 12 && entry.value <= 40).sort((left, right) => right.gap - left.gap)[0];
  if (spacingPath(inlineGap?.value)) draft.role("space.inline", "dimension", spacingPath(inlineGap.value), { evidence: `最常见的小 gap ${fmtPx(inlineGap.value)}（${inlineGap.gap} 处）`, source: "observed" });
  if (spacingPath(stackGap?.value)) draft.role("space.stack", "dimension", spacingPath(stackGap.value), { evidence: `最常见的块间 gap ${fmtPx(stackGap.value)}（${stackGap.gap} 处）`, source: "observed" });
  const sectionPadX = mostCommon(probes.flatMap((probe) => probe.layout?.sections ?? []).map((section) => section.paddingLeft).filter((value) => value >= 12 && value <= 96 && value % 2 === 0));
  if (spacingPath(sectionPadX)) draft.role("space.gutter", "dimension", spacingPath(sectionPadX), { evidence: `区块左右内边距 ${fmtPx(sectionPadX)}`, source: "observed" });
  const cardPad = mostCommon(components.cards.map((card) => card.padding?.[0]).filter((value) => value >= 8 && value <= 64 && value % 2 === 0));
  if (spacingPath(cardPad)) draft.role("space.card", "dimension", spacingPath(cardPad), { evidence: `${components.cards.length} 个卡片样本的内边距 ${fmtPx(cardPad)}`, source: "observed" });
  for (const [rolePath, fallback] of [["space.inline", 8], ["space.stack", 16], ["space.gutter", 24], ["space.card", 24]]) {
    if (!draft.target(rolePath) && FILL_INFERRED) {
      const target = useRem ? fallback / 16 * rootFontSize : fallback; // rem 模式：把 16px 基准的期望值按根字号比例放大
      const nearest = onGrid.map((entry) => entry.value).sort((left, right) => Math.abs(left - target) - Math.abs(right - target))[0];
      if (spacingPath(nearest)) draft.role(rolePath, "dimension", spacingPath(nearest), { evidence: `没有直接证据，取阶梯里最接近 ${fmtPx(target)} 的 ${fmtPx(nearest)}`, source: "inferred" });
    }
  }
  const tdPadY = mostCommon(components.tables.filter((cell) => cell.tag === "td").map((cell) => cell.paddingY).filter((value) => value > 0 && onGridTest(value)));
  const tdPadX = mostCommon(components.tables.filter((cell) => cell.tag === "td").map((cell) => cell.paddingX).filter((value) => value > 0 && onGridTest(value)));
  if (tdPadY) {
    draft.primitive(`spacing.${spacingKey(tdPadY)}`, dim(tdPadY, `${OBSERVED} 表格单元格纵向内边距`));
    draft.role("table.cell.padding-y", "dimension", `spacing.${spacingKey(tdPadY)}`, { evidence: `td padding-top ${fmtPx(tdPadY)}`, source: "observed" });
  }
  if (tdPadX) {
    draft.primitive(`spacing.${spacingKey(tdPadX)}`, dim(tdPadX, `${OBSERVED} 表格单元格横向内边距`));
    draft.role("table.cell.padding-x", "dimension", `spacing.${spacingKey(tdPadX)}`, { evidence: `td padding-left ${fmtPx(tdPadX)}`, source: "observed" });
  }

  // 圆角：按出现的档数从小到大命名
  const radiusList = stats.radii.filter((entry) => entry.key !== "full").map((entry) => ({ ...entry, value: Number(entry.key) })).filter((entry) => entry.value > 0 && entry.value <= 48 * (useRem ? rootFontSize / 16 : 1) && entry.count >= MIN_COUNT).sort((left, right) => left.value - right.value).slice(0, 6);
  const radiusNames = { 1: ["md"], 2: ["sm", "md"], 3: ["sm", "md", "lg"], 4: ["xs", "sm", "md", "lg"], 5: ["xs", "sm", "md", "lg", "xl"], 6: ["xs", "sm", "md", "lg", "xl", "2xl"] }[radiusList.length] ?? [];
  radiusList.forEach((entry, index) => {
    const kinds = Object.entries(entry.kinds ?? {}).sort((left, right) => right[1] - left[1]).slice(0, 3).map(([kind]) => kind).join(" / ");
    draft.primitive(`radius.${radiusNames[index]}`, dim(entry.value, `${OBSERVED} ${entry.count} 处（${kinds}）`));
  });
  const fullRadius = stats.radii.find((entry) => entry.key === "full");
  if (fullRadius) draft.primitive("radius.full", dimensionToken(999, "px", `${OBSERVED} 胶囊 / 圆形，${fullRadius.count} 处`));
  if (radiusList.length === 0) draft.warn("没有观察到圆角（或都低于最小出现次数）");

  // 线宽
  const widthNames = ["thin", "medium", "thick", "bar"];
  const borderWidthEntries = stats.borderWidths.map((entry) => ({ ...entry, value: Number(entry.key) })).filter((entry) => entry.value > 0 && entry.value <= 6);
  const sortedWidths = [...borderWidthEntries].sort((left, right) => left.value - right.value).slice(0, 4);
  sortedWidths.forEach((entry, index) => draft.primitive(`border.width.${widthNames[index]}`, dimensionToken(entry.value, "px", `${OBSERVED} ${entry.count} 处`)));
  const widthPath = (value) => {
    const index = sortedWidths.findIndex((entry) => entry.value === value);
    return index >= 0 ? `border.width.${widthNames[index]}` : null;
  };
  const commonWidth = [...borderWidthEntries].sort((left, right) => right.count - left.count)[0];
  if (commonWidth) {
    draft.role("border.width.default", "dimension", widthPath(commonWidth.value), { evidence: `最常见的边线宽 ${commonWidth.value}px（${commonWidth.count} 处）`, source: "observed" });
    const thicker = sortedWidths.find((entry) => entry.value > commonWidth.value);
    if (thicker) {
      draft.role("border.width.active", "dimension", widthPath(thicker.value), { evidence: `更粗的一档 ${thicker.value}px（选中下划线 / 焦点外框）`, source: "inferred" });
      draft.role("border.width.control", "dimension", widthPath(thicker.value), { evidence: "小控件边线借用更粗一档", source: "inferred" });
    }
  }
  if (focusRingWidth) {
    const existing = widthPath(focusRingWidth);
    if (!existing) draft.primitive("border.width.ring", dimensionToken(focusRingWidth, "px", `${OBSERVED} 焦点环粗细`));
    draft.role("focus.ring.width", "dimension", existing ?? "border.width.ring", { evidence: `焦点环 ${focusRingWidth}px`, source: "observed" });
  }

  // 阴影：颜色 + 偏移 + 模糊三件拆开（shadow 复合类型不在 CSS Profile 里）
  const levelNames = ["card", "popover", "modal"];
  shadowLevels.forEach((level, index) => {
    const step = index + 1;
    const { representative } = level;
    draft.primitive(`shadow.y.${step}`, dim(representative.y, `${OBSERVED} 第 ${step} 层阴影 y 偏移；原式：${level.formula.slice(0, 120)}`));
    draft.primitive(`shadow.blur.${step}`, dim(representative.blur, `${OBSERVED} 第 ${step} 层阴影模糊（${level.count} 处，${Object.keys(level.kinds ?? {}).slice(0, 3).join(" / ")}）`));
    if (representative.spread) draft.primitive(`shadow.spread.${step}`, dim(representative.spread, `${OBSERVED} 第 ${step} 层阴影扩散（写法要带第四个长度）`));
    const name = levelNames[index];
    draft.role(`elevation.${name}.y`, "dimension", `shadow.y.${step}`, { evidence: `第 ${step} 层阴影（按 y+blur 由浅到深排序）`, source: "observed" });
    draft.role(`elevation.${name}.blur`, "dimension", `shadow.blur.${step}`, { evidence: `${level.count} 处`, source: "observed" });
    const colorPath = palette.pathOf(representative.color);
    if (colorPath) draft.role(`elevation.${name}.color`, "color", colorPath, { evidence: `阴影色 ${representative.color}${level.layers.length > 1 ? `（原式 ${level.layers.length} 层，取最大模糊层）` : ""}`, source: "observed" });
  });
  if (distinctShadows.length > 3) draft.warn(`观察到 ${distinctShadows.length} 档阴影，只收前三档（card / popover / modal）；其余：${distinctShadows.slice(3).map((level) => level.formula.slice(0, 60)).join(" ｜ ")}`);

  // 动效
  const durationEntries = stats.durations.map((entry) => ({ ...entry, value: Number(entry.key) })).filter((entry) => entry.value >= 50 && entry.value <= 1200);
  if (durationEntries.length) {
    const byCount = [...durationEntries].sort((left, right) => right.count - left.count);
    const normal = byCount[0].value;
    const fast = Math.min(...durationEntries.map((entry) => entry.value));
    const slow = Math.max(...durationEntries.map((entry) => entry.value));
    draft.primitive("duration.normal", durationToken(normal, "ms", `${OBSERVED} 最常见的过渡时长（${byCount[0].count} 处）`));
    draft.role("motion.duration.normal", "duration", "duration.normal", { evidence: `${normal}ms`, source: "observed" });
    if (fast < normal) {
      draft.primitive("duration.fast", durationToken(fast, "ms", `${OBSERVED} 最短过渡时长`));
      draft.role("motion.duration.fast", "duration", "duration.fast", { evidence: `${fast}ms`, source: "observed" });
    } else draft.role("motion.duration.fast", "duration", "duration.normal", { evidence: "只有一档时长", source: "inferred" });
    if (slow > normal) {
      draft.primitive("duration.slow", durationToken(slow, "ms", `${OBSERVED} 最长过渡 / 动画时长`));
      draft.role("motion.duration.slow", "duration", "duration.slow", { evidence: `${slow}ms`, source: "observed" });
    } else draft.role("motion.duration.slow", "duration", "duration.normal", { evidence: "只有一档时长", source: "inferred" });
  }
  const timingEntries = stats.timings.map((entry) => ({ ...entry, points: parseTimingFunction(entry.key) })).filter((entry) => entry.points).sort((left, right) => right.count - left.count);
  if (timingEntries.length) {
    const standard = timingEntries[0];
    draft.primitive("easing.standard", cubicBezierToken(standard.points, `${OBSERVED} 最常见的缓动 ${standard.key}（${standard.count} 处）`));
    draft.role("motion.easing.standard", "cubicBezier", "easing.standard", { evidence: standard.key, source: "observed" });
    const enter = timingEntries.find((entry) => entry.key !== standard.key && entry.points[0] <= 0.1 && entry.points[3] === 1 && entry.points[2] < 0.6);
    const exit = timingEntries.find((entry) => entry.key !== standard.key && entry.points[2] === 1 && entry.points[3] === 1 && entry.points[0] > 0.3);
    if (enter) {
      draft.primitive("easing.enter", cubicBezierToken(enter.points, `${OBSERVED} 减速进场 ${enter.key}`));
      draft.role("motion.easing.enter", "cubicBezier", "easing.enter", { evidence: enter.key, source: "observed" });
    }
    if (exit) {
      draft.primitive("easing.exit", cubicBezierToken(exit.points, `${OBSERVED} 加速退场 ${exit.key}`));
      draft.role("motion.easing.exit", "cubicBezier", "easing.exit", { evidence: exit.key, source: "observed" });
    }
  }

  // z 层
  const zEntries = stats.zIndexes.map((entry) => ({ ...entry, value: Number(entry.key) })).filter((entry) => entry.value > 0 && entry.value < 100000).sort((left, right) => left.value - right.value);
  for (const entry of zEntries) draft.primitive(`z.${entry.value}`, numberToken(entry.value, `${OBSERVED} ${entry.count} 处（${Object.keys(entry.position ?? {}).join(" / ")}）`));
  if (zEntries.length) {
    const picks = zEntries.length >= 4 ? [zEntries[0], zEntries[1], zEntries[zEntries.length - 2], zEntries.at(-1)] : zEntries;
    picks.forEach((entry, index) => draft.role(`layer.${["sticky", "dropdown", "modal", "toast"][index]}`, "number", `z.${entry.value}`, { evidence: `z-index ${entry.value}（按大小排第 ${index + 1} 档）`, source: "inferred" }));
  }

  // 透明度
  const disabledOpacity = stats.opacities.map((entry) => ({ ...entry, value: Number(entry.key) })).filter((entry) => entry.disabled > 0 || (entry.value >= 0.3 && entry.value <= 0.7)).sort((left, right) => (right.disabled ?? 0) - (left.disabled ?? 0) || right.count - left.count)[0];
  if (disabledOpacity) {
    const key = `opacity.${Math.round(disabledOpacity.value * 100)}`;
    draft.primitive(key, numberToken(disabledOpacity.value, `${OBSERVED} ${disabledOpacity.count} 处${disabledOpacity.disabled ? "，含 disabled 元素" : ""}`));
    draft.role("opacity.disabled", "number", key, { evidence: disabledOpacity.disabled ? "disabled 元素的 opacity" : "0.3～0.7 之间最常见的透明度", source: disabledOpacity.disabled ? "observed" : "inferred" });
  }

  // 控件高度 / 图标 / 布局
  const heightCounts = new Map();
  for (const value of [...components.buttons.map((button) => button.height), ...components.inputs.map((input) => input.height)].filter((value) => value >= 20 && value <= 72 * (useRem ? rootFontSize / 16 : 1)).map((value) => (useRem ? value : Math.round(value / 2) * 2))) {
    heightCounts.set(value, (heightCounts.get(value) ?? 0) + 1);
  }
  const heightRanked = [...heightCounts.entries()].sort((left, right) => right[1] - left[1]);
  if (heightRanked.length) {
    const md = heightRanked[0][0];
    const smaller = heightRanked.filter(([value]) => value <= md - 4)[0]?.[0];
    const larger = heightRanked.filter(([value]) => value >= md + 4)[0]?.[0];
    draft.primitive("size.control.md", dim(md, `${OBSERVED} 按钮 / 输入框最常见高度（${heightRanked[0][1]} 个样本）`));
    draft.role("control.height.md", "dimension", "size.control.md", { evidence: fmtPx(md), source: "observed" });
    if (smaller) {
      draft.primitive("size.control.sm", dim(smaller, `${OBSERVED} 小控件高`));
      draft.role("control.height.sm", "dimension", "size.control.sm", { evidence: fmtPx(smaller), source: "observed" });
    }
    if (larger) {
      draft.primitive("size.control.lg", dim(larger, `${OBSERVED} 大控件高`));
      draft.role("control.height.lg", "dimension", "size.control.lg", { evidence: fmtPx(larger), source: "observed" });
    }
  }
  const squareIcons = iconSizes.map((entry) => ({ ...entry, size: entry.key.split("x").map(Number) })).filter((entry) => entry.size[0] === entry.size[1] && entry.size[0] >= 10 && entry.size[0] <= 64).sort((left, right) => right.count - left.count);
  if (squareIcons.length) {
    const md = squareIcons[0].size[0];
    const sorted = [...new Set(squareIcons.slice(0, 5).map((entry) => entry.size[0]))].sort((left, right) => left - right);
    const mdIndex = sorted.indexOf(md);
    const names = ["xs", "sm", "md", "lg", "xl"];
    sorted.forEach((value, index) => {
      const name = names[Math.min(4, Math.max(0, index - mdIndex + 2))];
      if (!hasPath(draft.primitives, `size.icon.${name}`)) {
        draft.primitive(`size.icon.${name}`, dim(value, `${OBSERVED} svg 边长（${squareIcons.find((entry) => entry.size[0] === value)?.count ?? 0} 处）`));
        draft.role(`icon.size.${name}`, "dimension", `size.icon.${name}`, { evidence: fmtPx(value), source: "observed" });
      }
    });
  }
  const strokeHint = iconHints.find((entry) => entry.key.startsWith("stroke-width:"));
  const strokeValue = strokeHint ? Number(strokeHint.key.split(":")[1]) : Number.NaN;
  if (Number.isFinite(strokeValue)) {
    const key = `stroke-width.${String(strokeValue).replace(".", "-")}`;
    draft.primitive(key, numberToken(strokeValue, `${OBSERVED} svg stroke-width，${strokeHint.count} 处`));
    draft.role("icon.stroke.width", "number", key, { evidence: `stroke-width ${strokeValue}`, source: "observed" });
  }
  const libHint = iconHints.find((entry) => entry.key.startsWith("lib:"));
  if (libHint) draft.primitive("icon.library", stringToken(libHint.key.slice(4), `${OBSERVED} 图标类名线索，${libHint.count} 处`));
  const header = probes.map((probe) => probe.layout?.header).find(Boolean);
  if (header?.height) {
    draft.primitive("size.topbar", dim(Math.round(header.height), `${OBSERVED} header 高度（position: ${header.position}）`));
    draft.role("layout.topbar.height", "dimension", "size.topbar", { evidence: fmtPx(Math.round(header.height)), source: "observed" });
  }
  const sidebar = probes.map((probe) => probe.layout?.sidebar).find(Boolean);
  if (sidebar?.width) {
    draft.primitive("size.sidebar", dim(Math.round(sidebar.width), `${OBSERVED} 侧栏宽度`));
    draft.role("layout.sidebar.width", "dimension", "size.sidebar", { evidence: fmtPx(Math.round(sidebar.width)), source: "observed" });
  }
  // 页面容器：≥ 720px 才算（更窄的是文字列 / 卡片），像素取整
  const container = probes.flatMap((probe) => probe.layout?.containerMaxWidths ?? []).map((entry) => ({ ...entry, value: Math.round(Number(entry.key)) })).filter((entry) => entry.value >= 720).sort((left, right) => right.count - left.count || right.value - left.value)[0];
  if (container) {
    draft.primitive("size.container", dim(container.value, `${OBSERVED} 居中容器 max-width（${container.count} 处）`));
    draft.role("layout.container.max-width", "dimension", "size.container", { evidence: fmtPx(container.value), source: "observed" });
  }
  const breakpointValues = breakpoints.map((entry) => ({ ...entry, value: Number.parseInt(entry.key, 10) })).filter((entry) => entry.value >= 320 && entry.value <= 1920).sort((left, right) => right.count - left.count);
  const mobileBp = breakpointValues.find((entry) => entry.value <= 820);
  const narrowBp = breakpointValues.find((entry) => entry.value > 820 && entry.value <= 1400);
  if (mobileBp) {
    draft.primitive("size.viewport.mobile", dimensionToken(mobileBp.value, "px", `${OBSERVED} 样式表里出现 ${mobileBp.count} 次的断点（CSS 媒体查询无法引用 var()，配方里是字面镜像）`));
    draft.role("layout.breakpoint.mobile", "dimension", "size.viewport.mobile", { evidence: `${mobileBp.value}px`, source: "observed" });
  }
  if (narrowBp) {
    draft.primitive("size.viewport.narrow", dimensionToken(narrowBp.value, "px", `${OBSERVED} 样式表里出现 ${narrowBp.count} 次的断点`));
    draft.role("layout.breakpoint.narrow", "dimension", "size.viewport.narrow", { evidence: `${narrowBp.value}px`, source: "observed" });
  }
  if (useRem) {
    draft.primitive("size.root-font", dimensionToken(rootFontSize, "px", `${OBSERVED} html 根字号 @ 桌面视口 ${primary.viewport?.width ?? 1440}px（≈ 100vw / ${Math.round((primary.viewport?.width ?? 1440) / rootFontSize * 100) / 100}）。本系统所有 rem 尺寸都以它为基准；接入项目复刻这条规则，或改成固定值并接受不再随视口缩放。`));
    draft.role("layout.root.font-size", "dimension", "size.root-font", { evidence: `根字号 ${rootFontSize}px（vw 缩放）`, source: "observed" });
  }

  // -------------------------------------------------------------------------------------------------------------------
  // 另一模式 → Theme delta（只覆写有证据的用途）

  let themeMap = null;
  let themeId = null;
  if (alternate) {
    themeId = alternate.scheme === "dark" ? "dark" : "light";
    const altProbe = alternate.probe;
    const altOpaque = [...alternateColors.values()].filter((color) => color.rgba.a >= 1);
    const altBody = opaqueHexOf(altProbe.layout?.body?.background) ?? opaqueHexOf(altProbe.layout?.body?.rootBackground) ?? altOpaque.filter((color) => color.bg > 0).sort((left, right) => right.area - left.area)[0]?.hex;
    const changed = (rolePath, hex, evidenceText) => hex && draft.themeRole(rolePath, "color", palette.pathOf(hex), evidenceText);
    if (altBody) {
      const modeLabel = themeId === "dark" ? "暗色" : "亮色";
      changed("color.bg.page", altBody, `${modeLabel}模式的 body 背景`);
      const altSurface = altOpaque
        .filter((color) => color.bg > 0 && color.hex !== altBody && (color.area > viewportArea * 0.01 || color.bg >= 3) && contrast(color.hex, altBody) <= 1.6)
        .map((color) => ({ color, score: color.bg + kindScore(color.kinds, { card: 3, input: 2, nav: 1, section: 2 }) }))
        .sort((left, right) => right.score - left.score)[0]?.color.hex ?? altBody;
      changed("color.bg.surface", altSurface, `${modeLabel}模式的卡片 / 区块底`);
      const altDark = isDark(rgbaOfHex(altBody));
      const altSubtle = altOpaque.filter((color) => color.bg > 0 && color.hex !== altBody && color.hex !== altSurface && contrast(color.hex, altSurface) >= 1.02 && contrast(color.hex, altSurface) <= 1.4).sort((left, right) => right.bg - left.bg)[0];
      if (altSubtle) changed("color.bg.subtle", altSubtle.hex, `${modeLabel}模式的浅分区底`);
      const altTextAll = altOpaque.filter((color) => color.text > 0 && contrast(color.hex, altSurface) >= 2.2).sort((left, right) => right.text - left.text);
      const altNeutralText = altTextAll.filter((color) => familyOfHex(color.hex) === "neutral");
      const altText = altNeutralText.length ? altNeutralText : altTextAll;
      if (altText[0]) {
        changed("color.text.primary", altText[0].hex, `${modeLabel}模式承载最多文字的颜色`);
        const tiers = pickTextTiers(altText, altText[0].hex, contrast(altText[0].hex, altSurface), altSurface);
        if (tiers.secondary) {
          changed("color.text.secondary", tiers.secondary.hex, `${modeLabel}模式第二档文字色`);
          changed("color.text.muted", (tiers.muted ?? tiers.secondary).hex, tiers.muted ? `${modeLabel}模式第三档文字色` : `${modeLabel}模式只有两档文字色，muted 同 secondary`);
        }
        changed("color.text.inverse", altDark ? altBody : altText[0].hex, altDark ? "暗色模式下反色文字取页面底色" : "亮色模式下反色文字取正文色");
        changed("color.bg.inverse", altDark ? altText[0].hex : altBody, "反色底随模式翻转");
      }
      const altBorder = [...alternateColors.values()].filter((color) => color.border > 0 && color.rgba.a >= 0.05 && color.hex !== altSurface && color.hex !== altBody).sort((left, right) => right.border - left.border)[0];
      if (altBorder) {
        changed("color.border.default", altBorder.hex, `${modeLabel}模式最常见的边线`);
        changed("color.border.input", altBorder.hex, `${modeLabel}模式输入框边线借用边线色`);
      }
      const altLinkPair = [...alternatePairs.values()].filter((pair) => (pair.kinds?.link ?? 0) > 0 && familyOfHex(pair.fg) !== "neutral").sort((left, right) => right.count - left.count)[0];
      if (altLinkPair) changed("color.text.link", altLinkPair.fg, `${modeLabel}模式正文链接色`);
      if (draft.target("color.bg.elevated")) changed("color.bg.elevated", altSurface, "浮层表面随模式变化（暗色下建议再亮一档）");
      if (draft.target("color.bg.hover") && altSubtle) changed("color.bg.hover", altSubtle.hex, `悬停底借用${modeLabel}模式的浅分区底`);
    }
    let activation = alternate.activation ?? (alternate.key.startsWith("media") ? { kind: "media" } : { kind: "class" });
    const defaultTheme = initialScheme === "dark" ? "dark" : "light";
    if (activation.kind === "media" && ![defaultTheme, themeId].every((id) => ["light", "dark"].includes(id))) {
      activation = { kind: "class" };
      draft.warn("media 激活只支持 light / dark 两个 id，已改为 class 激活，接入时请确认");
    }
    themeMap = {
      activation,
      defaultTheme,
      themes: [{
        id: themeId,
        reason: `取证时通过「${alternate.source}」拿到另一模式；delta 只含有证据的用途，其余角色接入前逐条确认。`,
        runtimeOwner: `待确认：目标站点通过 ${alternate.source} 切换；本项目由谁切换由接入方决定。`,
        source: `${pages[0].url}（${alternate.key}）`,
        status: "active"
      }],
      version: 1
    };
  }

  // -------------------------------------------------------------------------------------------------------------------
  // 缺口、写文件、摘要

  for (const role of ROLES) {
    if (!draft.target(role.path)) draft.notes.missing.push({ group: role.group, hint: role.hint, path: role.path, tier: role.tier, type: role.type, zh: role.zh });
  }
  const observedCount = Object.values(draft.notes.roles).filter((entry) => entry.source === "observed").length;
  const inferredCount = Object.values(draft.notes.roles).filter((entry) => entry.source === "inferred").length;
  const coreMissing = draft.notes.missing.filter((entry) => entry.tier === "core");
  const themeTokens = Object.keys(draft.theme).length ? sortTokenTree(draft.theme) : null;

  await writeJson(path.join(outDir, "tokens", "primitives.tokens.json"), sortTokenTree(draft.primitives), { stable: false });
  await writeJson(path.join(outDir, "tokens", "semantic.tokens.json"), sortTokenTree(draft.semantic), { stable: false });
  if (themeMap && themeTokens) {
    await writeJson(path.join(outDir, "themes", themeId, "tokens", "semantic.tokens.json"), themeTokens, { stable: false });
    await writeJson(path.join(outDir, "theme-map.json"), themeMap);
  } else if (themeMap) {
    draft.warn(`拿到了另一模式（${alternate.key}），但没有推出任何相对 Core 的差异，未生成 Theme`);
    themeMap = null;
    themeId = null;
  }

  const listStat = (entries, format = (entry) => `${entry.key}（${entry.count}）`) => entries.slice(0, 14).map(format).join("、") || "—";
  const colorRows = [...colors.values()].sort((left, right) => right.count - left.count).slice(0, 40).map((color) => {
    const entry = palette.entryOf(color.hex);
    return `| \`${color.hex}\` | ${entry?.path?.replace(/^color\./, "") ?? "（未收，出现次数不足）"} | ${color.textCount} / ${color.bg} / ${color.border} | ${color.text} | ${Object.entries(color.kinds).sort((l, r) => r[1] - l[1]).slice(0, 3).map(([kind]) => kind).join(" ")} | ${baseBg ? contrast(color.hex, baseBg) : "—"} |`;
  });
  const pairRows = [...pairs.values()].filter((pair) => pair.fg !== pair.bg).sort((left, right) => right.text - left.text).slice(0, 16).map((pair) => `| \`${pair.fg}\` on \`${pair.bg}\` | ${contrast(pair.fg, pair.bg)}:1 | ${pair.text} | ${Object.keys(pair.size ?? {}).join(" / ")} |`);
  const familyRows = Object.entries(palette.families()).map(([family, list]) => `| ${family} | ${list.length} | ${list.map((entry) => `${entry.path.split(".").slice(2).join(".")} \`${entry.hex}\``).join("、")} |`);
  const roleRows = Object.entries(draft.notes.roles).sort(([left], [right]) => left.localeCompare(right)).map(([rolePath, entry]) => `| \`${rolePath}\` | ${entry.source === "observed" ? "观察" : "推断"} | \`{${entry.target}}\` | ${entry.evidence} |`);
  const missingRows = draft.notes.missing.map((entry) => `| \`${entry.path}\` | ${entry.tier} | ${entry.zh} | ${entry.hint || "—"} |`);
  const hoverRows = interactions.hover.map((entry) => `| ${entry.tag} 「${entry.text}」 | ${entry.changed?.length ? entry.changed.map((key) => `${key}: ${entry.before[key]} → ${entry.after[key]}`).join("；") : "无变化"} |`);
  const focusRows = interactions.focus.map((entry) => `| ${entry.tag} 「${entry.text}」 | ${entry.changed?.length ? entry.changed.map((key) => `${key}: ${entry.after[key]}`).join("；") : "无可见焦点样式"} |`);
  const modeRows = Object.entries(pages[0].modes ?? {}).map(([key, value]) => `| ${key} | ${value.scheme ?? "—"} | ${key === "initial" ? "首屏" : value.changed ? "页面明暗翻转 ✔" : "无变化"} | ${value.source ?? ""} |`);

  const summary = `# 取证摘要 · ${systemName}

- 来源：${pages.map((page) => `${page.url}${page.title ? `（${page.title}）` : ""}`).join("；")}
- 取证时间：${evidence.extractedAt}；桌面视口 ${primary.viewport?.width}×${primary.viewport?.height}；处理节点 ${primary.nodesProcessed}/${primary.nodesTotal}
- 首屏模式：${initialScheme}${alternate ? `；另一模式：${alternate.key}（${alternate.scheme}）` : "；未取到另一模式（站点无暗 / 亮切换，或切换靠 JS 且未识别）"}
- 品牌族判定：${brandFamily ?? "无（单色站点）"}${brandDetection.ranking.length ? `（得分：${brandDetection.ranking.map(([family, score]) => `${family} ${score.toFixed(1)}`).join("、")}）` : ""}${brandOverride ? "，用户指定覆盖" : ""}${brandHex ? `；品牌色 \`${brandHex}\`` : ""}${primaryHex && brandHex && primaryHex !== brandHex ? `，主按钮填充 \`${primaryHex}\`（两者不同）` : ""}
- 角色覆盖：观察 ${observedCount} · 推断 ${inferredCount} · 缺口 ${draft.notes.missing.length}（其中 core 层 ${coreMissing.length}）

## 颜色（按出现次数）

| hex | Primitive | 文字 / 底 / 边线 次数 | 文字量 | 主要元素 | 对 surface 对比 |
| --- | --- | --- | --- | --- | --- |
${colorRows.join("\n")}

### 色族

| 族 | 档数 | 成员 |
| --- | --- | --- |
${familyRows.join("\n")}

### 文字 / 底色配对（按文字量）

| 配对 | 对比度 | 文字量 | 字号档 |
| --- | --- | --- | --- |
${pairRows.join("\n") || "| — | | | |"}
${gradients.length ? `\n渐变（未收进 token，DTCG gradient 不在 CSS Profile 内）：${gradients.slice(0, 4).map((gradient) => `\`${gradient.css.slice(0, 80)}\``).join("；")}` : ""}

## 排版

- 字体栈：${bodyStack.slice(0, 4).join(", ") || "—"}${monoStack ? `；等宽：${monoStack.slice(0, 2).join(", ")}` : ""}${headingFamily && bodyStack[0] && headingFamily.toLowerCase() !== bodyStack[0].toLowerCase() ? `；标题：${headingFamily}` : ""}
- 字号：${listStat(stats.fontSizes.map((entry) => ({ ...entry, key: fmtPx(Number(entry.key)) })))}；正文 = **${fmtPx(bodySize)}**${useRem ? `；根字号 ${rootFontSize}px（rem 模式）` : ''}
- 字重：${listStat(stats.weights)}
- 行高：${listStat(stats.lineHeights)}
- 字距（em）：${listStat(stats.letterSpacings)}
- 装饰：${listStat(stats.decorations)}
- 标题样本：${components.headings.slice(0, 6).map((heading) => `${heading.tag} ${heading.fontSize}px/${heading.fontWeight}`).join("、") || "—"}

## 尺寸与形状

- 间距：${listStat(stats.spacing.map((entry) => ({ ...entry, key: fmtPx(Number(entry.key)) })))}；${useRem ? '按 rem 归档（0.01rem 网格）' : `基础网格判定 ${baseUnit}px`}
- 圆角：${listStat(stats.radii)}
- 线宽：${listStat(stats.borderWidths)}
- 阴影：${distinctShadows.map((level) => `\`${level.formula.slice(0, 90)}\`（${level.count}）`).join("；") || "—"}
- 时长（ms）：${listStat(stats.durations)}；缓动：${listStat(stats.timings)}
- z-index：${listStat(stats.zIndexes)}
- 透明度：${listStat(stats.opacities)}
- 控件高度样本：${heightRanked.slice(0, 6).map(([value, count]) => `${value}px（${count}）`).join("、") || "—"}
- 图标：${listStat(iconSizes)}；线索：${listStat(iconHints)}
- 布局：header ${header ? `${Math.round(header.height)}px · ${header.position}` : "—"}；侧栏 ${sidebar ? `${Math.round(sidebar.width)}px` : "—"}；容器 ${container ? `${container.key}px` : "—"}；断点 ${listStat(breakpoints)}

## 主题线索

| 模式探测 | 明暗 | 结果 | 来源 |
| --- | --- | --- | --- |
${modeRows.join("\n")}

- html class：\`${primary.themeHints?.htmlClass || "—"}\`；data：${JSON.stringify(primary.themeHints?.htmlData ?? {})}；color-scheme：${primary.themeHints?.colorScheme ?? "—"}
- 样式表主题选择器：${listStat(primary.themeHints?.selectors ?? [])}
- 切换控件：${(primary.themeHints?.toggles ?? []).map((toggle) => `${toggle.tag}「${toggle.text || toggle.ariaLabel}」`).join("、") || "—"}
- 根变量：${Object.keys(rootVariables).length} 个${Object.keys(rootVariables).length ? `，如 ${Object.keys(rootVariables).slice(0, 12).join(", ")}` : ""}

## 交互探针

| 悬停 | 变化 |
| --- | --- |
${hoverRows.join("\n") || "| — | 未跑悬停探针 |"}

| 焦点 | 变化 |
| --- | --- |
${focusRows.join("\n") || "| — | 未观察到可见焦点样式 |"}

## 草稿角色（${roleRows.length}）

| 角色 | 来源 | 别名 | 证据 |
| --- | --- | --- | --- |
${roleRows.join("\n")}

## 缺口（${missingRows.length}）

先补 core 层；extended / shell 层按站点类型决定要不要。补法见 references/mapping-rules.md「缺口怎么补」。

| 角色 | 层 | 含义 | 找证据的位置 |
| --- | --- | --- | --- |
${missingRows.join("\n") || "| — | | | |"}

## 警告

${draft.notes.warnings.map((warning) => `- ${warning}`).join("\n") || "- 无"}
`;
  await writeText(path.join(outDir, "audit-summary.md"), summary);
  await writeJson(path.join(outDir, "draft-notes.json"), {
    alternateMode: alternate ? { key: alternate.key, scheme: alternate.scheme, source: alternate.source } : null,
    brand: { family: brandFamily, override: brandOverride ? toHex(brandOverride) : null, ranking: brandDetection.ranking },
    counts: { inferred: inferredCount, missing: draft.notes.missing.length, missingCore: coreMissing.length, observed: observedCount, primitives: countTokens(draft.primitives), themeDelta: themeTokens ? countTokens(themeTokens) : 0 },
    evidence: evidencePath,
    id: systemId,
    initialScheme,
    missing: draft.notes.missing,
    name: systemName,
    roles: draft.notes.roles,
    sources: pages.map((page) => ({ title: page.title, url: page.url })),
    themeMap,
    warnings: draft.notes.warnings
  });

  if (options.json === true) {
    printJson({ counts: { inferred: inferredCount, missing: draft.notes.missing.length, observed: observedCount, primitives: countTokens(draft.primitives) }, out: outDir, theme: themeId });
  } else {
    process.stdout.write(`草稿已写到 ${outDir}\n  primitives ${countTokens(draft.primitives)} 个 · 语义角色 观察 ${observedCount} / 推断 ${inferredCount} / 缺口 ${draft.notes.missing.length}（core 缺 ${coreMissing.length}）${themeId ? ` · Theme ${themeId} delta ${countTokens(themeTokens)} 条` : " · 无 Theme"}\n  先读 audit-summary.md，逐角色核对后再 scaffold-system.mjs 写入。\n`);
  }
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

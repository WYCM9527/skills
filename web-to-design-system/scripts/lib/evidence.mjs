// 证据合并与统计：把 extract-evidence 的多页 / 多视口 JSON 折成一份可推理的表（颜色按 hex 合并、配对、阶梯频次）。
import { deltaE, parseCssColor, toHex } from "./color.mjs";

export const sum = (values) => values.reduce((total, value) => total + value, 0);

export function desktopProbe(page) {
  return page.viewports?.desktop ?? Object.values(page.viewports ?? {})[0] ?? null;
}

function mergeKinds(target, kinds) {
  if (!kinds) {
    return target;
  }
  for (const [kind, count] of Object.entries(kinds)) {
    target[kind] = (target[kind] || 0) + count;
  }
  return target;
}

/** 把探针里的颜色条目（原始 CSS 字符串）合并成 Map(hex → 统计)。gradient 条目单独收进 gradients。 */
export function mergeColors(probes) {
  const byHex = new Map();
  const gradients = [];
  for (const probe of probes) {
    for (const entry of probe?.colors ?? []) {
      if (entry.key.startsWith("gradient:")) {
        gradients.push({ count: entry.count, css: entry.key.slice(9) });
        continue;
      }
      const rgba = parseCssColor(entry.key);
      if (!rgba || rgba.a === 0) {
        continue;
      }
      const hex = toHex(rgba);
      const current = byHex.get(hex) ?? { area: 0, bg: 0, border: 0, count: 0, hex, kinds: {}, raw: new Set(), rgba, text: 0, textCount: 0 };
      current.count += entry.count;
      current.text += entry.text ?? 0;
      current.textCount += entry.textCount ?? 0;
      current.bg += entry.bg ?? 0;
      current.area += entry.area ?? 0;
      current.border += entry.border ?? 0;
      current.maxFont = Math.max(current.maxFont ?? 0, entry.maxFont ?? 0);
      current.raw.add(entry.key);
      mergeKinds(current.kinds, entry.kinds);
      byHex.set(hex, current);
    }
  }
  return { colors: clusterNearDuplicates(byHex), gradients };
}

/** 抗锯齿 / 圆整产生的近似色并入更常见的那一个（OKLab ΔE < 0.012，透明度相同）。 */
export function clusterNearDuplicates(byHex, threshold = 0.012) {
  const sorted = [...byHex.values()].sort((left, right) => right.count - left.count);
  const kept = [];
  for (const color of sorted) {
    const host = kept.find((candidate) => candidate.rgba.a === color.rgba.a && deltaE(candidate.rgba, color.rgba) < threshold);
    if (host) {
      host.count += color.count;
      host.text += color.text;
      host.textCount += color.textCount;
      host.bg += color.bg;
      host.area += color.area;
      host.border += color.border;
      host.maxFont = Math.max(host.maxFont ?? 0, color.maxFont ?? 0);
      host.merged = [...(host.merged ?? []), color.hex];
      for (const raw of color.raw) {
        host.raw.add(raw);
      }
      mergeKinds(host.kinds, color.kinds);
      continue;
    }
    kept.push(color);
  }
  return new Map(kept.map((color) => [color.hex, color]));
}

/** 文字 / 底色配对：Map("fg|bg" → { fg, bg, count, text, kinds, size })，键是 hex。 */
export function mergePairs(probes, canonical) {
  const pairs = new Map();
  for (const probe of probes) {
    for (const entry of probe?.pairs ?? []) {
      const [fgRaw, bgRaw] = entry.key.split(" | ");
      const fg = parseCssColor(fgRaw);
      const bg = parseCssColor(bgRaw);
      if (!fg || !bg || fg.a === 0) {
        continue;
      }
      const fgHex = canonical(toHex(fg));
      const bgHex = canonical(toHex(bg));
      const key = `${fgHex}|${bgHex}`;
      const current = pairs.get(key) ?? { bg: bgHex, count: 0, fg: fgHex, kinds: {}, size: {}, text: 0 };
      current.count += entry.count;
      current.text += entry.text ?? 0;
      mergeKinds(current.kinds, entry.kinds);
      mergeKinds(current.size, entry.size);
      pairs.set(key, current);
    }
  }
  return pairs;
}

/** 通用频次表合并：[{ key, count, kinds, ... }] → Map(key → { key, count, kinds, ...求和 }) */
export function mergeCounts(probes, field, { numeric = true } = {}) {
  const merged = new Map();
  for (const probe of probes) {
    for (const entry of probe?.[field] ?? []) {
      const key = numeric && Number.isFinite(Number(entry.key)) ? String(Number(entry.key)) : String(entry.key);
      const current = merged.get(key) ?? { count: 0, key, kinds: {} };
      current.count += entry.count;
      mergeKinds(current.kinds, entry.kinds);
      for (const [name, value] of Object.entries(entry)) {
        if (typeof value === "number" && name !== "count") {
          current[name] = (current[name] || 0) + value;
        }
      }
      merged.set(key, current);
    }
  }
  return [...merged.values()].sort((left, right) => right.count - left.count);
}

export function kindScore(kinds, weights) {
  return sum(Object.entries(kinds ?? {}).map(([kind, count]) => (weights[kind] ?? 0) * count));
}

export function topKind(kinds) {
  return Object.entries(kinds ?? {}).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

/** 解析 box-shadow 文本为图层数组：[{ inset, x, y, blur, spread, color }]，颜色保留原文。 */
export function parseBoxShadow(text) {
  if (!text || text === "none") {
    return [];
  }
  const layers = [];
  let depth = 0;
  let current = "";
  for (const character of text) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      layers.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) {
    layers.push(current.trim());
  }
  return layers.map((layer) => {
    const inset = /\binset\b/.test(layer);
    const colorMatch = layer.match(/(rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\)|lch\([^)]*\)|color\([^)]*\)|#[0-9a-fA-F]{3,8}|\b[a-z]+\b(?=\s*$))/);
    const color = colorMatch ? colorMatch[0] : null;
    const rest = layer.replace(/\binset\b/, "").replace(color ?? "", "").trim();
    const lengths = rest.split(/\s+/).map((part) => Number.parseFloat(part)).filter((value) => Number.isFinite(value));
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
    return { blur, color, inset, spread, x, y };
  });
}

/** 缓动关键字 → 四点；cubic-bezier(...) 直接取数；无法识别返回 null。 */
export function parseTimingFunction(text) {
  const keyword = {
    ease: [0.25, 0.1, 0.25, 1],
    "ease-in": [0.42, 0, 1, 1],
    "ease-in-out": [0.42, 0, 0.58, 1],
    "ease-out": [0, 0, 0.58, 1],
    linear: [0, 0, 1, 1]
  };
  const trimmed = String(text ?? "").trim();
  if (keyword[trimmed]) {
    return keyword[trimmed];
  }
  const match = trimmed.match(/cubic-bezier\(\s*([^)]+)\)/);
  if (!match) {
    return null;
  }
  const points = match[1].split(",").map((part) => Number(part.trim()));
  return points.length === 4 && points.every((point) => Number.isFinite(point)) ? points : null;
}

/** 字体栈字符串 → 数组（去引号），保留顺序。 */
export function parseFontFamily(text) {
  return String(text ?? "")
    .split(",")
    .map((family) => family.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

export const isMonoStack = (families) => families.some((family) => /mono|menlo|consolas|courier|code|sf mono|fira code|jetbrains/i.test(family));

/** 把 px 值收到最近的阶梯：返回 { base, values } —— base 取 4 / 8 / 2 中让最多（按频次）值整除的那个。 */
export function detectBaseUnit(entries) {
  const weighted = (base) => sum(entries.map((entry) => (Number(entry.key) % base === 0 ? entry.count : 0)));
  const total = sum(entries.map((entry) => entry.count)) || 1;
  if (weighted(8) / total >= 0.7 && entries.filter((entry) => Number(entry.key) % 8 === 0).length >= 4) {
    return 8;
  }
  if (weighted(4) / total >= 0.6) {
    return 4;
  }
  return 2;
}

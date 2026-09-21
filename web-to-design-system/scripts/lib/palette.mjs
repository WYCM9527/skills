// 调色板归档：把观察到的颜色按 OKLCH 分成色族（neutral / brand / red / …）与 50～950 明度档，得到 Primitive 路径。
// 品牌族 = 在按钮填充、链接、强调边线上出现最多的有彩色族；同族撞档时向相邻半档（±50）挪，保证一色一名。
import { deltaE, hueFamily, lightnessStep, parseCssColor, rgbaToOklch, toHex } from "./color.mjs";

const NEAR_WHITE = 0.985;
const NEAR_BLACK = 0.12;
/** 同族里 OKLab ΔE 小于它的两个颜色合成一个 Primitive（#f5f7fa 与 #f4f4f5 这种肉眼不可分的相邻灰）。 */
const MERGE_DELTA_E = 0.012;

export class Palette {
  constructor({ brandFamily = null, brandHex = null } = {}) {
    this.brandFamily = brandFamily;
    this.brandHex = brandHex;
    this.entries = new Map(); // hex → { hex, rgba, oklch, family, path, count, usage, description }
    this.aliases = new Map(); // 被合并掉的 hex → 保留的 hex
    this.pathTaken = new Set();
  }

  /** 登记一个颜色（不立即命名）；重复登记只叠加用途说明与权重。 */
  add(cssColor, { count = 1, usage = null, description = null } = {}) {
    const rgba = typeof cssColor === "string" ? parseCssColor(cssColor) : cssColor;
    if (!rgba || rgba.a === 0) {
      return null;
    }
    const hex = toHex(rgba);
    const current = this.entries.get(hex) ?? { count: 0, descriptions: new Set(), hex, oklch: rgbaToOklch(rgba), rgba, usage: new Set() };
    current.count += count;
    if (usage) {
      current.usage.add(usage);
    }
    if (description) {
      current.descriptions.add(description);
    }
    this.entries.set(hex, current);
    return hex;
  }

  has(hex) {
    return this.entries.has(hex);
  }

  /** 半透明颜色由调用方先把 alpha 置 1 再传入（按本色分族）。 */
  familyOf(entry) {
    const { oklch } = entry;
    if (oklch.L >= NEAR_WHITE && oklch.C < 0.02) {
      return "white";
    }
    if (oklch.L <= NEAR_BLACK && oklch.C < 0.03) {
      return "black";
    }
    const family = hueFamily(oklch);
    if (this.brandFamily && family === this.brandFamily) {
      return "brand";
    }
    return family;
  }

  /** 同族近似色合并：按出现次数从高到低，ΔE < MERGE_DELTA_E 的并入更常见的那个，描述与用途一起并过去。 */
  mergeNearDuplicates() {
    const opaque = [...this.entries.values()].filter((entry) => entry.rgba.a >= 1).sort((left, right) => right.count - left.count);
    const kept = [];
    const mergeKey = (family) => (family === "white" || family === "black" ? "neutral" : family); // 近白 / 近黑与灰阶一起比
    for (const entry of opaque) {
      const family = this.familyOf(entry);
      const host = kept.find((candidate) => mergeKey(candidate.family) === mergeKey(family) && deltaE(candidate.rgba, entry.rgba) < MERGE_DELTA_E);
      if (!host) {
        entry.family = family;
        kept.push(entry);
        continue;
      }
      host.count += entry.count;
      for (const usage of entry.usage) host.usage.add(usage);
      host.descriptions.add(`合并近似色 ${entry.hex}：${[...entry.descriptions][0] ?? ""}`.trim());
      this.aliases.set(entry.hex, host.hex);
      this.entries.delete(entry.hex);
    }
  }

  /** 给所有已登记颜色分配 Primitive 路径。先合并近似色，opaque 按族 / 明度命名，半透明按「本色档 + -aNN」或用途名命名。 */
  assignNames() {
    this.mergeNearDuplicates();
    const opaque = [...this.entries.values()].filter((entry) => entry.rgba.a >= 1);
    const translucent = [...this.entries.values()].filter((entry) => entry.rgba.a < 1);
    const byFamily = new Map();
    for (const entry of opaque) {
      entry.family = this.familyOf(entry);
      if (entry.family === "white" || entry.family === "black") {
        entry.path = `color.${entry.family}`;
        // 多个近白 / 近黑：第二个起按 neutral 命名
        if (this.pathTaken.has(entry.path)) {
          entry.family = "neutral";
        } else {
          this.pathTaken.add(entry.path);
          continue;
        }
      }
      const list = byFamily.get(entry.family) ?? [];
      list.push(entry);
      byFamily.set(entry.family, list);
    }
    for (const [family, list] of byFamily) {
      list.sort((left, right) => right.oklch.L - left.oklch.L);
      const singleBrand = family === "brand" && list.length === 1;
      for (const entry of list) {
        const nominal = singleBrand ? 500 : lightnessStep(entry.oklch.L);
        entry.step = this.freeStep(family, nominal);
        entry.path = `color.${family}.${entry.step}`;
        this.pathTaken.add(entry.path);
      }
    }
    for (const entry of translucent) {
      const base = { ...entry.rgba, a: 1 };
      const baseOklch = rgbaToOklch(base);
      const baseFamily = this.familyOf({ oklch: baseOklch, rgba: base });
      // 不透明的 white / black 是叶子 token（color.white），半透明的不能再挂到它下面，统一归 neutral：neutral.shadow-1 / neutral.scrim / neutral.black-a60
      const fromExtreme = baseFamily === "white" || baseFamily === "black";
      entry.family = fromExtreme ? "neutral" : baseFamily;
      const alphaPercent = Math.round(entry.rgba.a * 100);
      const usage = [...entry.usage];
      let name;
      if (usage.includes("shadow")) {
        name = this.freeName(entry.family, "shadow", 1);
      } else if (usage.includes("overlay")) {
        name = this.freeName(entry.family, "scrim", 0);
      } else if (usage.includes("ring")) {
        name = this.freeName(entry.family, "ring", 0);
      } else if (usage.includes("mask")) {
        name = this.freeName(entry.family, "mask", 0);
      } else {
        const stem = fromExtreme ? `${baseFamily}-a${alphaPercent}` : `${lightnessStep(baseOklch.L)}-a${alphaPercent}`;
        name = this.freeName(entry.family, stem, 0);
      }
      entry.path = `color.${entry.family}.${name}`;
      this.pathTaken.add(entry.path);
    }
    return this;
  }

  /** 撞档时往相邻档挪：先整档（±50 / ±100），再半档（±25 / ±75 …），都满了才用 5 的倍数——密集灰阶也尽量得到 125 / 175 这类可读的名字。 */
  freeStep(family, nominal) {
    const free = (step) => step >= 25 && step <= 975 && !this.pathTaken.has(`color.${family}.${step}`);
    for (const delta of [0, 50, -50, 100, -100]) if (free(nominal + delta)) return nominal + delta;
    for (let distance = 25; distance <= 950; distance += 25) {
      if (free(nominal + distance)) return nominal + distance;
      if (free(nominal - distance)) return nominal - distance;
    }
    let fallback = nominal;
    while (!free(fallback)) fallback += 5;
    return fallback;
  }

  freeName(family, stem, startIndex) {
    if (startIndex === 0 && !this.pathTaken.has(`color.${family}.${stem}`)) {
      return stem;
    }
    let index = Math.max(1, startIndex);
    while (this.pathTaken.has(`color.${family}.${stem}-${index}`)) {
      index += 1;
    }
    return `${stem}-${index}`;
  }

  pathOf(cssColor) {
    const rgba = typeof cssColor === "string" ? parseCssColor(cssColor) : cssColor;
    if (!rgba) {
      return null;
    }
    return this.entryOf(toHex(rgba))?.path ?? null;
  }

  /** 被合并进别的颜色的 hex 也能查到宿主条目。 */
  entryOf(hex) {
    return this.entries.get(this.aliases.get(hex) ?? hex) ?? null;
  }

  /** 同族里比给定颜色更深（或更浅）的相邻档，用于推导 hover / active / subtle。找不到返回 null。 */
  neighbor(hex, direction = "darker") {
    const entry = this.entryOf(hex);
    if (!entry || !entry.family) {
      return null;
    }
    const siblings = [...this.entries.values()]
      .filter((candidate) => candidate.family === entry.family && candidate.rgba.a >= 1 && candidate.hex !== hex)
      .filter((candidate) => (direction === "darker" ? candidate.oklch.L < entry.oklch.L : candidate.oklch.L > entry.oklch.L))
      .sort((left, right) => Math.abs(left.oklch.L - entry.oklch.L) - Math.abs(right.oklch.L - entry.oklch.L));
    const pick = siblings.find((candidate) => Math.abs(candidate.oklch.L - entry.oklch.L) >= 0.03 && Math.abs(candidate.oklch.L - entry.oklch.L) <= 0.22);
    return pick ?? null;
  }

  families() {
    const result = {};
    for (const entry of this.entries.values()) {
      const family = entry.family ?? "?";
      result[family] = result[family] ?? [];
      result[family].push(entry);
    }
    for (const list of Object.values(result)) {
      list.sort((left, right) => right.oklch.L - left.oklch.L);
    }
    return result;
  }
}

/** 品牌族判定：按钮填充 ×4、链接色 ×2、边线 ×1、有彩色背景面积权重；neutral 不参与。 */
export function detectBrandFamily({ colors, buttons = [], links = [] }) {
  const score = new Map();
  const bump = (cssColor, weight) => {
    const rgba = parseCssColor(cssColor);
    if (!rgba || rgba.a < 0.5) {
      return;
    }
    const oklch = rgbaToOklch(rgba);
    const family = hueFamily(oklch);
    if (family === "neutral" || oklch.L > 0.97) {
      return;
    }
    score.set(family, (score.get(family) ?? 0) + weight);
  };
  for (const button of buttons) {
    bump(button.background, 4);
  }
  for (const link of links) {
    bump(link.color, 2);
  }
  for (const color of colors.values()) {
    bump(color.hex, Math.min(3, color.border) + Math.min(3, color.bg) * 0.5 + Math.min(2, color.textCount) * 0.5);
  }
  const ranked = [...score.entries()].sort((left, right) => right[1] - left[1]);
  return ranked[0] ? { family: ranked[0][0], ranking: ranked } : { family: null, ranking: [] };
}

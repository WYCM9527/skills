// DTCG 2025.10 CSS Profile 的 token 构造与读取：只产出 steward 校验器认识的九种基础类型，颜色永远是结构化 sRGB + hex，
// 尺寸 / 时长永远是 { value, unit } 对象；alias 用完整引用 "{a.b.c}"。变量名算法与 Style Dictionary css transformGroup 一致。
import { parseCssColor, toDtcgColorValue } from "./color.mjs";

const withDescription = (token, description) => {
  if (typeof description === "string" && description.trim()) {
    token.$description = description.trim();
  }
  return token;
};

export function colorToken(cssColor, description) {
  const rgba = typeof cssColor === "string" ? parseCssColor(cssColor) : cssColor;
  if (!rgba) {
    throw new Error(`无法解析颜色：${cssColor}`);
  }
  return withDescription({ $type: "color", $value: toDtcgColorValue(rgba) }, description);
}

export function dimensionToken(value, unit = "px", description) {
  return withDescription({ $type: "dimension", $value: { unit, value: Number(value) } }, description);
}

export function durationToken(value, unit = "ms", description) {
  return withDescription({ $type: "duration", $value: { unit, value: Number(value) } }, description);
}

export function numberToken(value, description) {
  return withDescription({ $type: "number", $value: Number(value) }, description);
}

export function fontWeightToken(value, description) {
  return withDescription({ $type: "fontWeight", $value: typeof value === "string" ? value : Number(value) }, description);
}

export function fontFamilyToken(families, description) {
  const list = Array.isArray(families) ? families : [families];
  return withDescription({ $type: "fontFamily", $value: list.map((family) => String(family).trim()).filter(Boolean) }, description);
}

export function cubicBezierToken(points, description) {
  if (!Array.isArray(points) || points.length !== 4) {
    throw new Error(`cubicBezier 需要 4 个数字：${JSON.stringify(points)}`);
  }
  return withDescription({ $type: "cubicBezier", $value: points.map(Number) }, description);
}

export function stringToken(value, description) {
  return withDescription({ $type: "string", $value: String(value) }, description);
}

export function aliasToken(type, targetPath, description) {
  return withDescription({ $type: type, $value: `{${targetPath}}` }, description);
}

/** 把 token 写进嵌套对象的路径（"color.brand.500"）。中途碰到已存在的 token（带 $value）会报错，避免静默覆盖。 */
export function setPath(document, tokenPath, token) {
  const parts = tokenPath.split(".");
  let node = document;
  for (const part of parts.slice(0, -1)) {
    if (node[part] === undefined) {
      node[part] = {};
    } else if (Object.hasOwn(node[part], "$value")) {
      throw new Error(`${tokenPath} 的祖先 ${part} 已经是一个 token`);
    }
    node = node[part];
  }
  const last = parts.at(-1);
  if (node[last] !== undefined && Object.hasOwn(node[last], "$value")) {
    throw new Error(`token 已存在：${tokenPath}`);
  }
  node[last] = token;
  return document;
}

export function getPath(document, tokenPath) {
  let node = document;
  for (const part of tokenPath.split(".")) {
    if (!node || typeof node !== "object" || !(part in node)) {
      return undefined;
    }
    node = node[part];
  }
  return node;
}

export function hasPath(document, tokenPath) {
  const node = getPath(document, tokenPath);
  return Boolean(node) && typeof node === "object" && Object.hasOwn(node, "$value");
}

/** 展平成 Map(path → { type, value, description })，跟 steward 一样跳过 $ 开头的元数据键，$type 可继承。 */
export function flattenTokens(document, tokens = new Map(), prefix = [], inheritedType) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return tokens;
  }
  const type = typeof document.$type === "string" ? document.$type : inheritedType;
  if (Object.hasOwn(document, "$value")) {
    tokens.set(prefix.join("."), {
      description: document.$description,
      path: prefix.join("."),
      type,
      value: document.$value
    });
    return tokens;
  }
  for (const key of Object.keys(document)) {
    if (!key.startsWith("$")) {
      flattenTokens(document[key], tokens, [...prefix, key], type);
    }
  }
  return tokens;
}

export const isAlias = (value) => typeof value === "string" && /^\{[^{}]+\}$/.test(value);
export const aliasTarget = (value) => (isAlias(value) ? value.slice(1, -1) : null);

/**
 * 解析到最终原始值。layers 是按覆盖顺序排列的 Map 数组（Core 在前、Theme delta 在后）：
 * 查某个路径时后面的层优先，alias 目标继续在同一组层里找（Theme 覆写的用途会带动依赖它的别名一起变）。
 */
export function resolveToken(layers, tokenPath, seen = new Set()) {
  if (seen.has(tokenPath)) {
    throw new Error(`alias 成环：${[...seen, tokenPath].join(" → ")}`);
  }
  let token;
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    if (layers[index].has(tokenPath)) {
      token = layers[index].get(tokenPath);
      break;
    }
  }
  if (!token) {
    return null;
  }
  const target = aliasTarget(token.value);
  if (target) {
    seen.add(tokenPath);
    const resolved = resolveToken(layers, target, seen);
    return resolved ? { ...resolved, path: tokenPath, via: target } : null;
  }
  return { path: tokenPath, type: token.type, value: token.value };
}

/** 与 steward `cssVariableNameForTokenPath` / Style Dictionary `name/kebab` 同一结果：--color-brand-500、--spacing-0-5。 */
export function cssVariableName(tokenPath) {
  return tokenPath
    .split(".")
    .map((segment) => segment
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-"))
    .join("-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** 原始值 → CSS 文本（与种子 style-dictionary 配置的 cssValue 同一规则）。 */
export function cssValueOf(resolved) {
  if (!resolved) {
    return null;
  }
  const { type, value } = resolved;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.hex === "string") {
      return value.hex;
    }
    if ((type === "dimension" || type === "duration") && typeof value.value === "number") {
      return `${value.value}${value.unit}`;
    }
    return null;
  }
  if (Array.isArray(value)) {
    return type === "cubicBezier" ? `cubic-bezier(${value.join(", ")})` : value.join(", ");
  }
  return String(value);
}

/** 阶梯键排序值："0-5" → 0.5、"10" → 10、"2xl" → NaN（非数字键落在数字键之后、按字典序）。 */
function stepOrder(key) {
  return /^\d+(-\d+)?$/.test(key) ? Number(key.replace("-", ".")) : Number.NaN;
}

/**
 * 整理整棵 token 树（$ 元数据键在前，数字阶梯按数值，其余按字典序），写文件前调用，保证稳定 diff。
 * 注意 JS 对象会把整数样的键（"1"、"10"）永远排在最前并按数值升序，"0-5" 这类非整数键只能排在它们之后——JSON.stringify 也一样，
 * 所以文件里 spacing 的顺序是 1, 2, 3 … 然后 0-5, 1-5；这是语言限制，不影响构建结果。
 */
export function sortTokenTree(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return node;
  }
  const keys = Object.keys(node).sort((left, right) => {
    const leftMeta = left.startsWith("$");
    const rightMeta = right.startsWith("$");
    if (leftMeta !== rightMeta) {
      return leftMeta ? -1 : 1;
    }
    const leftStep = stepOrder(left);
    const rightStep = stepOrder(right);
    const leftNumeric = Number.isFinite(leftStep);
    const rightNumeric = Number.isFinite(rightStep);
    if (leftNumeric && rightNumeric) {
      return leftStep - rightStep || left.localeCompare(right);
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    return left.localeCompare(right);
  });
  return Object.fromEntries(keys.map((key) => [key, key.startsWith("$") ? node[key] : sortTokenTree(node[key])]));
}

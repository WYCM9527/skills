import path from "node:path";
import { readFile } from "node:fs/promises";

import {
  collectReferences,
  relativePosix,
  walkFiles
} from "./lib.mjs";

export const DTCG_TYPES = new Set([
  "color",
  "dimension",
  "fontFamily",
  "fontWeight",
  "duration",
  "cubicBezier",
  "number",
  "strokeStyle",
  "border",
  "transition",
  "shadow",
  "gradient",
  "typography",
  "link",
  "boolean",
  "string",
  "other"
]);

export const CSS_PROFILE_TYPES = new Set([
  "boolean",
  "color",
  "cubicBezier",
  "dimension",
  "duration",
  "fontFamily",
  "fontWeight",
  "number",
  "string"
]);

const CSS_DIMENSION_UNITS = new Set(["px", "rem", "em", "%", "vw", "vh"]);
const CSS_DURATION_UNITS = new Set(["ms", "s"]);
const HEX_EXPRESSION = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const ISSUE_ZH = {
  "alias-cycle": "Token 之间互相引用形成了环，需要先拆开",
  "alias-type-mismatch": "引用的 Token 类型不一致",
  "color-hex-mismatch": "hex 色值与 sRGB 分量换算结果不一致，请先核对",
  "dangling-alias": "引用了一个不存在的 Token",
  "duplicate-token": "同一个 Token 出现在多个文件里",
  "empty-scaffold": "刚初始化，待填入已确认的 token",
  "invalid-boolean": "布尔值格式不对",
  "invalid-color": "sRGB 分量或透明度不在 0～1 之间",
  "invalid-color-hex": "hex 字段不是合法的 #RGB / #RRGGBB 色值",
  "invalid-cubic-bezier": "贝塞尔曲线必须是 4 个数字",
  "invalid-dimension": "尺寸必须带 px、rem、em、%、vw 或 vh",
  "invalid-duration": "时长必须带 ms 或 s",
  "invalid-font-family": "字体名称格式不对",
  "invalid-font-weight": "字重必须是数字或字符串",
  "invalid-group": "这一层必须是对象",
  "invalid-json": "JSON 无法解析",
  "invalid-number": "必须是数字",
  "invalid-string": "必须是字符串",
  "missing-type": "缺少 $type",
  "no-token-files": "还没有 *.tokens.json 文件",
  "no-tokens": "Token 文件还没有具体值",
  "unnamed-token": "不能把整个文件当成一个匿名 Token",
  "unknown-type": "不是本 Skill 认识的 DTCG 类型",
  "unsupported-color": "颜色必须用带 colorSpace 和 components 的结构化 sRGB；可选 hex 需与分量一致，不能只写 #hex 字符串",
  "unsupported-css-profile-type": "这个 DTCG 类型当前不会建成 CSS",
  "core-reverse-reference": "全站 Token 不能引用局部或主题里的 Token",
  "missing-core-tokens": "缺少 design-system/tokens 目录",
  "missing-theme-map": "已经有 themes 目录时，必须先有 theme-map.json",
  "missing-scope-map": "已经有 scopes 目录时，必须先有 scope-map.json",
  "invalid-theme-activation": "主题激活方式只能是 data 属性、class 或系统偏好",
  "theme-primitive-not-allowed": "主题不能另建一套调色盘，只能改用途层的值",
  "scope-theme-delta-not-managed": "这块局部装修和主题改了同一个用途值；当前不会自动组合，接入前请确认每个主题下看起来都对",
  "invalid-exemptions-file": "exemptions.json 无法解析，或缺少 exemptions 数组",
  "invalid-exemption-entry": "豁免条目必须是对象，且 path 是项目内的相对路径",
  "missing-exemption-reason": "每条豁免都必须写明理由，不能匿名放弃规范化",
  "stale-exemption": "这条豁免指向的文件已不存在，可以顺手清掉这条登记"
};

export function localizeIssues(issues) {
  return issues.map((current) => {
    const zh = ISSUE_ZH[current.code];
    if (!zh || /[\u4e00-\u9fff]/.test(current.message)) {
      return current;
    }
    return { ...current, message: `${current.message}。${zh}` };
  });
}

export function normalizeHex(hex) {
  if (typeof hex !== "string" || !HEX_EXPRESSION.test(hex.trim())) {
    return null;
  }
  let body = hex.trim().slice(1).toLowerCase();
  if (body.length === 3 || body.length === 4) {
    body = [...body].map((character) => `${character}${character}`).join("");
  }
  if (body.length === 8 && body.endsWith("ff")) {
    body = body.slice(0, 6);
  }
  return `#${body}`;
}

export function srgbToHex(components, alpha = 1) {
  const toByte = (value) => Math.round(Math.min(1, Math.max(0, value)) * 255)
    .toString(16)
    .padStart(2, "0");
  const rgb = `${toByte(components[0])}${toByte(components[1])}${toByte(components[2])}`;
  if (typeof alpha === "number" && alpha < 1) {
    return `#${rgb}${toByte(alpha)}`;
  }
  return `#${rgb}`;
}

export function isScaffoldOnlyDocument(document) {
  return isObject(document) && Object.keys(document).every((key) => key.startsWith("$"));
}

const DIMENSION_LITERAL_EXPRESSION = /^(-?\d+(?:\.\d+)?)(px|rem|em|%|vw|vh)$/;

/**
 * Normalize a CSS color literal (#hex, rgb(), rgba()) to a canonical lowercase
 * hex string, or return null when the text is not a statically resolvable
 * sRGB color. hsl()/oklch() and var() expressions stay out of scope on purpose.
 */
export function normalizeColorLiteral(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const text = raw.trim().toLowerCase();
  const hex = normalizeHex(text);
  if (hex) {
    return hex;
  }
  const call = text.match(/^rgba?\(\s*([^)]*?)\s*\)$/);
  if (!call) {
    return null;
  }
  const parts = call[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) {
    return null;
  }
  const channel = (part) => {
    if (part.endsWith("%")) {
      const percent = Number(part.slice(0, -1));
      return Number.isFinite(percent) && percent >= 0 && percent <= 100
        ? Math.round((percent / 100) * 255)
        : null;
    }
    const value = Number(part);
    return Number.isFinite(value) && value >= 0 && value <= 255 ? Math.round(value) : null;
  };
  const channels = parts.slice(0, 3).map(channel);
  if (channels.some((value) => value === null)) {
    return null;
  }
  let alpha = 1;
  if (parts.length === 4) {
    alpha = parts[3].endsWith("%") ? Number(parts[3].slice(0, -1)) / 100 : Number(parts[3]);
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      return null;
    }
  }
  const toByte = (value) => value.toString(16).padStart(2, "0");
  const body = channels.map(toByte).join("");
  return alpha < 1 ? `#${body}${toByte(Math.round(alpha * 255))}` : `#${body}`;
}

/**
 * Normalize a CSS dimension literal such as `16px` or `1.5rem`. When
 * `remInPx` is provided, rem values are converted to their px equivalent so
 * they can match px-based tokens; this stays opt-in because a project may
 * change its root font size.
 */
export function normalizeDimensionLiteral(raw, options = {}) {
  if (typeof raw !== "string") {
    return null;
  }
  const match = raw.trim().toLowerCase().match(DIMENSION_LITERAL_EXPRESSION);
  if (!match) {
    return null;
  }
  let value = Number(match[1]);
  let unit = match[2];
  if (unit === "rem" && typeof options.remInPx === "number" && Number.isFinite(options.remInPx)) {
    value *= options.remInPx;
    unit = "px";
  }
  return `${value}${unit}`;
}

/**
 * Mirror Style Dictionary's css transform group naming so replacement code
 * can print `var(--…)` names that match the generated dist output.
 */
export function cssVariableNameForTokenPath(tokenPath) {
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

function issue(issues, code, message, details = {}) {
  issues.push({ code, message, severity: "error", ...details });
}

export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function tokenLayerForFile(file) {
  const basename = path.basename(file);
  if (basename === "primitives.tokens.json") {
    return "primitive";
  }
  if (basename === "semantic.tokens.json") {
    return "semantic";
  }
  if (basename === "components.tokens.json") {
    return "component";
  }
  return "unknown";
}

function validatePrimitiveValue(token, issues) {
  if (typeof token.value === "string" && /^\{[^{}]+\}$/.test(token.value)) {
    return;
  }

  const label = token.path;
  switch (token.type) {
    case "color": {
      if (!isObject(token.value) || token.value.colorSpace !== "srgb") {
        issue(issues, "unsupported-color", `${label} must use a structured srgb color value`, { token: label });
        return;
      }
      const { components, alpha = 1, hex } = token.value;
      const validComponents = Array.isArray(components)
        && components.length === 3
        && components.every((component) => typeof component === "number" && component >= 0 && component <= 1);
      if (!validComponents || typeof alpha !== "number" || alpha < 0 || alpha > 1) {
        issue(issues, "invalid-color", `${label} has invalid srgb components or alpha`, { token: label });
        return;
      }
      if (hex !== undefined) {
        const normalized = normalizeHex(hex);
        if (!normalized) {
          issue(issues, "invalid-color-hex", `${label} hex must be a #RGB, #RRGGBB, or #RRGGBBAA value`, { token: label });
          return;
        }
        const expected = srgbToHex(components, alpha);
        if (normalized !== expected) {
          issue(issues, "color-hex-mismatch", `${label} hex ${hex} does not match srgb components (expected ${expected})`, {
            expected,
            hex,
            token: label
          });
        }
      }
      return;
    }
    case "dimension": {
      if (!isObject(token.value)
        || typeof token.value.value !== "number"
        || !CSS_DIMENSION_UNITS.has(token.value.unit)) {
        issue(issues, "invalid-dimension", `${label} must use a supported structured CSS dimension`, { token: label });
      }
      return;
    }
    case "duration": {
      if (!isObject(token.value)
        || typeof token.value.value !== "number"
        || !CSS_DURATION_UNITS.has(token.value.unit)) {
        issue(issues, "invalid-duration", `${label} must use a supported structured CSS duration`, { token: label });
      }
      return;
    }
    case "number":
      if (typeof token.value !== "number") {
        issue(issues, "invalid-number", `${label} must be a number`, { token: label });
      }
      return;
    case "fontWeight":
      if (typeof token.value !== "number" && typeof token.value !== "string") {
        issue(issues, "invalid-font-weight", `${label} must be a number or string`, { token: label });
      }
      return;
    case "fontFamily":
      if (typeof token.value !== "string"
        && (!Array.isArray(token.value) || !token.value.every((family) => typeof family === "string"))) {
        issue(issues, "invalid-font-family", `${label} must be a string or string array`, { token: label });
      }
      return;
    case "cubicBezier":
      if (!Array.isArray(token.value)
        || token.value.length !== 4
        || !token.value.every((point) => typeof point === "number")) {
        issue(issues, "invalid-cubic-bezier", `${label} must be an array of four numbers`, { token: label });
      }
      return;
    case "string":
      if (typeof token.value !== "string") {
        issue(issues, "invalid-string", `${label} must be a string`, { token: label });
      }
      return;
    case "boolean":
      if (typeof token.value !== "boolean") {
        issue(issues, "invalid-boolean", `${label} must be a boolean`, { token: label });
      }
      return;
    default:
      issue(
        issues,
        "unsupported-css-profile-type",
        `${label} uses ${token.type}, which is valid DTCG territory but unsupported by this CSS profile`,
        { token: label, type: token.type }
      );
  }
}

function flattenDocument(document, file, root, tokens, issues) {
  function visit(node, parts, inheritedType) {
    if (!isObject(node)) {
      issue(issues, "invalid-group", `${parts.join(".") || "root"} must be an object`, {
        file: relativePosix(root, file)
      });
      return;
    }

    const type = typeof node.$type === "string" ? node.$type : inheritedType;
    if (Object.hasOwn(node, "$value")) {
      const tokenPath = parts.join(".");
      if (!tokenPath) {
        issue(issues, "unnamed-token", "A token cannot be the document root", {
          file: relativePosix(root, file)
        });
        return;
      }
      if (!type) {
        issue(issues, "missing-type", `${tokenPath} has no inherited or local $type`, {
          file: relativePosix(root, file),
          token: tokenPath
        });
        return;
      }
      if (!DTCG_TYPES.has(type)) {
        issue(issues, "unknown-type", `${tokenPath} uses unknown DTCG type ${type}`, {
          file: relativePosix(root, file),
          token: tokenPath,
          type
        });
        return;
      }
      if (tokens.has(tokenPath)) {
        issue(issues, "duplicate-token", `${tokenPath} appears in more than one token file`, {
          file: relativePosix(root, file),
          token: tokenPath
        });
        return;
      }
      tokens.set(tokenPath, {
        file: relativePosix(root, file),
        path: tokenPath,
        references: collectReferences(node.$value),
        type,
        value: node.$value,
        layer: tokenLayerForFile(file)
      });
      return;
    }

    for (const key of Object.keys(node).sort((left, right) => left.localeCompare(right))) {
      if (!key.startsWith("$")) {
        visit(node[key], [...parts, key], type);
      }
    }
  }

  visit(document, [], undefined);
}

function findCycles(tokens, issues) {
  const state = new Map();
  const stack = [];

  function visit(tokenPath) {
    const current = state.get(tokenPath) ?? "unseen";
    if (current === "visiting") {
      const start = stack.indexOf(tokenPath);
      const cycle = [...stack.slice(start), tokenPath];
      issue(issues, "alias-cycle", `Alias cycle: ${cycle.join(" → ")}`, { cycle });
      return;
    }
    if (current === "done") {
      return;
    }

    state.set(tokenPath, "visiting");
    stack.push(tokenPath);
    for (const reference of tokens.get(tokenPath).references) {
      if (tokens.has(reference)) {
        visit(reference);
      }
    }
    stack.pop();
    state.set(tokenPath, "done");
  }

  for (const tokenPath of [...tokens.keys()].sort((left, right) => left.localeCompare(right))) {
    visit(tokenPath);
  }
}

/**
 * Load DTCG CSS-profile token files without resolving aliases. The returned
 * Map stays internal to script callers so a system validator can compose a
 * Core plus Scope inheritance chain deterministically.
 */
export async function loadTokenDirectory(tokensRoot) {
  const issues = [];
  const tokenFiles = (await walkFiles(tokensRoot, { ignoredDirectories: new Set() }))
    .filter((file) => file.endsWith(".tokens.json"))
    .sort((left, right) => left.localeCompare(right));
  const tokens = new Map();
  let scaffoldOnly = tokenFiles.length > 0;

  for (const file of tokenFiles) {
    let document;
    try {
      document = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      scaffoldOnly = false;
      issue(issues, "invalid-json", `Cannot parse ${relativePosix(tokensRoot, file)}: ${error.message}`, {
        file: relativePosix(tokensRoot, file)
      });
      continue;
    }
    if (!isScaffoldOnlyDocument(document)) {
      scaffoldOnly = false;
    }
    flattenDocument(document, file, tokensRoot, tokens, issues);
  }

  return {
    issues,
    scaffoldOnly: scaffoldOnly && tokens.size === 0,
    tokenCount: tokens.size,
    tokenFiles: tokenFiles.map((file) => relativePosix(tokensRoot, file)),
    tokens
  };
}

/**
 * Validate already-loaded token records. A system validator can turn an
 * otherwise dangling alias into a more useful Scope-boundary error.
 */
export function validateTokenRecords(tokens, issues, options = {}) {
  const {
    allowEmpty = false,
    tokenFiles = [],
    onMissingReference
  } = options;

  if (tokenFiles.length === 0 && !allowEmpty) {
    issue(issues, "no-token-files", "No *.tokens.json files found", {});
  }
  if (tokens.size === 0 && tokenFiles.length > 0 && !allowEmpty) {
    issue(issues, "no-tokens", "Token files contain no token values yet", {});
  }

  for (const token of tokens.values()) {
    for (const reference of token.references) {
      const target = tokens.get(reference);
      if (!target) {
        const handled = typeof onMissingReference === "function"
          ? onMissingReference(token, reference)
          : false;
        if (!handled) {
          issue(issues, "dangling-alias", `${token.path} references missing token ${reference}`, {
            token: token.path,
            reference
          });
        }
        continue;
      }
      if (target.type !== token.type) {
        issue(issues, "alias-type-mismatch", `${token.path} (${token.type}) references ${reference} (${target.type})`, {
          token: token.path,
          reference
        });
      }
    }
    validatePrimitiveValue(token, issues);
  }

  findCycles(tokens, issues);
}

export function finalizeTokenValidation({ issues, tokenCount, tokenFiles }) {
  const localized = localizeIssues(issues);
  localized.sort((left, right) => `${left.code}:${left.token ?? ""}:${left.message}`.localeCompare(`${right.code}:${right.token ?? ""}:${right.message}`));
  return {
    cssProfile: "dtcg-2025.10-css-subset",
    issues: localized,
    tokenCount,
    tokenFiles,
    valid: localized.every((current) => current.severity !== "error")
  };
}

export async function validateTokenDirectory(tokensRoot, options = {}) {
  const loaded = await loadTokenDirectory(tokensRoot);
  validateTokenRecords(loaded.tokens, loaded.issues, {
    allowEmpty: options.allowEmpty === true,
    tokenFiles: loaded.tokenFiles
  });
  return finalizeTokenValidation(loaded);
}

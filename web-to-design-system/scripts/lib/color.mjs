// 颜色数学：解析浏览器算出的任意 CSS 颜色（rgb / hex / hsl / oklch / oklab / color(srgb|display-p3)）→ sRGB 字节；
// OKLCH 换算用于色族分类与明度分档；WCAG 对比度用于验收基线。全部纯函数，无依赖。

const NAMED = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  red: { r: 255, g: 0, b: 0, a: 1 },
  green: { r: 0, g: 128, b: 0, a: 1 },
  blue: { r: 0, g: 0, b: 255, a: 1 },
  yellow: { r: 255, g: 255, b: 0, a: 1 },
  orange: { r: 255, g: 165, b: 0, a: 1 },
  purple: { r: 128, g: 0, b: 128, a: 1 },
  gray: { r: 128, g: 128, b: 128, a: 1 },
  grey: { r: 128, g: 128, b: 128, a: 1 },
  silver: { r: 192, g: 192, b: 192, a: 1 },
  navy: { r: 0, g: 0, b: 128, a: 1 },
  teal: { r: 0, g: 128, b: 128, a: 1 },
  maroon: { r: 128, g: 0, b: 0, a: 1 },
  olive: { r: 128, g: 128, b: 0, a: 1 },
  lime: { r: 0, g: 255, b: 0, a: 1 },
  aqua: { r: 0, g: 255, b: 255, a: 1 },
  cyan: { r: 0, g: 255, b: 255, a: 1 },
  fuchsia: { r: 255, g: 0, b: 255, a: 1 },
  magenta: { r: 255, g: 0, b: 255, a: 1 },
  whitesmoke: { r: 245, g: 245, b: 245, a: 1 },
  gainsboro: { r: 220, g: 220, b: 220, a: 1 },
  lightgray: { r: 211, g: 211, b: 211, a: 1 },
  lightgrey: { r: 211, g: 211, b: 211, a: 1 },
  darkgray: { r: 169, g: 169, b: 169, a: 1 },
  dimgray: { r: 105, g: 105, b: 105, a: 1 }
};

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const clampByte = (value) => Math.min(255, Math.max(0, Math.round(value)));

function numberOrPercent(part, scale) {
  if (part === "none") {
    return 0;
  }
  if (part.endsWith("%")) {
    const percent = Number(part.slice(0, -1));
    return Number.isFinite(percent) ? (percent / 100) * scale : null;
  }
  const value = Number(part);
  return Number.isFinite(value) ? value : null;
}

function parseAlpha(part) {
  if (part === undefined) {
    return 1;
  }
  const alpha = numberOrPercent(part, 1);
  return alpha === null ? null : clamp01(alpha);
}

function splitFunctionArgs(body) {
  const [main, alphaPart] = body.split("/").map((segment) => segment.trim());
  const parts = main.split(/[\s,]+/).filter(Boolean);
  return { parts, alphaPart };
}

function linearToSrgb(channel) {
  const c = channel <= 0.0031308 ? channel * 12.92 : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
  return clamp01(c);
}

function srgbToLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function oklabToLinearSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
}

function linearSrgbToOklab(r, g, b) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  };
}

/** CIE Lab（D50）→ XYZ D50 → Bradford 适配到 D65 → 线性 sRGB；矩阵取自 CSS Color 4。 */
function labToLinearSrgb(L, a, b) {
  const kappa = 24389 / 27;
  const epsilon = 216 / 24389;
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const xr = fx ** 3 > epsilon ? fx ** 3 : (116 * fx - 16) / kappa;
  const yr = L > kappa * epsilon ? ((L + 16) / 116) ** 3 : L / kappa;
  const zr = fz ** 3 > epsilon ? fz ** 3 : (116 * fz - 16) / kappa;
  const X50 = xr * 0.3457 / 0.3585;
  const Y50 = yr;
  const Z50 = zr * (1 - 0.3457 - 0.3585) / 0.3585;
  const X = 0.9554734527042182 * X50 - 0.023098536874261423 * Y50 + 0.0632593086610217 * Z50;
  const Y = -0.028369706963208136 * X50 + 1.0099954580058226 * Y50 + 0.021041398966943008 * Z50;
  const Z = 0.012314001688319899 * X50 - 0.020507696433477912 * Y50 + 1.3303659366080753 * Z50;
  return [
    3.2409699419045226 * X - 1.537383177570094 * Y - 0.4986107602930034 * Z,
    -0.9692436362808796 * X + 1.8759675015077202 * Y + 0.04155505740717559 * Z,
    0.05563007969699366 * X - 0.20397695888897652 * Y + 1.0569715142428786 * Z
  ];
}

function fromLinear(linear, alpha) {
  return {
    r: clampByte(linearToSrgb(linear[0]) * 255),
    g: clampByte(linearToSrgb(linear[1]) * 255),
    b: clampByte(linearToSrgb(linear[2]) * 255),
    a: alpha
  };
}

function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - chroma / 2;
  let rgb;
  if (hue < 60) rgb = [chroma, x, 0];
  else if (hue < 120) rgb = [x, chroma, 0];
  else if (hue < 180) rgb = [0, chroma, x];
  else if (hue < 240) rgb = [0, x, chroma];
  else if (hue < 300) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  return rgb.map((channel) => clampByte((channel + m) * 255));
}

/**
 * 解析 CSS 颜色字面量为 { r, g, b, a }（字节 + 0～1 透明度）。无法静态求值（var()、currentcolor、color-mix）返回 null。
 */
export function parseCssColor(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const text = raw.trim().toLowerCase();
  if (!text) {
    return null;
  }
  if (NAMED[text]) {
    return { ...NAMED[text] };
  }
  const hex = text.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let body = hex[1];
    if (body.length === 3 || body.length === 4) {
      body = [...body].map((character) => character + character).join("");
    }
    if (body.length !== 6 && body.length !== 8) {
      return null;
    }
    const value = Number.parseInt(body, 16);
    if (body.length === 6) {
      return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255, a: 1 };
    }
    return {
      r: (value >>> 24) & 255,
      g: (value >>> 16) & 255,
      b: (value >>> 8) & 255,
      a: Number(((value & 255) / 255).toFixed(4))
    };
  }
  const call = text.match(/^([a-z-]+)\((.*)\)$/);
  if (!call) {
    return null;
  }
  const [, name, body] = call;
  const { parts, alphaPart } = splitFunctionArgs(body);
  if (name === "rgb" || name === "rgba") {
    if (parts.length < 3) {
      return null;
    }
    const channels = parts.slice(0, 3).map((part) => numberOrPercent(part, 255));
    const alpha = parseAlpha(alphaPart ?? parts[3]);
    if (channels.some((channel) => channel === null) || alpha === null) {
      return null;
    }
    return { r: clampByte(channels[0]), g: clampByte(channels[1]), b: clampByte(channels[2]), a: alpha };
  }
  if (name === "hsl" || name === "hsla") {
    if (parts.length < 3) {
      return null;
    }
    const h = Number(parts[0].replace(/deg$/, ""));
    const s = numberOrPercent(parts[1], 1);
    const l = numberOrPercent(parts[2], 1);
    const alpha = parseAlpha(alphaPart ?? parts[3]);
    if (![h, s, l].every((value) => Number.isFinite(value)) || alpha === null) {
      return null;
    }
    const [r, g, b] = hslToRgb(h, clamp01(s), clamp01(l));
    return { r, g, b, a: alpha };
  }
  if (name === "lab" || name === "lch") {
    // CSS Color 4：lab() / lch() 用 D50 白点；Chrome 会把 Tailwind v4 的 oklch 颜色算成 lab() 序列化出来
    if (parts.length < 3) {
      return null;
    }
    const L = numberOrPercent(parts[0], 100);
    const alpha = parseAlpha(alphaPart);
    if (L === null || alpha === null) {
      return null;
    }
    let a;
    let b;
    if (name === "lch") {
      const C = numberOrPercent(parts[1], 150);
      const H = parts[2] === "none" ? 0 : Number(parts[2].replace(/deg$/, ""));
      if (C === null || !Number.isFinite(H)) {
        return null;
      }
      a = C * Math.cos((H * Math.PI) / 180);
      b = C * Math.sin((H * Math.PI) / 180);
    } else {
      a = numberOrPercent(parts[1], 125);
      b = numberOrPercent(parts[2], 125);
      if (a === null || b === null) {
        return null;
      }
    }
    return fromLinear(labToLinearSrgb(L, a, b), alpha);
  }
  if (name === "oklch" || name === "oklab") {
    if (parts.length < 3) {
      return null;
    }
    const L = numberOrPercent(parts[0], 1);
    const alpha = parseAlpha(alphaPart);
    if (L === null || alpha === null) {
      return null;
    }
    let a;
    let b;
    if (name === "oklch") {
      const C = numberOrPercent(parts[1], 0.4);
      const H = parts[2] === "none" ? 0 : Number(parts[2].replace(/deg$/, ""));
      if (C === null || !Number.isFinite(H)) {
        return null;
      }
      a = C * Math.cos((H * Math.PI) / 180);
      b = C * Math.sin((H * Math.PI) / 180);
    } else {
      a = numberOrPercent(parts[1], 0.4);
      b = numberOrPercent(parts[2], 0.4);
      if (a === null || b === null) {
        return null;
      }
    }
    return fromLinear(oklabToLinearSrgb(L, a, b), alpha);
  }
  if (name === "color") {
    const space = parts[0];
    const channels = parts.slice(1, 4).map((part) => numberOrPercent(part, 1));
    const alpha = parseAlpha(alphaPart);
    if (channels.length !== 3 || channels.some((channel) => channel === null) || alpha === null) {
      return null;
    }
    if (space === "srgb") {
      return { r: clampByte(channels[0] * 255), g: clampByte(channels[1] * 255), b: clampByte(channels[2] * 255), a: alpha };
    }
    if (space === "srgb-linear") {
      return fromLinear(channels, alpha);
    }
    if (space === "display-p3") {
      const linear = channels.map(srgbToLinear);
      const [r, g, b] = linear;
      // display-p3 → XYZ(D65) → linear sRGB
      const X = 0.4865709 * r + 0.2656677 * g + 0.1982173 * b;
      const Y = 0.2289746 * r + 0.6917385 * g + 0.0792869 * b;
      const Z = 0.0 * r + 0.0451134 * g + 1.0439444 * b;
      return fromLinear([
        3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
        -0.969266 * X + 1.8760108 * Y + 0.041556 * Z,
        0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z
      ], alpha);
    }
  }
  return null;
}

const byteHex = (value) => clampByte(value).toString(16).padStart(2, "0");

/** { r, g, b, a } → 小写 #rrggbb 或 #rrggbbaa（a < 1 时）。 */
export function toHex({ r, g, b, a = 1 }) {
  const body = `${byteHex(r)}${byteHex(g)}${byteHex(b)}`;
  return a < 1 ? `#${body}${byteHex(a * 255)}` : `#${body}`;
}

/** 与 steward 校验器同一算法：components 四位小数、alpha 四位小数，hex 由 components 反推，保证 color-hex-mismatch 不会触发。 */
export function toDtcgColorValue(rgba) {
  const components = [rgba.r, rgba.g, rgba.b].map((channel) => Number((channel / 255).toFixed(4)));
  const alpha = Number(Number(rgba.a ?? 1).toFixed(4));
  const hex = toHex({
    r: Math.round(components[0] * 255),
    g: Math.round(components[1] * 255),
    b: Math.round(components[2] * 255),
    a: alpha
  });
  return { colorSpace: "srgb", components, alpha, hex: hex.toUpperCase() };
}

export function hexToRgba(hex) {
  return parseCssColor(hex);
}

export function rgbaToOklch({ r, g, b }) {
  const { L, a, b: bb } = linearSrgbToOklab(srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255));
  const C = Math.sqrt(a * a + bb * bb);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) {
    H += 360;
  }
  return { L, C, H: C < 1e-4 ? 0 : H };
}

export function oklchToRgba({ L, C, H }, alpha = 1) {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  return fromLinear(oklabToLinearSrgb(L, a, b), alpha);
}

/** OKLab 欧氏距离；< 0.02 肉眼基本不可分（用来合并抗锯齿 / 圆整产生的近似色）。 */
export function deltaE(left, right) {
  const a = linearSrgbToOklab(srgbToLinear(left.r / 255), srgbToLinear(left.g / 255), srgbToLinear(left.b / 255));
  const b = linearSrgbToOklab(srgbToLinear(right.r / 255), srgbToLinear(right.g / 255), srgbToLinear(right.b / 255));
  return Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

/**
 * 色族：OKLCH 色度低于阈值算中性，阈值按明度分段——近白的状态浅底（green-100 C≈0.05、red-100 C≈0.04）必须和真正的浅灰
 * （slate-100 C≈0.006、slate-200 C≈0.011）分开，而深端的冷灰（slate-900 C≈0.042）又要和 blue-950（C≈0.09）分开。
 * 色相边界用 Tailwind 500 档标定：red 25 · orange 55 · yellow 93 · green 150 · teal 183 · cyan 210 · blue 262 · indigo 277 · violet 293 · purple 305 · fuchsia 322 · pink 354。
 */
export function neutralChromaThreshold(L) {
  // 实测标定：近白段真中性（slate-50/100、Element #f5f7fa）C ≤ 0.007，淡色（red-50 #fef2f2、Element light-9）≥ 0.0129；
  // 0.90～0.955 段真中性（#e5eaf3、#e2e8f0）≤ 0.0134，淡色（#d9ecff、#fee2e2）≥ 0.031。
  if (L >= 0.955) return 0.01;
  if (L >= 0.9) return 0.016;
  if (L > 0.6) return 0.04;
  if (L > 0.3) return 0.05;
  return 0.065;
}

export function hueFamily(oklch) {
  const { L, C, H } = oklch;
  if (C < neutralChromaThreshold(L)) {
    return "neutral";
  }
  if (H >= 355 || H < 40) return "red";
  if (H < 75) return "orange";
  if (H < 115) return "yellow";
  if (H < 170) return "green";
  if (H < 225) return "cyan";
  if (H < 280) return "blue";
  if (H < 330) return "purple";
  return "pink";
}

/** OKLCH 明度 → 50～950 档（用 Tailwind gray 阶梯标定：50≈.985 100≈.967 200≈.928 300≈.872 400≈.714 500≈.551 600≈.446 700≈.373 800≈.278 900≈.21 950≈.13）。 */
export function lightnessStep(L) {
  if (L >= 0.975) return 50;
  if (L >= 0.948) return 100;
  if (L >= 0.9) return 200;
  if (L >= 0.8) return 300;
  if (L >= 0.64) return 400;
  if (L >= 0.5) return 500;
  if (L >= 0.41) return 600;
  if (L >= 0.33) return 700;
  if (L >= 0.245) return 800;
  if (L >= 0.17) return 900;
  return 950;
}

export function relativeLuminance({ r, g, b }) {
  const [R, G, B] = [r, g, b].map((channel) => srgbToLinear(channel / 255));
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** 前景（可半透明）叠在底色上的实色结果。 */
export function composite(foreground, background) {
  const alpha = foreground.a ?? 1;
  if (alpha >= 1) {
    return { r: foreground.r, g: foreground.g, b: foreground.b, a: 1 };
  }
  const base = background ?? { r: 255, g: 255, b: 255 };
  return {
    r: clampByte(foreground.r * alpha + base.r * (1 - alpha)),
    g: clampByte(foreground.g * alpha + base.g * (1 - alpha)),
    b: clampByte(foreground.b * alpha + base.b * (1 - alpha)),
    a: 1
  };
}

/** WCAG 2.x 对比度；前景半透明时先叠到底色上。 */
export function contrastRatio(foreground, background) {
  const fg = composite(foreground, background);
  const bg = composite(background, { r: 255, g: 255, b: 255 });
  const lighter = Math.max(relativeLuminance(fg), relativeLuminance(bg));
  const darker = Math.min(relativeLuminance(fg), relativeLuminance(bg));
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

export function isDark(rgba) {
  return relativeLuminance(rgba) < 0.18;
}

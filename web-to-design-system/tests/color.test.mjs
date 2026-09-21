// node --test tests/color.test.mjs：颜色解析（rgb / hex / hsl / oklch / color()）、DTCG 结构化值与 hex 一致、对比度、色族与明度分档、变量名。
import assert from "node:assert/strict";
import { test } from "node:test";

import { contrastRatio, hueFamily, lightnessStep, parseCssColor, rgbaToOklch, toDtcgColorValue, toHex } from "../scripts/lib/color.mjs";
import { cssVariableName, sortTokenTree } from "../scripts/lib/dtcg.mjs";
import { parseBoxShadow, parseTimingFunction } from "../scripts/lib/evidence.mjs";

test("解析浏览器算出的各种颜色写法", () => {
  assert.deepEqual(parseCssColor("rgb(37, 99, 235)"), { r: 37, g: 99, b: 235, a: 1 });
  assert.deepEqual(parseCssColor("rgba(15, 23, 42, 0.5)"), { r: 15, g: 23, b: 42, a: 0.5 });
  assert.deepEqual(parseCssColor("#2563eb"), { r: 37, g: 99, b: 235, a: 1 });
  assert.equal(parseCssColor("#0f172a80").a, 0.502);
  assert.deepEqual(parseCssColor("hsl(0 0% 100%)"), { r: 255, g: 255, b: 255, a: 1 });
  // Tailwind v4 blue-500 = oklch(0.623 0.214 259.815) = #2b7fff
  const fromOklch = parseCssColor("oklch(0.623 0.214 259.815)");
  assert.ok(Math.abs(fromOklch.r - 43) <= 3 && Math.abs(fromOklch.g - 127) <= 3 && Math.abs(fromOklch.b - 255) <= 3, `oklch 蓝应接近 #2b7fff，得到 ${toHex(fromOklch)}`);
  // 灰轴：oklch(0.7 0 0) ≈ #9e9e9e，且与 rgbaToOklch 互逆
  const gray = parseCssColor("oklch(0.7 0 0)");
  assert.ok(Math.abs(gray.r - gray.g) <= 1 && Math.abs(gray.g - gray.b) <= 1 && Math.abs(gray.r - 158) <= 3, `灰轴换算 ${toHex(gray)}`);
  assert.ok(Math.abs(rgbaToOklch(gray).L - 0.7) < 0.01);
  assert.deepEqual(parseCssColor("color(srgb 1 1 1 / 0.9)"), { r: 255, g: 255, b: 255, a: 0.9 });
  assert.equal(parseCssColor("transparent").a, 0);
  assert.equal(parseCssColor("var(--x)"), null);
  assert.equal(parseCssColor("color-mix(in oklab, red, blue)"), null);
});

test("DTCG 颜色值：components 与 hex 互相一致（steward 校验器口径）", () => {
  const value = toDtcgColorValue(parseCssColor("rgb(249, 207, 0)"));
  assert.equal(value.colorSpace, "srgb");
  assert.equal(value.hex, "#F9CF00");
  const back = value.components.map((component) => Math.round(component * 255));
  assert.deepEqual(back, [249, 207, 0]);
  const translucent = toDtcgColorValue(parseCssColor("rgba(17, 24, 39, 0.45)"));
  assert.equal(translucent.alpha, 0.45);
  assert.equal(translucent.hex.length, 9);
  assert.equal(Math.round(translucent.alpha * 255).toString(16).padStart(2, "0").toUpperCase(), translucent.hex.slice(7));
});

test("WCAG 对比度", () => {
  assert.equal(contrastRatio(parseCssColor("#000000"), parseCssColor("#ffffff")), 21);
  assert.equal(contrastRatio(parseCssColor("#ffffff"), parseCssColor("#2563eb")), 5.17);
  // 半透明前景先叠到底色上
  assert.ok(contrastRatio(parseCssColor("rgba(0,0,0,0.5)"), parseCssColor("#ffffff")) < 21);
});

test("色族：中性阈值随明度分段，状态浅底不算中性", () => {
  const family = (hex) => hueFamily(rgbaToOklch(parseCssColor(hex)));
  assert.equal(family("#64748b"), "neutral"); // slate-500
  assert.equal(family("#0f172a"), "neutral"); // slate-900
  assert.equal(family("#e2e8f0"), "neutral"); // slate-200
  assert.equal(family("#dcfce7"), "green"); // green-100 状态浅底
  assert.equal(family("#fee2e2"), "red"); // red-100
  assert.equal(family("#2563eb"), "blue");
  assert.equal(family("#f9cf00"), "yellow");
  assert.equal(family("#dc2626"), "red");
  assert.equal(family("#7c3aed"), "purple");
  assert.equal(family("#0891b2"), "cyan");
});

test("明度分档按 Tailwind gray 阶梯标定", () => {
  const step = (hex) => lightnessStep(rgbaToOklch(parseCssColor(hex)).L);
  assert.equal(step("#f9fafb"), 50);
  assert.equal(step("#e5e7eb"), 200);
  assert.equal(step("#6b7280"), 500);
  assert.equal(step("#111827"), 900);
});

test("变量名与 Style Dictionary kebab 一致；阶梯键按数值排序", () => {
  assert.equal(cssVariableName("color.action.primary"), "color-action-primary");
  assert.equal(cssVariableName("spacing.0-5"), "spacing-0-5");
  assert.equal(cssVariableName("text.body-sm.size"), "text-body-sm-size");
  // JS 对象整数键永远排最前（升序），非整数键才按我们的排序；"2xl" 这类字母键排在数字阶梯之后
  const sorted = sortTokenTree({ spacing: { 10: {}, "2-5": {}, 3: {}, "0-5": {}, 1: {}, xl: {} } });
  assert.deepEqual(Object.keys(sorted.spacing), ["1", "3", "10", "0-5", "2-5", "xl"]);
  const meta = sortTokenTree({ color: { neutral: { 500: {}, $description: "x", 50: {} } } });
  assert.deepEqual(Object.keys(meta.color.neutral), ["50", "500", "$description"]);
});

test("阴影与缓动解析", () => {
  const layers = parseBoxShadow("rgba(15, 23, 42, 0.08) 0px 1px 3px 0px, rgba(15, 23, 42, 0.06) 0px 1px 2px -1px");
  assert.equal(layers.length, 2);
  assert.equal(layers[0].blur, 3);
  assert.equal(layers[1].spread, -1);
  assert.equal(layers[0].color, "rgba(15, 23, 42, 0.08)");
  assert.deepEqual(parseTimingFunction("ease"), [0.25, 0.1, 0.25, 1]);
  assert.deepEqual(parseTimingFunction("cubic-bezier(0.4, 0, 0.2, 1)"), [0.4, 0, 0.2, 1]);
  assert.equal(parseTimingFunction("steps(4)"), null);
});

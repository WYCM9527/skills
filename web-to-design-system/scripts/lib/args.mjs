// 参数与文件小工具：与 design-system-steward 的 lib.mjs 同一套约定（--key value / --flag、绝定路径、稳定排序 JSON）。
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const skillRoot = path.resolve(scriptDirectory, "..", "..");

/** `--key value` → { key: "value" }；`--flag` → { flag: true }；裸参数收进 positional。 */
export function parseArgs(argv) {
  const values = { positional: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      values.positional.push(argument);
      continue;
    }
    const key = argument.slice(2);
    if (!key) {
      throw new Error("Empty option name");
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      values[key] = true;
      continue;
    }
    values[key] = next;
    index += 1;
  }
  return values;
}

export function requireStringOption(options, key) {
  const value = options[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`缺少必填参数 --${key}`);
  }
  return value;
}

export function requireAbsolutePath(value, label) {
  if (!path.isAbsolute(value)) {
    throw new Error(`${label} 必须是绝对路径：${value}`);
  }
  return path.resolve(value);
}

export async function fileExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function writeJson(filePath, value, { stable = true } = {}) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(stable ? stableValue(value) : value, null, 2)}\n`, "utf8");
}

export async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

/** 键按字典序排列，保证同一输入得到同一输出（三方合并与 diff 才有意义）。 */
export function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(stableValue(value), null, 2)}\n`);
}

export function reportError(error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`web-to-design-system: ${message}\n`);
}

export function relativePosix(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

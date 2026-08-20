import { lstat, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const skillRoot = path.resolve(scriptDirectory, "..");

export const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out"
]);

export function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }

    const key = argument.slice(2);
    if (!key) {
      throw new Error("Empty option name");
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
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
    throw new Error(`Missing required --${key} option`);
  }
  return value;
}

export function requireAbsolutePath(value, label) {
  if (!path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`);
  }
  return path.resolve(value);
}

export async function requireDirectory(value, label) {
  const absolute = requireAbsolutePath(value, label);
  const details = await stat(absolute);
  if (!details.isDirectory()) {
    throw new Error(`${label} must be a directory: ${absolute}`);
  }
  return absolute;
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

export function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export function relativePosix(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

export async function walkFiles(root, options = {}) {
  const ignored = options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES;
  const files = [];

  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) {
          await visit(absolute);
        }
        continue;
      }
      if (entry.isFile()) {
        files.push(absolute);
      }
    }
  }

  await visit(root);
  return files;
}

export async function readTextIfSmall(filePath, maxBytes = 1_000_000) {
  const details = await stat(filePath);
  if (details.size > maxBytes) {
    return null;
  }
  return readFile(filePath, "utf8");
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(stableValue(value), null, 2)}\n`, "utf8");
}

export async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

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
  process.stderr.write(`design-system-steward: ${message}\n`);
}

export function collectReferences(value) {
  const references = [];
  const expression = /\{([^{}]+)\}/g;

  function visit(current) {
    if (typeof current === "string") {
      for (const match of current.matchAll(expression)) {
        references.push(match[1]);
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (current && typeof current === "object") {
      Object.values(current).forEach(visit);
    }
  }

  visit(value);
  return [...new Set(references)].sort((left, right) => left.localeCompare(right));
}

export function isCompleteAlias(value) {
  return typeof value === "string" && /^\{[^{}]+\}$/.test(value);
}

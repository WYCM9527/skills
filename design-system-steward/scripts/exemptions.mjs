import { existsSync } from "node:fs";
import path from "node:path";

import { fileExists, readJson } from "./lib.mjs";
import { matchingProjectGlob } from "./governance-lib.mjs";
import { localizeIssues, normalizeColorLiteral } from "./tokens.mjs";

export const EXEMPTIONS_RELATIVE_PATH = "design-system/exemptions.json";

function issue(issues, code, message, details = {}) {
  issues.push({ code, message, severity: "error", ...details });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeExemptionValue(value) {
  return normalizeColorLiteral(value) ?? String(value).trim().toLowerCase();
}

/**
 * Validate raw exemption entries. Every entry needs a project-relative path
 * and a human reason; `value` optionally narrows the exemption to one literal
 * inside the matched files. Returns normalized entries plus issues.
 */
export function validateExemptionEntries(list, issues) {
  const entries = [];
  if (!Array.isArray(list)) {
    issue(issues, "invalid-exemptions-file", "exemptions.json must contain an exemptions array");
    return entries;
  }
  list.forEach((raw, index) => {
    const label = `exemption at index ${index}`;
    if (!isPlainObject(raw)) {
      issue(issues, "invalid-exemption-entry", `${label} must be an object`, { index });
      return;
    }
    const relative = typeof raw.path === "string" ? raw.path.trim() : "";
    if (!relative || path.isAbsolute(relative) || relative.split("/").includes("..")) {
      issue(issues, "invalid-exemption-entry", `${label} must use a project-relative path without ..`, { index });
      return;
    }
    if (typeof raw.reason !== "string" || !raw.reason.trim()) {
      issue(issues, "missing-exemption-reason", `${label} (${relative}) must include a non-empty reason`, {
        index,
        path: relative
      });
      return;
    }
    const value = typeof raw.value === "string" && raw.value.trim() ? raw.value.trim() : undefined;
    entries.push({
      path: relative,
      reason: raw.reason.trim(),
      ...(value === undefined ? {} : { value })
    });
  });
  return entries;
}

/**
 * Load design-system/exemptions.json when present. A missing file is a valid
 * state: nothing is exempted. Schema problems are reported as issues instead
 * of crashing read-only callers such as audit or guard.
 */
export async function loadExemptions(projectRoot) {
  const file = path.join(projectRoot, "design-system", "exemptions.json");
  if (!(await fileExists(file))) {
    return { entries: [], issues: [], present: false };
  }
  const issues = [];
  let document;
  try {
    document = await readJson(file);
  } catch (error) {
    issue(issues, "invalid-exemptions-file", `Cannot parse ${EXEMPTIONS_RELATIVE_PATH}: ${error.message}`);
    return { entries: [], issues: localizeIssues(issues), present: true };
  }
  const entries = validateExemptionEntries(isPlainObject(document) ? document.exemptions : null, issues);
  return { entries, issues: localizeIssues(issues), present: true };
}

/**
 * Build a matcher over validated entries. File-level entries (no value)
 * silence a whole path or glob; value-level entries silence one normalized
 * literal inside the matched paths.
 */
export function createExemptionMatcher(entries) {
  const fileGlobs = entries.filter((entry) => entry.value === undefined).map((entry) => entry.path);
  const valueEntries = entries
    .filter((entry) => entry.value !== undefined)
    .map((entry) => ({ ...entry, normalizedValue: normalizeExemptionValue(entry.value) }));
  return {
    hasEntries: entries.length > 0,
    isFileExempt(relative) {
      return matchingProjectGlob(relative, fileGlobs) !== null;
    },
    isValueExempt(relative, rawValue) {
      if (valueEntries.length === 0) {
        return false;
      }
      const normalized = normalizeExemptionValue(rawValue);
      return valueEntries.some((entry) => (
        entry.normalizedValue === normalized && matchingProjectGlob(relative, [entry.path]) !== null
      ));
    }
  };
}

/**
 * Report exemptions whose concrete target file no longer exists — the state
 * after the user intentionally removed the exempted content. Glob entries are
 * skipped: they describe areas, not single files.
 */
export function findStaleExemptions(entries, projectRoot) {
  return entries
    .filter((entry) => !/[*?]/.test(entry.path))
    .filter((entry) => !existsSync(path.join(projectRoot, entry.path)))
    .map((entry) => ({ path: entry.path, reason: entry.reason, ...(entry.value ? { value: entry.value } : {}) }));
}

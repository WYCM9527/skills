import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  fileExists,
  parseArgs,
  printJson,
  readJson,
  reportError,
  requireDirectory,
  requireStringOption,
  skillRoot,
  writeJson,
  writeText
} from "./lib.mjs";

const scaffoldRoot = path.join(skillRoot, "assets", "scaffold");
const THEME_ID = /^[a-z][a-z0-9-]*$/;
const VALID_ACTIVATIONS = new Set(["data-attribute", "class", "media"]);
const VALID_STATUSES = new Set(["active", "reference-only"]);

function validateThemeId(value, label) {
  if (typeof value !== "string" || !THEME_ID.test(value)) {
    throw new Error(`${label} must be a lowercase kebab-case id`);
  }
  return value;
}

function activationFromOptions(options, required) {
  if (options.activation === undefined && !required) {
    return null;
  }
  const kind = requireStringOption(options, "activation");
  if (!VALID_ACTIVATIONS.has(kind)) {
    throw new Error("--activation must be data-attribute, class, or media");
  }
  if (kind === "data-attribute") {
    const attribute = requireStringOption(options, "attribute");
    if (!/^data-[a-z][a-z0-9-]*$/.test(attribute)) {
      throw new Error("--attribute must be a lowercase data-* attribute");
    }
    return { attribute, kind };
  }
  if (options.attribute !== undefined) {
    throw new Error(`--attribute is only valid with --activation data-attribute`);
  }
  return { kind };
}

function sameActivation(left, right) {
  return left?.kind === right?.kind && left?.attribute === right?.attribute;
}

function confirmedField(options, option, status, label) {
  const value = options[option];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (status === "reference-only") {
    return "未确认（仅作参考）";
  }
  throw new Error(`Missing required --${option} option for an active Theme (${label})`);
}

function validateExistingMap(map) {
  if (!map || typeof map !== "object" || Array.isArray(map) || map.version !== 1 || !Array.isArray(map.themes)) {
    throw new Error("theme-map.json must be an object with version: 1 and a themes array");
  }
  const defaultTheme = validateThemeId(map.defaultTheme, "theme-map defaultTheme");
  if (!map.activation || typeof map.activation !== "object" || Array.isArray(map.activation)) {
    throw new Error("theme-map.json has no activation object");
  }
  const activation = activationFromOptions({
    activation: map.activation.kind,
    ...(map.activation.attribute === undefined ? {} : { attribute: map.activation.attribute })
  }, true);
  const ids = new Set();
  for (const theme of map.themes) {
    if (!theme || typeof theme !== "object" || Array.isArray(theme)) {
      throw new Error("theme-map.json contains an invalid theme entry");
    }
    const id = validateThemeId(theme.id, "theme-map theme id");
    if (id === defaultTheme) {
      throw new Error(`theme-map defaultTheme ${defaultTheme} cannot also be a Theme delta`);
    }
    if (ids.has(id)) {
      throw new Error(`theme-map.json contains duplicate theme id: ${id}`);
    }
    if (typeof theme.source !== "string" || !theme.source.trim()) {
      throw new Error(`theme-map theme ${id} has no source`);
    }
    if (typeof theme.runtimeOwner !== "string" || !theme.runtimeOwner.trim()) {
      throw new Error(`theme-map theme ${id} has no runtimeOwner`);
    }
    ids.add(id);
  }
  return { activation, defaultTheme, map };
}

function activationLabel(activation) {
  if (activation.kind === "data-attribute") {
    return `:root[${activation.attribute}="主题 id"]`;
  }
  if (activation.kind === "class") {
    return ":root.主题-id";
  }
  return "@media (prefers-color-scheme: 主题 id)";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = await requireDirectory(requireStringOption(options, "project"), "--project");
  const systemRoot = path.join(projectRoot, "design-system");
  await requireDirectory(systemRoot, "design-system");
  await requireDirectory(path.join(systemRoot, "tokens"), "design-system/tokens");

  const id = validateThemeId(requireStringOption(options, "theme"), "--theme");
  const reason = requireStringOption(options, "reason").trim();
  const status = options.status === undefined ? "active" : requireStringOption(options, "status");
  if (!VALID_STATUSES.has(status)) {
    throw new Error("--status must be active or reference-only");
  }
  const source = confirmedField(options, "source", status, "authoritative source");
  const runtimeOwner = confirmedField(options, "runtime-owner", status, "runtime owner");
  const mapPath = path.join(systemRoot, "theme-map.json");
  const mapExists = await fileExists(mapPath);
  const requestedDefault = options["default-theme"] === undefined
    ? null
    : validateThemeId(requireStringOption(options, "default-theme"), "--default-theme");
  const requestedActivation = activationFromOptions(options, !mapExists);

  let defaultTheme;
  let activation;
  let existingThemes = [];
  if (mapExists) {
    const existing = validateExistingMap(await readJson(mapPath));
    defaultTheme = existing.defaultTheme;
    activation = existing.activation;
    existingThemes = existing.map.themes;
    if (requestedDefault && requestedDefault !== defaultTheme) {
      throw new Error(`--default-theme must match existing theme-map defaultTheme: ${defaultTheme}`);
    }
    if (requestedActivation && !sameActivation(requestedActivation, activation)) {
      throw new Error("--activation and --attribute must match the existing theme-map activation");
    }
  } else {
    defaultTheme = requestedDefault ?? (() => { throw new Error("Missing required --default-theme option for a new theme map"); })();
    activation = requestedActivation;
  }
  if (id === defaultTheme) {
    throw new Error(`--theme cannot equal --default-theme (${defaultTheme}); Core represents the default Theme`);
  }
  if (activation.kind === "media" && (![id, defaultTheme].every((value) => value === "light" || value === "dark"))) {
    throw new Error("--activation media only supports light and dark theme ids");
  }
  if (existingThemes.some((theme) => theme?.id === id)) {
    throw new Error(`Theme already exists in theme-map.json: ${id}`);
  }

  const themeRoot = path.join(systemRoot, "themes", id);
  if (await fileExists(themeRoot)) {
    throw new Error(`Refusing to overwrite existing theme directory: ${themeRoot}`);
  }
  const template = await readFile(path.join(scaffoldRoot, "THEME.md"), "utf8");
  const theme = {
    id,
    reason,
    runtimeOwner,
    source,
    status,
    ...(typeof options.owner === "string" && options.owner.trim() ? { owner: options.owner.trim() } : {}),
    ...(typeof options["review-by"] === "string" && options["review-by"].trim() ? { reviewBy: options["review-by"].trim() } : {})
  };
  const document = template
    .replaceAll("{{THEME_ID}}", id)
    .replaceAll("{{DEFAULT_THEME}}", defaultTheme)
    .replaceAll("{{STATUS}}", status)
    .replaceAll("{{ACTIVATION}}", activationLabel(activation))
    .replaceAll("{{SOURCE}}", source)
    .replaceAll("{{RUNTIME_OWNER}}", runtimeOwner)
    .replaceAll("{{REASON}}", reason);

  await mkdir(path.join(themeRoot, "tokens"), { recursive: true });
  await writeText(path.join(themeRoot, "THEME.md"), document);
  await writeText(
    path.join(themeRoot, "tokens", "semantic.tokens.json"),
    await readFile(path.join(scaffoldRoot, "semantic.tokens.json"), "utf8")
  );
  if (options["with-components"] === true) {
    await writeText(
      path.join(themeRoot, "tokens", "components.tokens.json"),
      await readFile(path.join(scaffoldRoot, "components.tokens.json"), "utf8")
    );
  }
  await writeJson(mapPath, {
    activation,
    defaultTheme,
    themes: [...existingThemes, theme].sort((left, right) => left.id.localeCompare(right.id)),
    version: 1
  });

  printJson({
    created: [
      `design-system/themes/${id}/THEME.md`,
      `design-system/themes/${id}/tokens/semantic.tokens.json`,
      ...(options["with-components"] === true ? [`design-system/themes/${id}/tokens/components.tokens.json`] : []),
      ...(mapExists ? [] : ["design-system/theme-map.json"])
    ],
    projectRoot,
    theme: {
      activation,
      defaultTheme,
      ...theme
    },
    themeMap: "design-system/theme-map.json",
    themeMapCreated: !mapExists,
    uiSourceChanged: false,
    writes: true
  });
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

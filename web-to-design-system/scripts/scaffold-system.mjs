#!/usr/bin/env node
// 写入：把 draft-tokens 的草稿（人核对过之后）落成符合规范的 design-system/ 目录——
//   项目模式  --project <dir>   写 <dir>/design-system/（tokens、themes、theme-map、scope-map、style-dictionary 配置、DESIGN.md、AUDIT.md、dist/.gitkeep）
//   种子模式  --seed <dir>      在项目模式之上再写身份文件 design-system.json、bridge/base.css、templates/*、README.md、CHANGELOG.md、package.json，
//                              让 design-system-adopter 能 `ds.mjs init --system <dir> --stack css` 直接接入
// 校验 / 构建 / Guard 不在这里做，交给 design-system-steward；脚本结束时打印那三条命令。
//
// 用法：node scaffold-system.mjs --from <draftDir> (--project <dir> | --seed <dir>) --id <id> --name <名称>
//       [--version 0.1.0] [--description "…"] [--repo owner/repo] [--path <包子路径>] [--npm @scope/id] [--force] [--tokens-only] [--json]

import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { fileExists, parseArgs, printJson, readJson, reportError, requireAbsolutePath, requireStringOption, skillRoot, writeJson, writeText } from "./lib/args.mjs";
import { flattenTokens } from "./lib/dtcg.mjs";
import { ROLES } from "./lib/roles.mjs";
import { locateSteward, stewardCommands } from "./lib/steward.mjs";

const assetsRoot = path.join(skillRoot, "assets");

function fill(template, values) {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, value ?? ""), template);
}

async function readAsset(relative) {
  return readFile(path.join(assetsRoot, relative), "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const draftDir = requireAbsolutePath(path.resolve(process.cwd(), requireStringOption(options, "from")), "--from");
  if (options.seed === true) {
    throw new Error("--seed 需要目录参数（种子包写到哪）");
  }
  if (typeof options.seed === "string" && typeof options.project === "string") {
    throw new Error("--project 与 --seed 只能选一个");
  }
  const seedMode = typeof options.seed === "string";
  const targetRoot = requireAbsolutePath(path.resolve(process.cwd(), requireStringOption(options, seedMode ? "seed" : "project")), seedMode ? "--seed" : "--project");
  const id = String(options.id ?? "").trim();
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new Error("--id 必须是小写字母开头的 kebab-case（与 design-system.json 的 id 规则一致）");
  }
  const name = requireStringOption(options, "name");
  const version = String(options.version ?? "0.1.0");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("--version 必须是 x.y.z");
  }
  const force = options.force === true;
  const tokensOnly = options["tokens-only"] === true;

  const notesPath = path.join(draftDir, "draft-notes.json");
  const notes = (await fileExists(notesPath)) ? await readJson(notesPath) : null;
  const primitives = await readJson(path.join(draftDir, "tokens", "primitives.tokens.json"));
  const semantic = await readJson(path.join(draftDir, "tokens", "semantic.tokens.json"));
  const themeMapPath = path.join(draftDir, "theme-map.json");
  const themeMap = (await fileExists(themeMapPath)) ? await readJson(themeMapPath) : null;
  const themes = [];
  for (const entry of themeMap?.themes ?? []) {
    const tokensPath = path.join(draftDir, "themes", entry.id, "tokens", "semantic.tokens.json");
    if (await fileExists(tokensPath)) {
      themes.push({ ...entry, tokens: await readJson(tokensPath) });
    }
  }
  const sources = notes?.sources?.length ? notes.sources.map((source) => source.url).join("、") : "（来源未记录）";
  const date = new Date().toISOString().slice(0, 10);

  const systemRoot = path.join(targetRoot, "design-system");
  const exists = await fileExists(systemRoot);
  if (exists && !force && !tokensOnly) {
    throw new Error(`${systemRoot} 已存在。重新同步 token 用 --tokens-only（不动 DESIGN.md / AUDIT.md）；整目录重写用 --force。`);
  }

  const written = [];
  const put = async (relative, contents) => {
    const destination = path.join(targetRoot, relative);
    if (typeof contents === "string") {
      await writeText(destination, contents);
    } else {
      await writeJson(destination, contents, { stable: false });
    }
    written.push(relative);
  };

  // —— token 层（项目 / 种子模式都写；--tokens-only 也写） ——
  if (force && (await fileExists(path.join(systemRoot, "themes")))) {
    await rm(path.join(systemRoot, "themes"), { force: true, recursive: true });
  }
  await put("design-system/tokens/primitives.tokens.json", primitives);
  await put("design-system/tokens/semantic.tokens.json", semantic);
  await put("design-system/scope-map.json", { scopes: [], version: 1 });
  if (themeMap && themes.length) {
    await put("design-system/theme-map.json", { ...themeMap, themes: themeMap.themes.map(({ tokens, ...rest }) => rest) });
    for (const theme of themes) {
      await put(`design-system/themes/${theme.id}/tokens/semantic.tokens.json`, theme.tokens);
    }
  } else if (await fileExists(path.join(systemRoot, "theme-map.json"))) {
    await rm(path.join(systemRoot, "theme-map.json"), { force: true });
  }
  await put("design-system/style-dictionary.config.mjs", await readAsset("style-dictionary.config.mjs"));
  await put("design-system/dist/.gitkeep", "");

  // —— 文档层 ——
  const semanticPaths = new Set(flattenTokens(semantic).keys());
  if (!tokensOnly) {
    const themeNote = themes.length
      ? themes.map((theme) => `- 本系统登记了 Theme \`${theme.id}\`（激活：${describeActivation(themeMap, theme.id)}；默认 \`${themeMap.defaultTheme}\`），delta 见 \`themes/${theme.id}/\`；运行时所有者待接入方确认。`).join("\n")
      : "- 本次取证未发现另一模式（或切换靠 JS 未被识别）。不要从现有颜色自动反相造暗色；需要时先走提案。";
    await put("design-system/DESIGN.md", fill(await readAsset("DESIGN.template.md"), { DATE: date, NAME: name, SOURCES: sources, THEME_NOTE: themeNote }));

    const inferred = Object.entries(notes?.roles ?? {}).filter(([, role]) => role.source === "inferred");
    const inferredRows = inferred.length
      ? inferred.map(([rolePath, role]) => `| \`${rolePath}\` | \`{${role.target}}\` | ${role.evidence} | 待确认 |`).join("\n")
      : "| — | | | |";
    const missingRows = notes?.missing?.length
      ? notes.missing.map((entry) => `| \`${entry.path}\` | ${entry.tier} | ${entry.zh} | ${entry.hint || "—"} | 待决定：补证据 / 按推断填 / 本系统不需要 |`).join("\n")
      : "| — | | | | |";
    const warningRows = notes?.warnings?.length ? notes.warnings.map((warning) => `- 取证警告：${warning}`).join("\n") : "";
    const themeLine = themes.length
      ? `另一模式：${themes.map((theme) => `\`${theme.id}\`（${notes?.alternateMode?.source ?? "取证时切换"}，delta ${Object.keys(flattenTokens(theme.tokens)).length} 条）`).join("、")}`
      : "未取到另一模式";
    await put("design-system/AUDIT.md", fill(await readAsset("AUDIT.template.md"), {
      BRAND: notes?.brand ? `${notes.brand.family ?? "无（单色站点）"}${notes.brand.override ? `（用户指定 ${notes.brand.override}）` : ""}` : "未记录",
      DATE: date,
      EVIDENCE: notes?.evidence ?? "（未记录）",
      INFERRED: String(notes?.counts?.inferred ?? inferred.length),
      INFERRED_ROWS: inferredRows,
      INITIAL_SCHEME: notes?.initialScheme ?? "light",
      MISSING: String(notes?.counts?.missing ?? notes?.missing?.length ?? 0),
      MISSING_CORE: String(notes?.counts?.missingCore ?? 0),
      MISSING_ROWS: missingRows,
      NAME: name,
      OBSERVED: String(notes?.counts?.observed ?? 0),
      SOURCES: sources,
      THEME_LINE: themeLine,
      VIEWPORT: "1440×900",
      WARNING_ROWS: warningRows
    }));

    for (const theme of themes) {
      const delta = new Set(flattenTokens(theme.tokens).keys());
      const uncovered = ROLES.filter((role) => role.dark && semanticPaths.has(role.path) && !delta.has(role.path)).map((role) => `\`${role.path}\``);
      await put(`design-system/themes/${theme.id}/THEME.md`, fill(await readAsset("THEME.template.md"), {
        ACTIVATION: describeActivation(themeMap, theme.id),
        DEFAULT_THEME: themeMap.defaultTheme,
        DELTA_COUNT: String(delta.size),
        REASON: theme.reason ?? "",
        RUNTIME_OWNER: theme.runtimeOwner ?? "",
        SOURCE: theme.source ?? "",
        STATUS: theme.status ?? "active",
        THEME_ID: theme.id,
        UNCOVERED: uncovered.length ? uncovered.join("、") : "（无）"
      }));
    }
  }

  // —— 种子模式：身份文件 + 桥接 + 模板 + README / CHANGELOG / package.json ——
  if (seedMode && !tokensOnly) {
    const npm = String(options.npm ?? `@company/${id}`);
    const repo = String(options.repo ?? "<owner>/<repo>");
    const subPath = String(options.path ?? id);
    const description = String(options.description ?? `${name}：从 ${sources} 实测提炼的设计系统。`);
    const seedValues = { DATE: date, DESCRIPTION: description, ID: id, NAME: name, NPM: npm, PATH: subPath, REPO: repo, SOURCES: sources, VERSION: version };
    const identity = JSON.parse(fill(await readAsset("seed/design-system.template.json"), seedValues));
    if (!themes.length) {
      identity.owned = identity.owned.filter((glob) => !glob.startsWith("design-system/themes") && glob !== "design-system/theme-map.json");
    }
    await put("design-system.json", identity);
    await put("bridge/base.css", fill(await readAsset("seed/bridge/base.css"), seedValues));
    for (const file of await readdir(path.join(assetsRoot, "seed", "templates"))) {
      await put(`templates/${file}`, fill(await readAsset(`seed/templates/${file}`), seedValues));
    }
    const themeTree = themes.map((theme) => `├── themes/${theme.id}/                   # 相对 Core 的 delta + THEME.md\n├── theme-map.json                  # 激活方式 / 默认模式 / 登记\n`).join("");
    await put("README.md", fill(await readAsset("seed/README.template.md"), { ...seedValues, THEME_TREE: themeTree }));
    await put("CHANGELOG.md", `# Changelog\n\n版本策略：patch 只改描述与文档；minor 新增或修改 token（视觉会变、名字不变，条目里写清肉眼可见的影响）；major 才改名或删除 token。\n\n## ${version} — ${date}\n\n- 由 web-to-design-system 从 ${sources} 实测提炼的初版：primitives ${notes?.counts?.primitives ?? "?"} 个，语义角色 观察 ${notes?.counts?.observed ?? "?"} / 推断 ${notes?.counts?.inferred ?? "?"}${themes.length ? `，Theme ${themes.map((theme) => theme.id).join(" / ")}` : "，无 Theme"}。推断项与缺口见 design-system/AUDIT.md。\n`);
    await put("package.json", JSON.parse(fill(await readAsset("seed/package.template.json"), seedValues)));
  }

  // —— 收尾：待填写统计 + steward 命令 ——
  const designPath = path.join(systemRoot, "DESIGN.md");
  const pending = (await fileExists(designPath)) ? ((await readFile(designPath, "utf8")).match(/待填写|待确认/g) ?? []).length : 0;
  const steward = locateSteward(targetRoot);
  const commands = stewardCommands(targetRoot, steward);

  if (options.json === true) {
    printJson({ mode: seedMode ? "seed" : "project", pending, steward: steward?.dir ?? null, target: targetRoot, themes: themes.map((theme) => theme.id), written });
    return;
  }
  process.stdout.write(`已写入 ${targetRoot}（${seedMode ? "种子模式" : "项目模式"}${tokensOnly ? "，仅 token 层" : ""}）：\n${written.map((file) => `  ${file}`).join("\n")}\n`);
  if (!tokensOnly) {
    process.stdout.write(`\nDESIGN.md 里还有 ${pending} 处「待填写 / 待确认」，接入前必须清零；推断角色与缺口在 AUDIT.md。\n`);
  }
  process.stdout.write(`\n接下来交给 steward（${steward ? `${steward.dir}${steward.tooOld ? "，版本过旧" : ""}` : "未找到"}）：\n${commands.map((command) => `  ${command}`).join("\n")}\n`);
}

function describeActivation(themeMap, themeId) {
  const kind = themeMap?.activation?.kind;
  if (kind === "data-attribute") return `:root[${themeMap.activation.attribute}="${themeId}"]`;
  if (kind === "class") return `:root.${themeId}`;
  if (kind === "media") return `@media (prefers-color-scheme: ${themeId})`;
  return "待确认";
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

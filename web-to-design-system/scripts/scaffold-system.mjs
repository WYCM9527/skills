#!/usr/bin/env node
// 写入：把 draft-tokens 的草稿（人核对过之后）落成符合规范的 design-system/ 目录——三种落点：
//   --project <dir>      项目模式：写 <dir>/design-system/（tokens、themes、theme-map、scope-map、style-dictionary 配置、DESIGN.md、AUDIT.md）
//   --seed <dir>         种子模式：在项目模式之上再写 design-system.json、bridge/base.css、templates/*、migration/roles.json、README / CHANGELOG / package.json，
//                        design-system-adopter 能 `ds.mjs init --system <dir> --stack css` 直接接入
//   --into-repo <仓库根>  发布模式：按 Design-System 仓库约定写到 <仓库根>/<id>/seeds/<seed-name>/，身份文件的 upstream 由仓库远端与实际路径推出（防呆），
//                        再写系统级 <id>/README.md 并在仓库根 README 的系统表格里加一行
// 可叠加：--with-citrine-bridges <Citrine 种子目录>（拷 Element Plus / shadcn / recipes / ECharts 桥接与配方组件当起点，并扫出桥接引用但本系统缺的 token 写进 AUDIT）、
//        --build（在种子目录跑 steward build-tokens，把 dist/ 一起产出——纯 CSS 渠道 export 直接读它）。
// 校验 / 构建 / Guard 本身交给 design-system-steward；脚本结束时打印那三条命令。
//
// 用法：node scaffold-system.mjs --from <draftDir> (--project <dir> | --seed <dir> | --into-repo <repoRoot>) --id <id> --name <名称>
//       [--seed-name <目录名=id>] [--version 0.1.0] [--description "…"] [--repo owner/repo] [--path <包子路径>] [--npm @scope/id]
//       [--with-citrine-bridges <dir>] [--build] [--force] [--tokens-only] [--json]

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { fileExists, parseArgs, printJson, readJson, reportError, requireAbsolutePath, requireStringOption, skillRoot, writeJson, writeText } from "./lib/args.mjs";
import { copyBridges, missingBridgeVariables, scanBridgeVariables } from "./lib/bridges.mjs";
import { cssVariableName, flattenTokens } from "./lib/dtcg.mjs";
import { findRepoRoot, gitRemoteRepo, upsertReadmeRow } from "./lib/repo.mjs";
import { buildMigrationRoles, ROLES } from "./lib/roles.mjs";
import { locateSteward, stewardCommands } from "./lib/steward.mjs";

const assetsRoot = path.join(skillRoot, "assets");
const fill = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, value ?? ""), template);
const readAsset = (relative) => readFile(path.join(assetsRoot, relative), "utf8");

function describeActivation(themeMap, themeId) {
  const kind = themeMap?.activation?.kind;
  if (kind === "data-attribute") return `:root[${themeMap.activation.attribute}="${themeId}"]`;
  if (kind === "class") return `:root.${themeId}`;
  if (kind === "media") return `@media (prefers-color-scheme: ${themeId})`;
  return "待确认";
}

/** 在种子目录里构建 dist：没有 style-dictionary 就先 npm i --no-save；返回 { ok, transcript }。 */
function buildDist(seedRoot, steward) {
  if (!steward) {
    return { ok: false, transcript: "未找到 design-system-steward，跳过构建" };
  }
  const binary = path.join(seedRoot, "node_modules", ".bin", process.platform === "win32" ? "style-dictionary.cmd" : "style-dictionary");
  if (!existsSync(binary)) {
    const install = spawnSync("npm", ["i", "--no-save", "--no-package-lock", "--no-audit", "--no-fund", "style-dictionary@5.5.2"], { cwd: seedRoot, encoding: "utf8" });
    if (install.status !== 0) {
      return { ok: false, transcript: `在 ${seedRoot} 安装 style-dictionary@5.5.2 失败：${(install.stderr || install.stdout).trim().slice(-400)}` };
    }
  }
  const build = spawnSync("node", [path.join(steward.dir, "scripts", "build-tokens.mjs"), "--project", seedRoot], { encoding: "utf8" });
  if (build.status !== 0) {
    return { ok: false, transcript: (build.stderr || build.stdout).trim().slice(-600) };
  }
  return { ok: true, transcript: build.stdout.trim() };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const draftDir = requireAbsolutePath(path.resolve(process.cwd(), requireStringOption(options, "from")), "--from");
  const modes = ["project", "seed", "into-repo"].filter((key) => options[key] !== undefined);
  if (modes.length !== 1) {
    throw new Error("--project / --seed / --into-repo 三选一（且要带目录参数）");
  }
  const mode = modes[0];
  if (options[mode] === true) {
    throw new Error(`--${mode} 需要目录参数`);
  }
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
  const seedName = String(options["seed-name"] ?? id);
  if (!/^[a-z][a-z0-9-]*$/.test(seedName)) {
    throw new Error("--seed-name 必须是 kebab-case");
  }

  // 落点与身份文件默认值
  let targetRoot;
  let repoRoot = null;
  let repoSlug = String(options.repo ?? "");
  let upstreamPath = String(options.path ?? "");
  if (mode === "into-repo") {
    repoRoot = requireAbsolutePath(path.resolve(process.cwd(), String(options["into-repo"])), "--into-repo");
    if (!existsSync(path.join(repoRoot, "README.md"))) {
      throw new Error(`${repoRoot} 看起来不是仓库根（没有 README.md）`);
    }
    targetRoot = path.join(repoRoot, id, "seeds", seedName);
    const remote = gitRemoteRepo(repoRoot);
    if (!repoSlug) repoSlug = remote ?? "WYCM9527/Design-System";
    if (remote && options.repo && remote !== options.repo) {
      throw new Error(`--repo ${options.repo} 与仓库远端 ${remote} 不一致；adopter 会按 upstream.repo 拉 tag，必须是真实远端`);
    }
    const actualPath = `${id}/seeds/${seedName}`;
    if (upstreamPath && upstreamPath !== actualPath) {
      throw new Error(`--path ${upstreamPath} 与实际写入位置 ${actualPath} 不一致；upstream.path 必须等于种子在仓库里的子路径`);
    }
    upstreamPath = actualPath;
  } else {
    targetRoot = requireAbsolutePath(path.resolve(process.cwd(), String(options[mode])), `--${mode}`);
    if (mode === "seed") {
      repoRoot = findRepoRoot(targetRoot);
      const remote = repoRoot ? gitRemoteRepo(repoRoot) : null;
      if (!repoSlug) repoSlug = remote ?? "<owner>/<repo>";
      if (!upstreamPath) upstreamPath = repoRoot ? path.relative(repoRoot, targetRoot).split(path.sep).join("/") || id : id;
    }
  }
  const seedMode = mode !== "project";
  const owner = repoSlug.split("/")[0]?.toLowerCase();
  const npm = String(options.npm ?? (owner && owner !== "<owner>" ? `@${owner}/${id}` : `@company/${id}`));

  // 读草稿
  const notesPath = path.join(draftDir, "draft-notes.json");
  const notes = (await fileExists(notesPath)) ? await readJson(notesPath) : null;
  const primitives = await readJson(path.join(draftDir, "tokens", "primitives.tokens.json"));
  const semantic = await readJson(path.join(draftDir, "tokens", "semantic.tokens.json"));
  const themeMapPath = path.join(draftDir, "theme-map.json");
  const themeMap = (await fileExists(themeMapPath)) ? await readJson(themeMapPath) : null;
  const themes = [];
  for (const entry of themeMap?.themes ?? []) {
    const tokensPath = path.join(draftDir, "themes", entry.id, "tokens", "semantic.tokens.json");
    if (await fileExists(tokensPath)) themes.push({ ...entry, tokens: await readJson(tokensPath) });
  }
  const sources = notes?.sources?.length ? notes.sources.map((source) => source.url).join("、") : "（来源未记录）";
  const date = new Date().toISOString().slice(0, 10);
  const semanticPaths = new Set(flattenTokens(semantic).keys());
  const tokenCount = flattenTokens(primitives).size + semanticPaths.size;

  const systemRoot = path.join(targetRoot, "design-system");
  if ((await fileExists(systemRoot)) && !force && !tokensOnly) {
    throw new Error(`${systemRoot} 已存在。重新同步 token 用 --tokens-only（不动 DESIGN.md / AUDIT.md）；整目录重写用 --force。`);
  }

  const written = [];
  const put = async (relative, contents) => {
    const destination = path.join(targetRoot, relative);
    if (typeof contents === "string") await writeText(destination, contents);
    else await writeJson(destination, contents, { stable: false });
    written.push(relative);
  };

  // —— token 层 ——
  if (force && (await fileExists(path.join(systemRoot, "themes")))) await rm(path.join(systemRoot, "themes"), { force: true, recursive: true });
  await put("design-system/tokens/primitives.tokens.json", primitives);
  await put("design-system/tokens/semantic.tokens.json", semantic);
  await put("design-system/scope-map.json", { scopes: [], version: 1 });
  if (themeMap && themes.length) {
    await put("design-system/theme-map.json", { ...themeMap, themes: themeMap.themes.map(({ tokens, ...rest }) => rest) });
    for (const theme of themes) await put(`design-system/themes/${theme.id}/tokens/semantic.tokens.json`, theme.tokens);
  } else if (await fileExists(path.join(systemRoot, "theme-map.json"))) {
    await rm(path.join(systemRoot, "theme-map.json"), { force: true });
  }
  await put("design-system/style-dictionary.config.mjs", await readAsset("style-dictionary.config.mjs"));
  if (!(await fileExists(path.join(systemRoot, "dist")))) await put("design-system/dist/.gitkeep", "");

  // —— 种子模式：桥接（先拷，AUDIT 才能写桥接缺口） ——
  let bridgeReport = null;
  let extraStacks = {};
  let extraExport = {};
  if (seedMode && !tokensOnly) {
    await put("bridge/base.css", fill(await readAsset("seed/bridge/base.css"), { NAME: name }));
    if (typeof options["with-citrine-bridges"] === "string") {
      const sourceSeed = requireAbsolutePath(path.resolve(process.cwd(), options["with-citrine-bridges"]), "--with-citrine-bridges");
      const copied = copyBridges(sourceSeed, targetRoot);
      written.push(...copied.copied);
      extraStacks = copied.stacks;
      extraExport = copied.exportOptional;
      const systemVariables = new Set();
      for (const tokenPath of semanticPaths) systemVariables.add(cssVariableName(tokenPath));
      for (const tokenPath of flattenTokens(primitives).keys()) systemVariables.add(cssVariableName(tokenPath));
      const scan = scanBridgeVariables(path.join(targetRoot, "bridge"));
      const missing = missingBridgeVariables(systemVariables, scan);
      bridgeReport = { copied: copied.copied.length, missing, source: sourceSeed, sourceId: copied.sourceIdentity?.id ?? "unknown", sourceVersion: copied.sourceIdentity?.version ?? "?" };
    }
  }

  // —— 文档层 ——
  if (!tokensOnly) {
    const themeNote = themes.length
      ? themes.map((theme) => `- 本系统登记了 Theme \`${theme.id}\`（激活：${describeActivation(themeMap, theme.id)}；默认 \`${themeMap.defaultTheme}\`），delta 见 \`themes/${theme.id}/\`；运行时所有者待接入方确认。`).join("\n")
      : "- 本次取证未发现另一模式（或切换靠 JS 未被识别）。不要从现有颜色自动反相造暗色；需要时先走提案。";
    await put("design-system/DESIGN.md", fill(await readAsset("DESIGN.template.md"), { DATE: date, NAME: name, SOURCES: sources, THEME_NOTE: themeNote }));

    const inferred = Object.entries(notes?.roles ?? {}).filter(([, role]) => role.source === "inferred");
    const bridgeNotes = bridgeReport
      ? [
        "",
        "## 桥接缺口",
        "",
        `\`bridge/\` 从 ${bridgeReport.sourceId} ${bridgeReport.sourceVersion} 拷入 ${bridgeReport.copied} 个文件当起点（${bridgeReport.source}）。它把组件库的变量与写死的色表接到语义 token 上，这部分通用；但也带着来源系统的品牌决定（hover 不出现品牌色、选中用反转块、状态色只做浅底胶囊、控件三档高度等），接入前照下表处理：**补 token**（本系统确实需要这个用途）或 **删规则**（本系统不需要），然后挂走查页亮 / 暗逐组件过一遍。`,
        "",
        bridgeReport.missing.length
          ? ["| 桥接引用的变量 | 引用文件 | 决定 |", "| --- | --- | --- |", ...bridgeReport.missing.map((entry) => `| \`--${entry.name}\` | ${entry.files.slice(0, 3).join("、")}${entry.files.length > 3 ? ` 等 ${entry.files.length} 处` : ""} | 待决定：补 token / 删规则 |`)].join("\n")
          : "桥接引用的变量本系统全部具备。"
      ].join("\n")
      : "";
    await put("design-system/AUDIT.md", fill(await readAsset("AUDIT.template.md"), {
      BRAND: notes?.brand ? `${notes.brand.family ?? "无（单色站点）"}${notes.brand.override ? `（用户指定 ${notes.brand.override}）` : ""}` : "未记录",
      BRIDGE_NOTES: bridgeNotes,
      DATE: date,
      EVIDENCE: notes?.evidence ?? "（未记录）",
      INFERRED: String(notes?.counts?.inferred ?? inferred.length),
      INFERRED_ROWS: inferred.length ? inferred.map(([rolePath, role]) => `| \`${rolePath}\` | \`{${role.target}}\` | ${role.evidence} | 待确认 |`).join("\n") : "| — | | | |",
      INITIAL_SCHEME: notes?.initialScheme ?? "light",
      MISSING: String(notes?.counts?.missing ?? notes?.missing?.length ?? 0),
      MISSING_CORE: String(notes?.counts?.missingCore ?? 0),
      MISSING_ROWS: notes?.missing?.length ? notes.missing.map((entry) => `| \`${entry.path}\` | ${entry.tier} | ${entry.zh} | ${entry.hint || "—"} | 待决定：补证据 / 按推断填 / 本系统不需要 |`).join("\n") : "| — | | | | |",
      NAME: name,
      OBSERVED: String(notes?.counts?.observed ?? 0),
      SOURCES: sources,
      THEME_LINE: themes.length
        ? `另一模式：${themes.map((theme) => `\`${theme.id}\`（${notes?.alternateMode?.source ?? "取证时切换"}，delta ${flattenTokens(theme.tokens).size} 条）`).join("、")}`
        : "未取到另一模式",
      VIEWPORT: "1440×900",
      WARNING_ROWS: notes?.warnings?.length ? notes.warnings.map((warning) => `- 取证警告：${warning}`).join("\n") : ""
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

  // —— 种子模式：身份文件、模板、迁移对照、README / CHANGELOG / package.json ——
  let identity = null;
  if (seedMode && !tokensOnly) {
    const description = String(options.description ?? `${name}：从 ${sources} 实测提炼的设计系统。`);
    const stackIds = ["css", ...Object.keys(extraStacks)];
    const seedValues = { DATE: date, DESCRIPTION: description, ID: id, NAME: name, NPM: npm, PATH: upstreamPath, REPO: repoSlug, SOURCES: sources, VERSION: version };
    identity = JSON.parse(fill(await readAsset("seed/design-system.template.json"), seedValues));
    identity.stacks = { ...identity.stacks, ...extraStacks };
    if (Object.keys(extraExport).length) {
      identity.export.optional = extraExport;
      if (!identity.export.core.includes("bridge/recipes.css") && existsSync(path.join(targetRoot, "bridge", "recipes.css"))) identity.export.core.push("bridge/recipes.css");
    }
    if (!themes.length) identity.owned = identity.owned.filter((glob) => !glob.startsWith("design-system/themes") && glob !== "design-system/theme-map.json");
    await put("design-system.json", identity);
    for (const stackId of stackIds) {
      await put(`templates/entry-${stackId}.css`, fill(await readAsset(`seed/templates/entry-${stackId}.css`), seedValues));
      await put(`templates/notes-${stackId}.md`, fill(await readAsset(`seed/templates/notes-${stackId}.md`), seedValues));
    }
    await put("templates/AGENTS.md", fill(await readAsset("seed/templates/AGENTS.md"), seedValues));
    await put("migration/roles.json", buildMigrationRoles(id, new Set([...semanticPaths, ...flattenTokens(primitives).keys()]), cssVariableName)); // radius.* 是 Primitive，页面直接用
    const themeTree = themes.map((theme) => `├── themes/${theme.id}/                   # 相对 Core 的 delta + THEME.md\n├── theme-map.json                  # 激活方式 / 默认模式 / 登记\n`).join("");
    const bridgeTree = bridgeReport
      ? `bridge/                             # base.css（纯 CSS 栈）+ 从 ${bridgeReport.sourceId} 拷入的 ${Object.keys(extraStacks).join(" / ")} 桥接、recipes、配方组件（起点，见 AUDIT「桥接缺口」）\n`
      : "bridge/base.css                     # 基础桥接（纯 CSS 栈）：body / 标题 / 链接 / 表单控件 / 焦点 / 减少动态效果，只引用变量\n";
    await put("README.md", fill(await readAsset("seed/README.template.md"), { ...seedValues, BRIDGE_TREE: bridgeTree, DEFAULT_STACK: stackIds[0], STACK_LIST: stackIds.map((stackId) => `\`${stackId}\`（${identity.stacks[stackId].label}）`).join("、"), THEME_TREE: themeTree }));
    await put("CHANGELOG.md", `# Changelog\n\n版本策略：patch 只改描述与文档；minor 新增或修改 token（视觉会变、名字不变，条目里写清肉眼可见的影响）；major 才改名或删除 token。\n\n## ${version} — ${date}\n\n- 由 web-to-design-system 从 ${sources} 实测提炼的初版：primitives ${notes?.counts?.primitives ?? "?"} 个，语义角色 观察 ${notes?.counts?.observed ?? "?"} / 推断 ${notes?.counts?.inferred ?? "?"}${themes.length ? `，Theme ${themes.map((theme) => theme.id).join(" / ")}` : "，无 Theme"}${bridgeReport ? `；桥接从 ${bridgeReport.sourceId} ${bridgeReport.sourceVersion} 拷入（${bridgeReport.missing.length} 个变量待补 / 待删）` : ""}。推断项与缺口见 design-system/AUDIT.md。\n`);
    const pkg = JSON.parse(fill(await readAsset("seed/package.template.json"), seedValues));
    if (bridgeReport) {
      // 拷了桥接：把配方组件 / 图表 / 图标配置的 exports 暴露出来（接线要点里的 @scope/id/vue/* 才能解析），peer 依赖沿用来源种子的可选声明
      const has = (relative) => existsSync(path.join(targetRoot, relative));
      if (has("bridge/echarts.js")) pkg.exports["./echarts"] = has("bridge/echarts.d.ts") ? { default: "./bridge/echarts.js", types: "./bridge/echarts.d.ts" } : "./bridge/echarts.js";
      if (has("bridge/iconpark.config.ts")) pkg.exports["./iconpark.config"] = "./bridge/iconpark.config.ts";
      if (has("bridge/vue")) pkg.exports["./vue/*"] = "./bridge/vue/*";
      if (has("bridge/react")) pkg.exports["./react/*"] = "./bridge/react/*.tsx";
      const sourcePkgPath = path.join(bridgeReport.source, "package.json");
      if (existsSync(sourcePkgPath)) {
        const sourcePkg = JSON.parse(await readFile(sourcePkgPath, "utf8"));
        if (sourcePkg.peerDependencies) pkg.peerDependencies = sourcePkg.peerDependencies;
        if (sourcePkg.peerDependenciesMeta) pkg.peerDependenciesMeta = sourcePkg.peerDependenciesMeta;
      }
    }
    await put("package.json", pkg);
    await put(".gitignore", "node_modules/\n.DS_Store\n");
  }

  // —— 发布模式：系统级 README + 仓库根 README 表格 ——
  const repoWrites = [];
  if (mode === "into-repo" && !tokensOnly) {
    const systemReadme = path.join(repoRoot, id, "README.md");
    const stackIds = Object.keys(identity.stacks);
    await writeText(systemReadme, fill(await readAsset("seed/SYSTEM_README.template.md"), {
      BRIDGE_STATUS: bridgeReport ? `从 ${bridgeReport.sourceId} 拷入 ${Object.keys(extraStacks).join(" / ")} 桥接当起点，${bridgeReport.missing.length} 个变量待补 / 待删（AUDIT「桥接缺口」）；未做走查` : "只有纯 CSS 基础桥接；组件库桥接待做",
      DATE: date,
      DEFAULT_STACK: stackIds[0],
      DESCRIPTION: identity.description,
      ID: id,
      NAME: name,
      PATH: upstreamPath,
      REPO: repoSlug,
      SEED_NAME: seedName,
      SOURCES: sources,
      THEME_SUMMARY: themes.length ? ` · ${themes.map((theme) => `${theme.id} ${flattenTokens(theme.tokens).size} 条 delta`).join(" · ")}` : " · 无 Theme",
      TODO_LINE: `DESIGN.md「待填写」清零、AUDIT 推断 ${notes?.counts?.inferred ?? "?"} 条逐条确认、core 缺口 ${notes?.counts?.missingCore ?? "?"} 个处理、\`publish-check.mjs\` 通过后再打 tag`,
      TOKEN_COUNT: String(tokenCount),
      VERSION: version
    }));
    repoWrites.push(`${id}/README.md`);
    const rootReadmePath = path.join(repoRoot, "README.md");
    const upsert = upsertReadmeRow(await readFile(rootReadmePath, "utf8"), { description: identity.description.replace(/\|/g, "／"), id, name, version });
    if (upsert.changed) {
      await writeText(rootReadmePath, upsert.text);
      repoWrites.push(`README.md（${upsert.reason}）`);
    } else {
      repoWrites.push(`README.md 未改：${upsert.reason}`);
    }
  }

  // —— 构建 dist ——
  const steward = locateSteward(repoRoot ?? targetRoot);
  let build = null;
  if (options.build === true) {
    build = buildDist(targetRoot, steward);
    if (build.ok) {
      await rm(path.join(systemRoot, "dist", ".gitkeep"), { force: true });
      written.push("design-system/dist/*（steward 构建）");
    }
  }

  // —— 收尾 ——
  const designPath = path.join(systemRoot, "DESIGN.md");
  const pending = (await fileExists(designPath)) ? ((await readFile(designPath, "utf8")).match(/待填写|待确认/g) ?? []).length : 0;
  const commands = stewardCommands(targetRoot, steward);
  const result = { build: build ? { ok: build.ok } : null, bridge: bridgeReport ? { copied: bridgeReport.copied, missing: bridgeReport.missing.map((entry) => entry.name) } : null, identity: identity ? { id, npm, path: upstreamPath, repo: repoSlug, stacks: Object.keys(identity.stacks) } : null, mode, pending, repoWrites, steward: steward?.dir ?? null, target: targetRoot, themes: themes.map((theme) => theme.id), written };
  if (options.json === true) {
    printJson(result);
    if (build && !build.ok) process.exitCode = 1;
    return;
  }
  const modeLabel = { "into-repo": "发布模式", project: "项目模式", seed: "种子模式" }[mode];
  process.stdout.write(`已写入 ${targetRoot}（${modeLabel}${tokensOnly ? "，仅 token 层" : ""}）：${written.length} 个文件\n`);
  if (identity) process.stdout.write(`身份文件：id ${id} · upstream ${repoSlug} @ ${upstreamPath} · tag 前缀 ${id}-v · npm ${npm} · 栈 ${Object.keys(identity.stacks).join(" / ")}\n`);
  if (bridgeReport) process.stdout.write(`桥接：从 ${bridgeReport.sourceId} ${bridgeReport.sourceVersion} 拷入 ${bridgeReport.copied} 个文件；引用了本系统没有的变量 ${bridgeReport.missing.length} 个${bridgeReport.missing.length ? `（如 ${bridgeReport.missing.slice(0, 6).map((entry) => `--${entry.name}`).join("、")}），已写进 AUDIT.md「桥接缺口」` : ""}\n`);
  if (repoWrites.length) process.stdout.write(`仓库：${repoWrites.join("；")}\n`);
  if (build) process.stdout.write(build.ok ? `构建：dist/ 已由 steward 生成\n` : `构建失败：${build.transcript}\n`);
  if (!tokensOnly) process.stdout.write(`\nDESIGN.md 里还有 ${pending} 处「待填写 / 待确认」，发布前必须清零；推断角色与缺口在 AUDIT.md。\n`);
  process.stdout.write(`\n接下来交给 steward（${steward ? `${steward.dir}${steward.tooOld ? "，版本过旧" : ""}` : "未找到"}）：\n${commands.map((command) => `  ${command}`).join("\n")}\n`);
  if (seedMode) process.stdout.write(`发布前：node ${path.join(skillRoot, "scripts", "publish-check.mjs")} --seed "${targetRoot}"\n`);
  if (build && !build.ok) process.exitCode = 1;
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

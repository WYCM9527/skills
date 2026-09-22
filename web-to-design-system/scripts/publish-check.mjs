#!/usr/bin/env node
// 发布前门禁：一个种子要进 Design-System 仓库、打 tag、让 adopter 分发之前必须过的检查。
//   身份文件完整且引用的文件都在 · 版本号处处一致（design-system.json / package.json / CHANGELOG / 种子 README / <id>/README / 仓库根 README 表格）
//   · upstream.path / repo / tagPrefix 与真实位置一致 · DESIGN.md 没有「待填写 / 待确认」· token 里没有未确认的 [推断]（--allow-inferred 降级为警告）
//   · AUDIT.md 贴了对比度报告 · steward validate-system 通过、guard current（dist 已构建且与源一致）· 对比度失败项只作警告（已登记例外的前提是 AUDIT 有报告）
// 退出码：有 ✘ 为 1；--json 输出机器可读结果。
//
// 用法：node publish-check.mjs --seed <种子目录> [--allow-inferred] [--json]

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs, printJson, reportError, requireAbsolutePath, requireStringOption } from "./lib/args.mjs";
import { findRepoRoot, gitRemoteRepo, readmeRowVersion } from "./lib/repo.mjs";
import { locateSteward } from "./lib/steward.mjs";
import { loadTypes } from "./lib/types.mjs";

const read = (file) => readFileSync(file, "utf8");
const readJsonSafe = (file) => {
  try {
    return JSON.parse(read(file));
  } catch {
    return null;
  }
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const seedRoot = requireAbsolutePath(path.resolve(process.cwd(), requireStringOption(options, "seed")), "--seed");
  const allowInferred = options["allow-inferred"] === true;
  const results = [];
  const check = (name, ok, detail = "", level = "fail") => results.push({ detail, name, ok, status: ok ? "pass" : level });
  const warn = (name, ok, detail = "") => check(name, ok, detail, "warn");

  // —— 身份文件 ——
  const identityPath = path.join(seedRoot, "design-system.json");
  const identity = existsSync(identityPath) ? readJsonSafe(identityPath) : null;
  check("design-system.json 存在且可解析", Boolean(identity), identity ? "" : identityPath);
  if (!identity) {
    return finish(results, options);
  }
  const id = identity.id;
  const version = identity.version;
  check("身份文件必填字段", ["id", "name", "version", "upstream", "stacks", "owned"].every((key) => identity[key]), "id / name / version / upstream / stacks / owned");
  check("id 是 kebab-case", /^[a-z][a-z0-9-]*$/.test(id ?? ""), String(id));
  check("version 是 x.y.z", /^\d+\.\d+\.\d+$/.test(version ?? ""), String(version));
  check("tagPrefix = <id>-v", identity.upstream?.tagPrefix === `${id}-v`, `${identity.upstream?.tagPrefix} vs ${id}-v`);
  check("upstream.repo 是 owner/repo", /^[\w.-]+\/[\w.-]+$/.test(identity.upstream?.repo ?? ""), String(identity.upstream?.repo));
  const missingFiles = [];
  const expectFile = (relative, label) => {
    if (typeof relative === "string" && !existsSync(path.join(seedRoot, relative))) missingFiles.push(`${label}: ${relative}`);
  };
  for (const [stackId, stack] of Object.entries(identity.stacks ?? {})) {
    for (const key of ["entry", "snippet", "notes", "components", "kitchen"]) expectFile(stack[key], `stacks.${stackId}.${key}`);
    for (const extra of stack.extra ?? []) expectFile(extra, `stacks.${stackId}.extra`);
  }
  expectFile(identity.agents, "agents");
  expectFile(identity.migration?.roles, "migration.roles");
  for (const file of identity.export?.core ?? []) expectFile(file, "export.core");
  for (const [group, files] of Object.entries(identity.export?.optional ?? {})) for (const file of files) expectFile(file, `export.optional.${group}`);
  for (const [key, file] of Object.entries(identity.docs ?? {})) expectFile(file, `docs.${key}`);
  check("身份文件引用的文件都存在", missingFiles.length === 0, missingFiles.join("；"));
  {
    // 系统类型：身份文件的 type 要能在内置 / 仓库 system-types / --types-dir 里找到（adopter 只当元数据，但文档口径靠它）
    const registry = await loadTypes({ dirs: String(options["types-dir"] ?? "").split(",").map((dir) => dir.trim()).filter(Boolean), startDir: seedRoot });
    const typeId = identity.type ?? identity.profile ?? null;
    const known = typeId ? registry.types.has(typeId) || registry.aliases.has(typeId) : false;
    warn("身份文件写了系统类型且类型定义存在", known, typeId ? `${typeId}${known ? "" : `（可用：${[...registry.types.keys()].join(" / ")}）`}` : "缺 type 字段（旧种子按 product 处理）");
  }

  // —— 版本一致 ——
  const pkg = readJsonSafe(path.join(seedRoot, "package.json"));
  check("package.json 版本 = 身份文件", pkg?.version === version, `${pkg?.version} vs ${version}`);
  check("package.json name = upstream.npm（folder 渠道 npm i file: 靠它）", !identity.upstream?.npm || pkg?.name === identity.upstream.npm, `${pkg?.name} vs ${identity.upstream?.npm}`);
  const changelogPath = path.join(seedRoot, "CHANGELOG.md");
  const changelogVersion = existsSync(changelogPath) ? read(changelogPath).match(/^## (\d+\.\d+\.\d+)/m)?.[1] : null;
  check("CHANGELOG 最新条目 = 版本", changelogVersion === version, `${changelogVersion} vs ${version}`);
  const seedReadmePath = path.join(seedRoot, "README.md");
  const seedReadmeVersion = existsSync(seedReadmePath) ? read(seedReadmePath).match(/^版本 (\d+\.\d+\.\d+) · /m)?.[1] : null;
  check("种子 README 版本行 = 版本", seedReadmeVersion === version, `${seedReadmeVersion} vs ${version}`);

  // —— 与仓库的位置关系 ——
  const repoRoot = findRepoRoot(seedRoot);
  if (repoRoot) {
    const relative = path.relative(repoRoot, seedRoot).split(path.sep).join("/");
    check("upstream.path = 种子在仓库里的子路径", identity.upstream?.path === relative, `${identity.upstream?.path} vs ${relative}`);
    const remote = gitRemoteRepo(repoRoot);
    if (remote) check("upstream.repo = 仓库远端", identity.upstream?.repo === remote, `${identity.upstream?.repo} vs ${remote}`);
    else warn("仓库没有 origin 远端，无法核对 upstream.repo", false, identity.upstream?.repo);
    const inRepoLayout = relative.startsWith(`${id}/seeds/`);
    warn("目录布局 <id>/seeds/<seed-name>", inRepoLayout, relative);
    if (inRepoLayout) {
      const systemReadme = path.join(repoRoot, id, "README.md");
      const systemVersion = existsSync(systemReadme) ? read(systemReadme).match(/^版本 \*\*(\d+\.\d+\.\d+)\*\*/m)?.[1] : null;
      check(`${id}/README.md 版本行 = 版本`, systemVersion === version, `${systemVersion} vs ${version}`);
      const rootReadme = path.join(repoRoot, "README.md");
      const rowVersion = existsSync(rootReadme) ? readmeRowVersion(read(rootReadme), id) : null;
      check("仓库根 README 表格行 = 版本", rowVersion === version, rowVersion ? `${rowVersion} vs ${version}` : "表格里没有这一行");
      const tag = `${id}-v${version}`;
      const tagged = spawnSync("git", ["-C", repoRoot, "tag", "-l", tag], { encoding: "utf8" }).stdout.trim() === tag;
      warn(`tag ${tag} 尚未存在（存在说明这个版本已发过，改动要升版本）`, !tagged, tagged ? "已存在" : "");
    }
  } else {
    warn("种子不在 git 仓库里，跳过 upstream.path / repo 与 README 表格核对", false, seedRoot);
  }

  // —— 文档与 token 的完成度 ——
  const systemRoot = path.join(seedRoot, "design-system");
  const designPath = path.join(systemRoot, "DESIGN.md");
  const pending = existsSync(designPath) ? (read(designPath).match(/待填写|待确认/g) ?? []).length : -1;
  check("DESIGN.md 没有「待填写 / 待确认」", pending === 0, pending < 0 ? "DESIGN.md 不存在" : `${pending} 处`);
  const tokenFiles = [path.join(systemRoot, "tokens", "semantic.tokens.json"), ...(existsSync(path.join(systemRoot, "themes")) ? spawnSync("bash", ["-lc", `ls "${path.join(systemRoot, "themes")}"/*/tokens/*.json 2>/dev/null`], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean) : [])];
  const inferred = tokenFiles.reduce((total, file) => total + ((existsSync(file) ? read(file) : "").match(/\[推断\]/g) ?? []).length, 0);
  check("token 描述里没有未确认的 [推断]", inferred === 0, inferred ? `${inferred} 条（确认后改为 [确认]${allowInferred ? "；--allow-inferred 已降级为警告" : "，或加 --allow-inferred 以 0.x 发布"}）` : "", allowInferred ? "warn" : "fail");
  const auditPath = path.join(systemRoot, "AUDIT.md");
  const audit = existsSync(auditPath) ? read(auditPath) : "";
  check("AUDIT.md 贴了对比度报告", audit.length > 0 && !audit.includes("待填写：对比度报告"), audit ? "" : "AUDIT.md 不存在");
  warn("AUDIT.md 没有其他「待填写」", audit.length > 0 && !/待填写/.test(audit), `${(audit.match(/待填写/g) ?? []).length} 处`);
  const bridgeMissing = (audit.match(/\| 待决定：补 token \/ 删规则 \|/g) ?? []).length;
  warn("AUDIT「桥接缺口」每行有决定", bridgeMissing === 0, bridgeMissing ? `${bridgeMissing} 行仍是「待决定」` : "");

  // —— steward：validate + guard（dist 已构建且与源一致） ——
  const steward = locateSteward(seedRoot);
  if (!steward) {
    check("design-system-steward 可用", false, "未找到；`node <adopter>/scripts/ds.mjs steward install`");
  } else {
    const validate = spawnSync("node", [path.join(steward.dir, "scripts", "validate-system.mjs"), "--project", seedRoot], { encoding: "utf8" });
    const validateJson = readJsonText(validate.stdout);
    check("steward validate-system 通过", validateJson?.valid === true, validateJson ? (validateJson.issues ?? []).slice(0, 3).map((issue) => issue.message).join("；") : validate.stderr.trim().slice(-300));
    const distExists = existsSync(path.join(systemRoot, "dist", "tokens.css"));
    check("dist/ 已构建（随种子提交，纯 CSS 渠道直接读）", distExists, distExists ? "" : "运行 scaffold --build 或 steward build-tokens");
    if (distExists) {
      const guard = spawnSync("node", [path.join(steward.dir, "scripts", "guard.mjs"), "--project", seedRoot], { encoding: "utf8" });
      const guardJson = readJsonText(guard.stdout);
      check("steward guard = current（dist 与源一致）", guardJson?.status === "current", guardJson?.status ?? guard.stderr.trim().slice(-300));
    }
  }

  // —— 对比度（只作警告：例外应已登记在 AUDIT） ——
  const contrast = spawnSync("node", [path.join(path.dirname(fileURLToPath(import.meta.url)), "check-contrast.mjs"), "--system", systemRoot, "--json"], { encoding: "utf8" });
  const contrastJson = readJsonText(contrast.stdout);
  if (contrastJson) warn("对比度基线无失败项（失败项须在 AUDIT / DESIGN 登记为例外）", contrastJson.failures === 0, `${contrastJson.failures} / ${contrastJson.checked} 组低于底线`);

  finish(results, options);
}

function readJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function finish(results, options) {
  const failures = results.filter((entry) => entry.status === "fail");
  const warnings = results.filter((entry) => entry.status === "warn");
  if (options.json === true) {
    printJson({ failures: failures.length, results, valid: failures.length === 0, warnings: warnings.length });
  } else {
    for (const entry of results) {
      const mark = entry.status === "pass" ? "✔" : entry.status === "warn" ? "△" : "✘";
      process.stdout.write(`${mark} ${entry.name}${entry.detail ? `  — ${entry.detail}` : ""}\n`);
    }
    process.stdout.write(`\n${failures.length ? `${failures.length} 项不通过` : "可以发布"}${warnings.length ? `，${warnings.length} 项警告` : ""}。\n`);
  }
  process.exitCode = failures.length ? 1 : 0;
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

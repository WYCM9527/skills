// Design-System 仓库相关：找仓库根、从 git 远端推 owner/repo、枚举 */seeds/*/design-system.json、维护根 README 的系统表格。
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** 从 dir 向上找 .git，返回仓库根；找不到返回 null。 */
export function findRepoRoot(dir) {
  let cursor = path.resolve(dir);
  for (let index = 0; index < 12; index += 1) {
    if (existsSync(path.join(cursor, ".git"))) {
      return cursor;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return null;
    }
    cursor = parent;
  }
  return null;
}

/** origin 远端的 GitHub owner/repo（https 与 ssh 两种写法都认）；不是 GitHub 或没有远端返回 null。 */
export function gitRemoteRepo(dir) {
  const result = spawnSync("git", ["-C", dir, "remote", "get-url", "origin"], { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  const match = result.stdout.trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

/** 仓库里所有设计系统：<id>/seeds/<seedName>/design-system.json。 */
export function enumerateSystems(repoRoot) {
  const systems = [];
  for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }
    const seedsRoot = path.join(repoRoot, entry.name, "seeds");
    if (!existsSync(seedsRoot)) {
      continue;
    }
    for (const seed of readdirSync(seedsRoot, { withFileTypes: true })) {
      const identityPath = path.join(seedsRoot, seed.name, "design-system.json");
      if (seed.isDirectory() && existsSync(identityPath)) {
        try {
          const identity = JSON.parse(readFileSync(identityPath, "utf8"));
          systems.push({ dir: entry.name, identity, seedDir: path.join(seedsRoot, seed.name), seedName: seed.name, seedRelative: `${entry.name}/seeds/${seed.name}` });
        } catch {
          // 坏 JSON 不算系统
        }
      }
    }
  }
  return systems;
}

const TABLE_HEADER = /^\| 设计系统 \| 定位 \| 版本 \|$/m;

/** 根 README 的系统表格：已有该 id 的行则替换版本，没有则在表格末尾追加一行；没有表格返回 { changed: false, reason }。 */
/** 行已存在时默认只更新版本（定位那一句可能被人改过）；replaceDescription = true（用户显式传了 --description）才整行重写。 */
export function upsertReadmeRow(readmeText, { description, id, name, replaceDescription = false, version }) {
  const headerMatch = readmeText.match(TABLE_HEADER);
  if (!headerMatch) {
    return { changed: false, reason: "根 README 没有「| 设计系统 | 定位 | 版本 |」表格", text: readmeText };
  }
  const lines = readmeText.split("\n");
  const headerIndex = lines.findIndex((line) => TABLE_HEADER.test(line));
  let end = headerIndex + 1;
  while (end < lines.length && lines[end].startsWith("|")) {
    end += 1;
  }
  const rowIndex = lines.findIndex((line, index) => index > headerIndex && index < end && line.includes(`](${id}/)`));
  const row = `| [**${name}**](${id}/) | ${description} | ${version} |`;
  if (rowIndex >= 0) {
    if (lines[rowIndex] === row) {
      return { changed: false, reason: "行已存在且一致", text: readmeText };
    }
    if (replaceDescription) {
      lines[rowIndex] = row;
      return { changed: true, reason: "更新定位与版本", text: lines.join("\n") };
    }
    lines[rowIndex] = lines[rowIndex].replace(/\| \d+\.\d+\.\d+ \|\s*$/, `| ${version} |`);
    return { changed: true, reason: "更新版本", text: lines.join("\n") };
  }
  lines.splice(end, 0, row);
  return { changed: true, reason: "追加一行", text: lines.join("\n") };
}

/** 根 README 表格里某个系统的版本；没有该行返回 null。 */
export function readmeRowVersion(readmeText, id) {
  const line = readmeText.split("\n").find((candidate) => candidate.startsWith("|") && candidate.includes(`](${id}/)`));
  return line?.match(/\| (\d+\.\d+\.\d+) \|\s*$/)?.[1] ?? null;
}

export function isDirectory(target) {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

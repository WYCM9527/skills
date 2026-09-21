// 定位 design-system-steward（校验 / 构建 / Guard 都靠它）。查找顺序与 design-system-adopter 一致，再加一处「本 skill 的兄弟目录」：
// 环境变量 DESIGN_SYSTEM_STEWARD → 项目内 skills 目录 → 祖先目录的 skills/ → 与本 skill 并列的 design-system-steward（同仓库 / 同一 skills 目录）→ 个人 skills 目录；多份取版本最高。
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siblingSteward = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "design-system-steward");

const readVersion = (dir) => {
  try {
    return (readFileSync(path.join(dir, "SKILL.md"), "utf8").match(/^\s*version:\s*"?([\d.]+)"?/m) || [])[1] || "0.0.0";
  } catch {
    return "0.0.0";
  }
};

const compareVersions = (left, right) => {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta) {
      return delta;
    }
  }
  return 0;
};

export const MIN_STEWARD = "0.6.0";

export function locateSteward(projectRoot) {
  const fromEnv = process.env.DESIGN_SYSTEM_STEWARD;
  if (fromEnv && existsSync(path.join(fromEnv, "scripts", "build-tokens.mjs"))) {
    return { dir: fromEnv, version: readVersion(fromEnv) };
  }
  const home = homedir();
  const candidates = [
    path.join(projectRoot, ".cursor/skills/design-system-steward"),
    path.join(projectRoot, ".claude/skills/design-system-steward"),
    path.join(projectRoot, "skills/design-system-steward")
  ];
  let cursor = path.resolve(projectRoot);
  for (let index = 0; index < 6; index += 1) {
    candidates.push(path.join(cursor, "skills/design-system-steward"));
    cursor = path.resolve(cursor, "..");
  }
  candidates.push(
    siblingSteward,
    path.join(home, ".cursor/skills/design-system-steward"),
    path.join(home, ".codex/skills/design-system-steward"),
    path.join(home, ".claude/skills/design-system-steward")
  );
  const found = [...new Set(candidates)]
    .filter((candidate) => existsSync(path.join(candidate, "scripts", "build-tokens.mjs")))
    .map((dir, index) => ({ dir, index, version: readVersion(dir) }));
  if (found.length === 0) {
    return null;
  }
  found.sort((left, right) => compareVersions(right.version, left.version) || left.index - right.index);
  return { dir: found[0].dir, version: found[0].version, tooOld: compareVersions(found[0].version, MIN_STEWARD) < 0 };
}

/** 打印给用户 / Agent 的三条命令；找不到 steward 时给安装提示。projectRoot 是含 design-system/ 的目录。 */
export function stewardCommands(projectRoot, steward) {
  if (!steward) {
    return [
      `未找到 design-system-steward。安装：node <design-system-adopter>/scripts/ds.mjs steward install --project "${projectRoot}"`,
      "或克隆 https://github.com/WYCM9527/skills 后用环境变量 DESIGN_SYSTEM_STEWARD 指向 design-system-steward 目录。"
    ];
  }
  const scripts = path.join(steward.dir, "scripts");
  return [
    `node "${path.join(scripts, "validate-system.mjs")}" --project "${projectRoot}"`,
    `(cd "${projectRoot}" && npm i -D --no-save style-dictionary@5.5.2)   # 首次构建前；已装可跳过`,
    `node "${path.join(scripts, "build-tokens.mjs")}" --project "${projectRoot}"`,
    `node "${path.join(scripts, "guard.mjs")}" --project "${projectRoot}"   # 应为 current`
  ];
}

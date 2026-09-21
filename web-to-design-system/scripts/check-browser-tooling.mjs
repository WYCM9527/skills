#!/usr/bin/env node
// 预检：node / npm / agent-browser 是否可用，以及 steward 在哪。只打印 JSON，不安装任何东西。
// 用法：node check-browser-tooling.mjs [项目目录]

import path from "node:path";
import { spawnSync } from "node:child_process";

import { locateSteward } from "./lib/steward.mjs";

const targetCwd = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return { ok: result.status === 0, stdout: (result.stdout || "").trim() };
}

function which(binary) {
  const result = run("bash", ["-lc", `command -v ${binary}`]);
  return result.ok && result.stdout ? result.stdout.split("\n")[0].trim() : null;
}

const nodePath = which("node");
const npmPath = which("npm");
const agentBrowserPath = which("agent-browser");
const steward = locateSteward(targetCwd);

const result = {
  agentBrowser: {
    available: Boolean(agentBrowserPath),
    helpPreview: agentBrowserPath ? run(agentBrowserPath, ["--help"]).stdout.split(/\r?\n/).find(Boolean) ?? null : null,
    path: agentBrowserPath
  },
  cwd: targetCwd,
  node: { available: Boolean(nodePath), path: nodePath, version: nodePath ? run(nodePath, ["-v"]).stdout : null },
  npm: { available: Boolean(npmPath), path: npmPath, version: npmPath ? run(npmPath, ["-v"]).stdout : null },
  steward: steward ? { dir: steward.dir, tooOld: Boolean(steward.tooOld), version: steward.version } : null,
  nextSteps: [
    ...(agentBrowserPath ? [] : ["安装或暴露 agent-browser 到 PATH，`agent-browser --help` 能跑后再取证；不要改用静态抓取。"]),
    ...(steward ? (steward.tooOld ? ["steward 版本低于 0.6.0：`node <adopter>/scripts/ds.mjs steward install` 或在原位置 git pull。"] : []) : ["未找到 design-system-steward：校验 / 构建 / Guard 需要它，`node <adopter>/scripts/ds.mjs steward install --project <项目>`。"]),
    ...(agentBrowserPath ? ["node scripts/extract-evidence.mjs <url> [<url> …]"] : [])
  ]
};

console.log(JSON.stringify(result, null, 2));

// 桥接复用：角色名与 Citrine 对齐后，Citrine 的 bridge/（Element Plus / shadcn / recipes / ECharts / IconPark / 配方组件）可以拷进新种子当起点；
// 这里负责拷贝、把对应的 stacks / export.optional 搬进身份文件，以及扫出「桥接引用了、本系统却没定义」的 CSS 变量——那就是接入前必须补的 token 或必须删的规则。
import { cpSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const CODE_EXTENSIONS = new Set([".css", ".js", ".mjs", ".ts", ".tsx", ".vue", ".jsx"]);
/** 组件库 / 工具链自己的变量前缀：桥接会给它们赋值，不是本系统要提供的 token。 */
const LIBRARY_PREFIXES = ["el-", "tw-", "radix-", "reka-", "ant-", "sh-", "vp-", "ks-"];

export function walkCode(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") visit(absolute);
      } else if (CODE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(absolute);
      }
    }
  };
  if (existsSync(root)) visit(root);
  return files.sort();
}

/** 扫描目录：referenced = var(--x) / '--x' 读取；defined = `--x:` 声明与 setProperty('--x'。 */
export function scanBridgeVariables(root) {
  const referenced = new Map();
  const defined = new Set();
  for (const file of walkCode(root)) {
    const text = readFileSync(file, "utf8");
    const relative = path.relative(root, file);
    for (const match of text.matchAll(/var\(\s*--([a-zA-Z0-9_-]+)/g)) {
      const name = match[1];
      referenced.set(name, (referenced.get(name) ?? new Set()).add(relative));
    }
    for (const match of text.matchAll(/["'`]--([a-zA-Z0-9_-]+)["'`]/g)) {
      const name = match[1];
      referenced.set(name, (referenced.get(name) ?? new Set()).add(relative));
    }
    for (const match of text.matchAll(/(?:^|[\s;{])--([a-zA-Z0-9_-]+)\s*:/gm)) {
      defined.add(match[1]);
    }
    for (const match of text.matchAll(/setProperty\(\s*["'`]--([a-zA-Z0-9_-]+)["'`]/g)) {
      defined.add(match[1]);
    }
  }
  return { defined, referenced };
}

/** 桥接引用但本系统没定义、桥接自己也没定义、又不是组件库前缀的变量名 → [{ name, files }] 按引用文件数降序。 */
export function missingBridgeVariables(systemVariables, scan) {
  const missing = [];
  for (const [name, files] of scan.referenced) {
    if (systemVariables.has(name) || scan.defined.has(name)) continue;
    if (LIBRARY_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    missing.push({ files: [...files].sort(), name });
  }
  return missing.sort((left, right) => right.files.length - left.files.length || left.name.localeCompare(right.name));
}

/**
 * 把来源种子（通常是 Citrine）的 bridge/ 拷进目标种子；不覆盖目标已有文件（base.css 是本 skill 自己的）。
 * 返回 { copied, stacks, exportOptional, sourceIdentity }：stacks 取来源身份文件里除 css 之外的栈，路径都是相对包根、两边一致，可直接并入。
 */
export function copyBridges(sourceSeedDir, targetRoot) {
  const sourceBridge = path.join(sourceSeedDir, "bridge");
  if (!existsSync(sourceBridge) || !statSync(sourceBridge).isDirectory()) {
    throw new Error(`${sourceSeedDir} 里没有 bridge/ 目录`);
  }
  const identityPath = path.join(sourceSeedDir, "design-system.json");
  const sourceIdentity = existsSync(identityPath) ? JSON.parse(readFileSync(identityPath, "utf8")) : null;
  const copied = [];
  const targetBridge = path.join(targetRoot, "bridge");
  cpSync(sourceBridge, targetBridge, {
    filter: (source) => {
      const relative = path.relative(sourceBridge, source);
      if (relative.split(path.sep).includes("node_modules")) return false;
      const destination = path.join(targetBridge, relative);
      if (relative && existsSync(destination) && statSync(destination).isFile()) return false; // 不覆盖目标已有文件
      if (relative && statSync(source).isFile()) copied.push(`bridge/${relative.split(path.sep).join("/")}`);
      return true;
    },
    recursive: true
  });
  const stacks = {};
  for (const [stackId, stack] of Object.entries(sourceIdentity?.stacks ?? {})) {
    if (stackId === "css") continue;
    // snippet / notes / kitchen 指向 templates/*，由本 skill 自己的通用模板提供；entry / extra / components / scaffold / detect 直接沿用
    stacks[stackId] = {
      ...stack,
      notes: `templates/notes-${stackId}.md`,
      snippet: `templates/entry-${stackId}.css`
    };
    if (stack.kitchen && !existsSync(path.join(targetRoot, stack.kitchen))) delete stacks[stackId].kitchen;
  }
  return { copied, exportOptional: sourceIdentity?.export?.optional ?? {}, sourceIdentity, stacks };
}

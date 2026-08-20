import { stat } from "node:fs/promises";
import path from "node:path";

import {
  fileExists,
  parseArgs,
  printJson,
  readJson,
  readTextIfSmall,
  relativePosix,
  reportError,
  requireDirectory,
  requireStringOption
} from "./lib.mjs";
import {
  extractVisualCandidates,
  isUiStyleFile,
  matchingProjectGlob,
  resolveExistingProjectFile
} from "./governance-lib.mjs";

const ID = /^[a-z][a-z0-9-]*$/;
const CONTENT_REQUEST = /\b(?:copy|content|text|wording|data)\b|文案|文字|内容|图片|图像|数据/i;
const PROPOSAL_REQUEST = /(?:\b(?:add|create|introduce|define|extend|revise)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:design\s*system|design\s*token|token|semantic|primitive|component\s*token|scope|theme)\b|\b(?:cross-page|system-level)\b|(?:新增|新建|添加|创建|定义|扩展|跨页面|跨页|系统级).{0,24}(?:设计系统|设计令牌|token|语义|原子|组件令牌|局部规范|主题)|(?:设计系统|设计令牌|token|语义|原子|组件令牌|局部规范|主题).{0,24}(?:新增|新建|添加|创建|定义|扩展|修订)|(?:修改|调整|修订|替换).{0,24}(?:设计系统|设计令牌|token|语义|原子|组件令牌|局部规范|主题))/i;
const LITERAL_REQUEST = /#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|%|vw|vh)\b|颜色|间距|圆角|字体|字号|字重|阴影|color|spacing|radius|font(?:\s|-)?size|shadow/i;

function validSourceGlob(value) {
  return typeof value === "string"
    && value.trim()
    && !path.isAbsolute(value)
    && !value.includes("\\")
    && !value.split("/").includes("..");
}

async function readScopeContext(systemRoot) {
  const mapPath = path.join(systemRoot, "scope-map.json");
  if (!(await fileExists(mapPath))) {
    return { byId: new Map(), state: "absent" };
  }
  try {
    const map = await readJson(mapPath);
    if (!map || typeof map !== "object" || Array.isArray(map) || map.version !== 1 || !Array.isArray(map.scopes)) {
      return { byId: new Map(), state: "invalid" };
    }
    const byId = new Map();
    for (const scope of map.scopes) {
      if (!scope || typeof scope !== "object" || Array.isArray(scope) || typeof scope.id !== "string" || !ID.test(scope.id) || byId.has(scope.id)) {
        return { byId: new Map(), state: "invalid" };
      }
      const sourceGlobs = Array.isArray(scope.appliesTo?.sourceGlobs)
        ? scope.appliesTo.sourceGlobs.filter(validSourceGlob)
        : [];
      const suppliedSourceGlobs = Array.isArray(scope.appliesTo?.sourceGlobs) ? scope.appliesTo.sourceGlobs : [];
      if (sourceGlobs.length !== suppliedSourceGlobs.length) {
        return { byId: new Map(), state: "invalid" };
      }
      byId.set(scope.id, {
        id: scope.id,
        parent: typeof scope.parent === "string" ? scope.parent : null,
        sourceGlobs,
        status: scope.status ?? "active"
      });
    }
    for (const scope of byId.values()) {
      if (scope.parent !== "core" && !byId.has(scope.parent)) {
        return { byId: new Map(), state: "invalid" };
      }
      const seen = new Set();
      let current = scope;
      while (current.parent !== "core") {
        if (seen.has(current.id)) {
          return { byId: new Map(), state: "invalid" };
        }
        seen.add(current.id);
        current = byId.get(current.parent);
      }
    }
    return { byId, state: "present" };
  } catch {
    return { byId: new Map(), state: "invalid" };
  }
}

function scopeDepth(scope, byId, seen = new Set()) {
  if (!scope || scope.parent === "core") {
    return 1;
  }
  if (!byId.has(scope.parent) || seen.has(scope.id)) {
    return 0;
  }
  return 1 + scopeDepth(byId.get(scope.parent), byId, new Set([...seen, scope.id]));
}

function scopeMatches(relative, byId) {
  return [...byId.values()]
    .map((scope) => ({
      ...scope,
      matchedSourceGlob: matchingProjectGlob(relative, scope.sourceGlobs)
    }))
    .filter((scope) => scope.matchedSourceGlob)
    .sort((left, right) => scopeDepth(right, byId) - scopeDepth(left, byId) || left.id.localeCompare(right.id));
}

function selectScope(options, relative, context) {
  const requested = options.scope === undefined ? null : requireStringOption(options, "scope");
  if (requested === "core") {
    return {
      issue: null,
      matches: [],
      requested,
      resolved: { id: "core", selection: "explicit", status: "active" }
    };
  }
  if (requested !== null) {
    const scope = context.byId.get(requested);
    if (!scope) {
      return { issue: `Scope is not registered: ${requested}`, matches: [], requested, resolved: null };
    }
    const matchedSourceGlob = matchingProjectGlob(relative, scope.sourceGlobs);
    if (scope.sourceGlobs.length > 0 && !matchedSourceGlob) {
      return {
        issue: `Target is outside the registered sourceGlobs for Scope ${requested}`,
        matches: [],
        requested,
        resolved: null
      };
    }
    if (scope.sourceGlobs.length === 0) {
      return {
        issue: `Scope ${requested} has no sourceGlobs, so the target boundary cannot be checked statically`,
        matches: [],
        requested,
        resolved: null
      };
    }
    return {
      issue: scope.status === "reference-only" ? `Scope ${requested} is reference-only` : null,
      matches: [],
      requested,
      resolved: { id: scope.id, matchedSourceGlob, selection: "explicit", status: scope.status }
    };
  }

  if (context.state !== "present") {
    return {
      issue: context.state === "invalid" ? "scope-map.json is invalid" : null,
      matches: [],
      requested: null,
      resolved: { id: "core", selection: "no-scope-map", status: "active" }
    };
  }
  const matches = scopeMatches(relative, context.byId);
  if (matches.length === 0) {
    return {
      issue: null,
      matches: [],
      requested: null,
      resolved: { id: "core", selection: "no-boundary-match", status: "active" }
    };
  }
  const deepest = matches[0];
  const tied = matches.filter((scope) => scopeDepth(scope, context.byId) === scopeDepth(deepest, context.byId));
  if (tied.length > 1) {
    return {
      issue: `Target matches multiple equally specific Scope boundaries: ${tied.map((scope) => scope.id).join(", ")}`,
      matches: matches.map((scope) => ({ id: scope.id, matchedSourceGlob: scope.matchedSourceGlob })),
      requested: null,
      resolved: null
    };
  }
  return {
    issue: deepest.status === "reference-only" ? `Scope ${deepest.id} is reference-only` : null,
    matches: matches.map((scope) => ({ id: scope.id, matchedSourceGlob: scope.matchedSourceGlob })),
    requested: null,
    resolved: {
      id: deepest.id,
      matchedSourceGlob: deepest.matchedSourceGlob,
      selection: "deepest-static-boundary-match",
      status: deepest.status
    }
  };
}

async function readThemeContext(systemRoot) {
  const mapPath = path.join(systemRoot, "theme-map.json");
  if (!(await fileExists(mapPath))) {
    return { defaultTheme: null, themes: new Map(), state: "absent" };
  }
  try {
    const map = await readJson(mapPath);
    if (!map || typeof map !== "object" || Array.isArray(map) || map.version !== 1 || !ID.test(map.defaultTheme) || !Array.isArray(map.themes)) {
      return { defaultTheme: null, themes: new Map(), state: "invalid" };
    }
    if (!map.activation || typeof map.activation !== "object" || Array.isArray(map.activation)
      || !["data-attribute", "class", "media"].includes(map.activation.kind)) {
      return { defaultTheme: null, themes: new Map(), state: "invalid" };
    }
    if (map.activation.kind === "data-attribute"
      && (typeof map.activation.attribute !== "string" || !/^data-[a-z][a-z0-9-]*$/.test(map.activation.attribute))) {
      return { defaultTheme: null, themes: new Map(), state: "invalid" };
    }
    const themes = new Map([[map.defaultTheme, { id: map.defaultTheme, status: "active" }]]);
    for (const theme of map.themes) {
      if (!theme || typeof theme !== "object" || Array.isArray(theme) || typeof theme.id !== "string" || !ID.test(theme.id)
        || themes.has(theme.id) || !["active", "reference-only"].includes(theme.status ?? "active")) {
        return { defaultTheme: null, themes: new Map(), state: "invalid" };
      }
      themes.set(theme.id, { id: theme.id, status: theme.status ?? "active" });
    }
    return { defaultTheme: map.defaultTheme, themes, state: "present" };
  } catch {
    return { defaultTheme: null, themes: new Map(), state: "invalid" };
  }
}

async function isDirectory(value) {
  try {
    return (await stat(value)).isDirectory();
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function markerThemeIds(markers) {
  return [...new Set(markers
    .map((marker) => marker.startsWith("class:") ? marker.slice("class:".length) : marker)
    .filter((marker) => ID.test(marker)))]
    .sort((left, right) => left.localeCompare(right));
}

function selectTheme(options, context, markers) {
  const requested = options.theme === undefined ? null : requireStringOption(options, "theme");
  if (requested === null) {
    const targetThemes = markerThemeIds(markers).filter((id) => context.themes.has(id));
    const unknownMarkers = markerThemeIds(markers).filter((id) => context.state === "present" && !context.themes.has(id));
    if (unknownMarkers.length > 0) {
      return {
        issue: `Target contains unregistered Theme marker(s): ${unknownMarkers.join(", ")}`,
        requested: null,
        resolved: null
      };
    }
    if (targetThemes.length === 1) {
      const theme = context.themes.get(targetThemes[0]);
      return {
        issue: theme.status === "reference-only" ? `Theme ${theme.id} is reference-only` : null,
        requested: null,
        resolved: { id: theme.id, selection: "target-marker", status: theme.status }
      };
    }
    if (targetThemes.length > 1) {
      return {
        issue: `Target contains multiple Theme markers: ${targetThemes.join(", ")}`,
        requested: null,
        resolved: null
      };
    }
    return {
      issue: context.state === "invalid" ? "theme-map.json is invalid" : null,
      requested: null,
      resolved: context.defaultTheme ? { id: context.defaultTheme, selection: "registered-default", status: "active" } : null
    };
  }
  if (context.state !== "present" || !context.themes.has(requested)) {
    return {
      issue: context.state === "absent"
        ? `Theme ${requested} is not registered because theme-map.json is absent`
        : context.state === "invalid"
          ? "theme-map.json is invalid"
          : `Theme is not registered: ${requested}`,
      requested,
      resolved: null
    };
  }
  const theme = context.themes.get(requested);
  return {
    issue: theme.status === "reference-only" ? `Theme ${theme.id} is reference-only` : null,
    requested,
    resolved: { id: theme.id, selection: "explicit", status: theme.status }
  };
}

function targetRole(relative) {
  if (relative.startsWith("design-system/dist/")) {
    return "generated-output";
  }
  if (relative.startsWith("design-system/tokens/")) {
    return "core-token-source";
  }
  if (relative.startsWith("design-system/scopes/")) {
    return "scope-source";
  }
  if (relative.startsWith("design-system/themes/")) {
    return "theme-source";
  }
  if (relative === "design-system/DESIGN.md" || relative === "design-system/AUDIT.md" || relative === "design-system/TRY.md") {
    return "design-system-document";
  }
  return "project-source";
}

function requestSignals(request) {
  if (!request) {
    return { content: false, literal: false, proposal: false };
  }
  return {
    content: CONTENT_REQUEST.test(request),
    literal: LITERAL_REQUEST.test(request),
    proposal: PROPOSAL_REQUEST.test(request)
  };
}

function hasLiteralCandidates(candidates) {
  return candidates.colors.length > 0 || candidates.spacing.length > 0 || candidates.typography.length > 0;
}

function nextAction(classification, reasons, context) {
  if (classification === "content") {
    return "只更新内容；若实施中出现新的可复用视觉决定，再重新提出设计系统提案。";
  }
  if (classification === "consume") {
    const scope = context.scope.resolved?.id ?? "core";
    const theme = context.theme.resolved?.id ? `，Theme 为 ${context.theme.resolved.id}` : "";
    return `先阅读 design-system/DESIGN.md，并在 Scope ${scope}${theme} 的已管理决定中复用现有值；不要手改 design-system/dist/。`;
  }
  if (classification === "drift") {
    return "把这些字面量视为 Drift 候选，不推断其语义；请先确认它是一次性差异、应复用的现有决定，还是需要用户批准的新规范。";
  }
  return `${reasons[0] ?? "该变更需要设计系统决策"}。先提出简短提案并等待确认；确认后先改设计系统源、构建并运行 Guard，再改页面。`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = await requireDirectory(requireStringOption(options, "project"), "--project");
  const targetPath = await resolveExistingProjectFile(projectRoot, requireStringOption(options, "target"), "--target");
  const relativeTarget = relativePosix(projectRoot, targetPath);
  const text = await readTextIfSmall(targetPath);
  if (text === null) {
    throw new Error(`--target is too large to inspect safely: ${relativeTarget}`);
  }

  const systemRoot = path.join(projectRoot, "design-system");
  const designSystemPresent = await isDirectory(systemRoot);
  const scopeContext = await readScopeContext(systemRoot);
  const themeContext = await readThemeContext(systemRoot);
  const scope = selectScope(options, relativeTarget, scopeContext);
  const role = targetRole(relativeTarget);
  const uiStyleFile = isUiStyleFile(targetPath);
  const candidates = extractVisualCandidates(text);
  const theme = selectTheme(options, themeContext, candidates.themeMarkers);
  const signals = requestSignals(typeof options.request === "string" ? options.request : "");
  const reasons = [];
  const contentOnly = role === "project-source"
    && (!uiStyleFile || (signals.content && !signals.literal && !signals.proposal));

  if (!contentOnly) {
    if (!designSystemPresent && (uiStyleFile || options.scope !== undefined || options.theme !== undefined || signals.proposal)) {
      reasons.push("项目尚未建立 design-system/");
    }
    if (scope.issue) {
      reasons.push(scope.issue);
    }
    if (theme.issue) {
      reasons.push(theme.issue);
    }
    if (role === "generated-output") {
      reasons.push("design-system/dist/ 是生成物，不能直接修改");
    }
    if (["core-token-source", "scope-source", "theme-source", "design-system-document"].includes(role)) {
      reasons.push("目标是设计系统源，需要先确认提案和影响范围");
    }
    if (signals.proposal) {
      reasons.push("请求明确涉及可复用或系统级设计决定");
    }
  }

  let classification;
  if (reasons.length > 0) {
    classification = "needs-proposal";
  } else if (contentOnly) {
    classification = "content";
  } else if (signals.literal || hasLiteralCandidates(candidates)) {
    classification = "drift";
  } else {
    classification = "consume";
  }

  printJson({
    classification,
    context: {
      designSystem: designSystemPresent ? "present" : "absent",
      scope: {
        matches: scope.matches,
        requested: scope.requested,
        resolved: scope.resolved,
        state: scopeContext.state
      },
      theme: {
        requested: theme.requested,
        resolved: theme.resolved,
        state: themeContext.state
      }
    },
    evidence: {
      candidateVisualLiterals: {
        colors: candidates.colors,
        spacing: candidates.spacing,
        typography: candidates.typography
      },
      markers: {
        scopes: candidates.scopeMarkers,
        themes: candidates.themeMarkers,
        usesManagedCssVariables: candidates.usesManagedCssVariables
      },
      requestProvided: typeof options.request === "string",
      requestSignals: signals,
      target: relativeTarget,
      targetRole: role,
      uiStyleFile
    },
    evidenceLimit: "字面量、文件边界和请求词只用于发现候选；本工具不会推断 Token 的语义或自动建立规范。",
    nextAction: nextAction(classification, reasons, { scope, theme }),
    reasons,
    status: classification,
    writes: false
  });
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

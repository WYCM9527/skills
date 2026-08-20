import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..");
const legacyStyleDictionaryConfig = [
  'import path from "node:path";',
  'import { fileURLToPath } from "node:url";',
  "",
  "const root = path.dirname(fileURLToPath(import.meta.url));",
  "const outputRoot = process.env.DS_OUTPUT_DIR",
  "  ? path.resolve(process.env.DS_OUTPUT_DIR)",
  '  : path.join(root, "dist");',
  "",
  "export default {",
  '  source: [path.join(root, "tokens/**/*.tokens.json")],',
  "  platforms: {",
  "    css: {",
  '      transformGroup: "css",',
  '      buildPath: `${outputRoot}${path.sep}`,',
  "      files: [",
  "        {",
  '          destination: "tokens.css",',
  '          format: "css/variables",',
  "          options: {",
  "            outputReferences: true,",
  "            showFileHeader: false",
  "          }",
  "        }",
  "      ]",
  "    }",
  "  }",
  "};",
  ""
].join("\n");

function run(script, argumentsList) {
  return spawnSync(process.execPath, [path.join(skillRoot, "scripts", script), ...argumentsList], {
    encoding: "utf8"
  });
}

function jsonOutput(result) {
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout);
}

function jsonFailure(result) {
  assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout);
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function createProject() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "design-system-steward-scope-"));
  await writeFile(path.join(projectRoot, "package.json"), '{"name":"scope-fixture","private":true}\n');
  return projectRoot;
}

async function createStyleDictionaryLinks(projectRoot) {
  const sourceNodeModules = path.join(skillRoot, "node_modules");
  assert.equal(existsSync(path.join(sourceNodeModules, "style-dictionary")), true, "run npm install before the test suite");
  await mkdir(path.join(projectRoot, "node_modules", ".bin"), { recursive: true });
  await symlink(
    path.join(sourceNodeModules, "style-dictionary"),
    path.join(projectRoot, "node_modules", "style-dictionary"),
    "dir"
  );
  await symlink(
    path.join(sourceNodeModules, ".bin", "style-dictionary"),
    path.join(projectRoot, "node_modules", ".bin", "style-dictionary")
  );
}

async function bootstrap(projectRoot) {
  assert.equal(
    run("bootstrap.mjs", ["--project", projectRoot, "--source", "css-variables"]).status,
    0
  );
}

async function scaffoldScope(projectRoot, values) {
  return run("scaffold-scope.mjs", [
    "--project", projectRoot,
    "--scope", values.id,
    "--kind", values.kind,
    "--parent", values.parent,
    "--reason", values.reason,
    ...(values.routes ? ["--routes", values.routes] : []),
    ...(values.sourceGlobs ? ["--source-globs", values.sourceGlobs] : []),
    ...(values.status ? ["--status", values.status] : [])
  ]);
}

function coreTokens() {
  return {
    primitives: {
      color: {
        $type: "color",
        brand: {
          blue: {
            $value: {
              colorSpace: "srgb",
              components: [0.145, 0.388, 0.922],
              alpha: 1
            }
          }
        },
        white: {
          $value: {
            colorSpace: "srgb",
            components: [1, 1, 1],
            alpha: 1
          }
        }
      },
      curve: {
        $type: "cubicBezier",
        standard: { $value: [0.2, 0, 0, 1] }
      },
      motion: {
        $type: "duration",
        fast: { $value: { value: 120, unit: "ms" } }
      },
      space: {
        $type: "dimension",
        "4": { $value: { value: 16, unit: "px" } }
      }
    },
    semantic: {
      color: {
        $type: "color",
        action: {
          primary: { $value: "{color.brand.blue}" },
          "on-primary": { $value: "{color.white}" }
        }
      },
      curve: {
        $type: "cubicBezier",
        motion: {
          standard: { $value: "{curve.standard}" }
        }
      },
      motion: {
        $type: "duration",
        action: {
          fast: { $value: "{motion.fast}" }
        }
      },
      space: {
        $type: "dimension",
        layout: { $value: "{space.4}" }
      }
    }
  };
}

async function writeApprovedCoreTokens(projectRoot) {
  const tokens = coreTokens();
  await writeJson(path.join(projectRoot, "design-system", "tokens", "primitives.tokens.json"), tokens.primitives);
  await writeJson(path.join(projectRoot, "design-system", "tokens", "semantic.tokens.json"), tokens.semantic);
}

test("audit reports grouped local-design candidates without writing project files", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  const page = path.join(projectRoot, "src", "showcase", "page.tsx");
  await mkdir(path.dirname(page), { recursive: true });
  await writeFile(page, `
    export const showcase = {
      style: "--showcase-ink: #111111; --showcase-brand: #f97316; padding: 16px; gap: 24px;"
    };
  `);
  const before = await readFile(page, "utf8");

  const report = jsonOutput(run("audit.mjs", ["--project", projectRoot]));
  const candidate = report.scopeCandidates.find((item) => item.id === "showcase");

  assert.equal(report.writes, false);
  assert.ok(candidate, JSON.stringify(report.scopeCandidates));
  assert.equal(candidate.requiresConfirmation, true);
  assert.equal(candidate.appliesTo.sourceGlobs.includes("src/showcase/**"), true);
  assert.equal(candidate.evidence.groupedSignals.length >= 2, true);
  assert.equal(await readFile(page, "utf8"), before);
  assert.equal(existsSync(path.join(projectRoot, "design-system")), false);
});

test("audit derives a nested page candidate only from grouped visual evidence", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  const caseStudyPage = path.join(projectRoot, "src", "showcase", "case-study", "page.tsx");
  const oneOffPage = path.join(projectRoot, "src", "showcase", "one-off", "page.tsx");
  await Promise.all([caseStudyPage, oneOffPage].map((file) => mkdir(path.dirname(file), { recursive: true })));
  await writeFile(caseStudyPage, `
    export const route = "/showcase/case-study";
    export const caseStudyStyle = "--case-study-ink: #111111; --case-study-action: #f97316; padding: 16px; gap: 24px;";
  `);
  await writeFile(oneOffPage, `
    export const route = "/showcase/one-off";
    export const oneOffStyle = "color: #ff0000;";
  `);

  const report = jsonOutput(run("audit.mjs", ["--project", projectRoot]));
  const caseStudy = report.scopeCandidates.find((candidate) => candidate.id === "case-study");

  assert.ok(caseStudy, JSON.stringify(report.scopeCandidates));
  assert.equal(caseStudy.kind, "page");
  assert.equal(caseStudy.suggestedParent, "showcase");
  assert.deepEqual(caseStudy.appliesTo.routes, ["/showcase/case-study"]);
  assert.equal(caseStudy.appliesTo.sourceGlobs.includes("src/showcase/case-study/**"), true);
  assert.equal(report.scopeCandidates.some((candidate) => candidate.id === "one-off"), false);
});

test("Core and nested scopes build delta CSS, guard it, and plan a read-only integration", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  const showcasePage = path.join(projectRoot, "src", "showcase", "page.tsx");
  const caseStudyPage = path.join(projectRoot, "src", "showcase", "case-study", "page.tsx");
  const editorialPage = path.join(projectRoot, "src", "editorial", "page.tsx");
  const emptyPage = path.join(projectRoot, "src", "empty-page", "page.tsx");
  await Promise.all([showcasePage, caseStudyPage, editorialPage, emptyPage].map((file) => mkdir(path.dirname(file), { recursive: true })));
  await Promise.all([
    writeFile(showcasePage, "export default function Showcase() { return <main />; }\n"),
    writeFile(caseStudyPage, "export default function CaseStudy() { return <main />; }\n"),
    writeFile(editorialPage, "export default function Editorial() { return <main />; }\n"),
    writeFile(emptyPage, "export default function EmptyPage() { return <main />; }\n")
  ]);
  const caseStudyBefore = await readFile(caseStudyPage, "utf8");

  await bootstrap(projectRoot);
  const showcase = jsonOutput(await scaffoldScope(projectRoot, {
    id: "showcase",
    kind: "section",
    parent: "core",
    reason: "Showcase has an editorial visual language.",
    routes: "/showcase/**",
    sourceGlobs: "src/showcase/**"
  }));
  assert.equal(showcase.uiSourceChanged, false);
  const caseStudy = jsonOutput(await scaffoldScope(projectRoot, {
    id: "case-study",
    kind: "page",
    parent: "showcase",
    reason: "This case study has a distinct long-form hierarchy.",
    routes: "/showcase/case-study",
    sourceGlobs: "src/showcase/case-study/**"
  }));
  assert.equal(caseStudy.uiSourceChanged, false);
  jsonOutput(await scaffoldScope(projectRoot, {
    id: "editorial",
    kind: "section",
    parent: "core",
    reason: "Editorial is documentation-only for now.",
    routes: "/editorial/**",
    sourceGlobs: "src/editorial/**",
    status: "reference-only"
  }));
  jsonOutput(await scaffoldScope(projectRoot, {
    id: "empty-page",
    kind: "page",
    parent: "core",
    reason: "This page has a documented scope but no token delta yet.",
    routes: "/empty-page",
    sourceGlobs: "src/empty-page/**"
  }));
  assert.equal(await readFile(caseStudyPage, "utf8"), caseStudyBefore);

  await writeApprovedCoreTokens(projectRoot);
  await writeJson(path.join(projectRoot, "design-system", "scopes", "showcase", "tokens", "primitives.tokens.json"), {
    scope: {
      showcase: {
        color: {
          $type: "color",
          brand: {
            $value: {
              colorSpace: "srgb",
              components: [0.976, 0.451, 0.086],
              alpha: 1
            }
          }
        }
      }
    }
  });
  await writeJson(path.join(projectRoot, "design-system", "scopes", "showcase", "tokens", "semantic.tokens.json"), {
    color: {
      $type: "color",
      action: {
        primary: { $value: "{scope.showcase.color.brand}" }
      }
    }
  });
  await writeJson(path.join(projectRoot, "design-system", "scopes", "case-study", "tokens", "primitives.tokens.json"), {
    scope: {
      "case-study": {
        color: {
          $type: "color",
          brand: {
            $value: {
              colorSpace: "srgb",
              components: [0.063, 0.725, 0.506],
              alpha: 1
            }
          }
        }
      }
    }
  });
  await writeJson(path.join(projectRoot, "design-system", "scopes", "case-study", "tokens", "semantic.tokens.json"), {
    color: {
      $type: "color",
      action: {
        primary: { $value: "{scope.case-study.color.brand}" }
      }
    }
  });
  await createStyleDictionaryLinks(projectRoot);

  const validation = jsonOutput(run("validate-system.mjs", ["--project", projectRoot]));
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  assert.deepEqual(
    validation.scopes.find((scope) => scope.id === "case-study").chain,
    ["showcase", "case-study"]
  );

  const build = jsonOutput(run("build-tokens.mjs", ["--project", projectRoot]));
  assert.equal(build.valid, true);
  const dist = path.join(projectRoot, "design-system", "dist");
  const [coreCss, showcaseCss, caseStudyCss, indexCss] = await Promise.all([
    readFile(path.join(dist, "tokens.css"), "utf8"),
    readFile(path.join(dist, "scopes", "showcase.css"), "utf8"),
    readFile(path.join(dist, "scopes", "case-study.css"), "utf8"),
    readFile(path.join(dist, "index.css"), "utf8")
  ]);
  assert.equal(coreCss.includes("--color-action-primary: var(--color-brand-blue);"), true);
  assert.equal(coreCss.includes("--motion-fast: 120ms;"), true);
  assert.match(coreCss, /--curve-standard: cubic-bezier\(/);
  assert.equal(showcaseCss.includes('[data-ds-scope~="showcase"]'), true);
  assert.equal(showcaseCss.includes("--color-action-primary: var(--scope-showcase-color-brand);"), true);
  assert.equal(showcaseCss.includes("--color-brand-blue"), false);
  assert.equal(caseStudyCss.includes('[data-ds-scope~="showcase"][data-ds-scope~="case-study"]'), true);
  assert.equal(caseStudyCss.includes("--color-action-primary: var(--scope-case-study-color-brand);"), true);
  assert.equal(indexCss.indexOf(showcaseCss.trim()) < indexCss.indexOf(caseStudyCss.trim()), true);
  assert.equal(existsSync(path.join(dist, "scopes", "editorial.css")), false);
  assert.equal(existsSync(path.join(dist, "scopes", "empty-page.css")), false);

  const integration = jsonOutput(run("plan-integration.mjs", ["--project", projectRoot, "--scope", "case-study"]));
  assert.equal(integration.status, "ready-for-second-confirmation");
  assert.equal(integration.dataDsScope, 'data-ds-scope="showcase case-study"');
  assert.equal(integration.entry.relative, "src/showcase/case-study/page.tsx");
  assert.equal(integration.writes, false);
  assert.equal(await readFile(caseStudyPage, "utf8"), caseStudyBefore);

  assert.equal(run("guard.mjs", ["--project", projectRoot]).status, 0);
  await writeFile(path.join(dist, "scopes", "showcase.css"), `${showcaseCss}\n/* stale */\n`);
  const stale = run("guard.mjs", ["--project", projectRoot]);
  assert.equal(stale.status, 1);
  assert.equal(stale.stdout.includes("stale-generated-output"), true);
});

test("Scope scaffolding preserves customized build configuration and rejects sibling overlap", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  await mkdir(path.join(projectRoot, "src", "alpha"), { recursive: true });
  await mkdir(path.join(projectRoot, "src", "beta"), { recursive: true });
  await writeFile(path.join(projectRoot, "src", "alpha", "page.tsx"), "export default function Alpha() { return null; }\n");
  await writeFile(path.join(projectRoot, "src", "beta", "page.tsx"), "export default function Beta() { return null; }\n");
  await bootstrap(projectRoot);

  const configPath = path.join(projectRoot, "design-system", "style-dictionary.config.mjs");
  await writeFile(configPath, "export default { source: [] };\n");
  const customConfigAttempt = await scaffoldScope(projectRoot, {
    id: "alpha",
    kind: "section",
    parent: "core",
    reason: "Alpha is bounded.",
    sourceGlobs: "src/alpha/**"
  });
  assert.equal(customConfigAttempt.status, 2);
  assert.equal(existsSync(path.join(projectRoot, "design-system", "scopes", "alpha")), false);
  assert.equal((await readFile(configPath, "utf8")), "export default { source: [] };\n");

  await writeFile(configPath, legacyStyleDictionaryConfig);
  const upgraded = jsonOutput(await scaffoldScope(projectRoot, {
    id: "alpha",
    kind: "section",
    parent: "core",
    reason: "Alpha is bounded.",
    sourceGlobs: "src/alpha/**"
  }));
  assert.equal(upgraded.styleDictionaryConfigUpgraded, true);
  assert.equal((await readFile(configPath, "utf8")).includes("design-system-steward/scope-delta"), true);
  const overlap = await scaffoldScope(projectRoot, {
    id: "beta",
    kind: "section",
    parent: "core",
    reason: "Beta accidentally overlaps Alpha.",
    sourceGlobs: "src/alpha/**"
  });
  assert.equal(overlap.status, 2);
  assert.equal(overlap.stderr.includes("overlaps sibling alpha"), true);
  const map = JSON.parse(await readFile(path.join(projectRoot, "design-system", "scope-map.json"), "utf8"));
  assert.deepEqual(map.scopes.map((scope) => scope.id), ["alpha"]);
});

test("audit keeps themes separate and escalates only strongly evidenced independent-system candidates", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  const theme = path.join(projectRoot, "src", "theme.css");
  const portalRoot = path.join(projectRoot, "src", "brand-portal");
  await mkdir(portalRoot, { recursive: true });
  await writeFile(theme, ":root { --ink: #111111; } .dark { --ink: #ffffff; }\n");
  await writeFile(path.join(portalRoot, "DESIGN.md"), "# Brand Portal\\n\\n品牌视觉识别与独立设计契约。\n");
  await writeFile(path.join(portalRoot, "page.tsx"), `
    export const route = "/brand-portal";
    export function Button() {
      return <button style={{ color: "#111111", background: "#f97316", padding: "16px", margin: "24px" }} />;
    }
  `);

  const report = jsonOutput(run("audit.mjs", ["--project", projectRoot]));
  assert.equal(report.themeEvidence.includes("src/theme.css"), true);
  assert.equal(report.scopeCandidates.some((candidate) => candidate.id === "theme"), false);
  const independent = report.independentSystemCandidates.find((candidate) => candidate.id === "brand-portal");
  assert.ok(independent, JSON.stringify(report.independentSystemCandidates));
  assert.equal(independent.requiresConfirmation, true);
  assert.equal(independent.evidence.brand.includes("src/brand-portal/DESIGN.md"), true);
});

test("system validation blocks primitive overrides, sibling references, and parent cycles", async (context) => {
  const projectRoot = await createProject();
  context.after(() => rm(projectRoot, { force: true, recursive: true }));
  await bootstrap(projectRoot);
  await writeApprovedCoreTokens(projectRoot);
  const systemRoot = path.join(projectRoot, "design-system");
  const leftRoot = path.join(systemRoot, "scopes", "left");
  const rightRoot = path.join(systemRoot, "scopes", "right");
  await Promise.all([
    mkdir(path.join(leftRoot, "tokens"), { recursive: true }),
    mkdir(path.join(rightRoot, "tokens"), { recursive: true })
  ]);
  await writeJson(path.join(systemRoot, "scope-map.json"), {
    version: 1,
    scopes: [
      {
        id: "left",
        kind: "section",
        parent: "core",
        appliesTo: { sourceGlobs: ["src/left/**"] },
        reason: "Left scope."
      },
      {
        id: "right",
        kind: "section",
        parent: "core",
        appliesTo: { sourceGlobs: ["src/right/**"] },
        reason: "Right scope."
      }
    ]
  });
  await writeJson(path.join(rightRoot, "tokens", "primitives.tokens.json"), {
    scope: {
      right: {
        color: {
          $type: "color",
          brand: {
            $value: { colorSpace: "srgb", components: [0.2, 0.4, 0.6], alpha: 1 }
          }
        }
      }
    }
  });
  await writeJson(path.join(leftRoot, "tokens", "primitives.tokens.json"), {
    color: {
      $type: "color",
      illegal: {
        $value: { colorSpace: "srgb", components: [0.1, 0.2, 0.3], alpha: 1 }
      }
    }
  });
  await writeJson(path.join(leftRoot, "tokens", "semantic.tokens.json"), {
    color: {
      $type: "color",
      action: {
        primary: { $value: "{scope.right.color.brand}" }
      }
    }
  });

  const invalidDirections = jsonFailure(run("validate-system.mjs", ["--project", projectRoot]));
  const directionCodes = invalidDirections.issues.map((issue) => issue.code);
  assert.equal(directionCodes.includes("scope-primitive-namespace"), true);
  assert.equal(directionCodes.includes("scope-sibling-reference"), true);

  await writeJson(path.join(systemRoot, "scope-map.json"), {
    version: 1,
    scopes: [
      {
        id: "left",
        kind: "section",
        parent: "right",
        appliesTo: { sourceGlobs: ["src/left/**"] },
        reason: "Left scope."
      },
      {
        id: "right",
        kind: "section",
        parent: "left",
        appliesTo: { sourceGlobs: ["src/right/**"] },
        reason: "Right scope."
      }
    ]
  });
  const cycle = jsonFailure(run("validate-system.mjs", ["--project", projectRoot]));
  assert.equal(cycle.issues.some((issue) => issue.code === "scope-parent-cycle"), true);
});

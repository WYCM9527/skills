import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  fileExists,
  parseArgs,
  printJson,
  readJson,
  reportError,
  requireAbsolutePath,
  requireDirectory,
  requireStringOption,
  skillRoot,
  writeText
} from "./lib.mjs";

const scaffoldRoot = path.join(skillRoot, "assets", "scaffold");

async function copyScaffold(sourceName, destination) {
  await copyFile(path.join(scaffoldRoot, sourceName), destination);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = await requireDirectory(requireStringOption(options, "project"), "--project");
  const source = requireStringOption(options, "source");
  const systemRoot = path.join(projectRoot, "design-system");

  if (await fileExists(systemRoot)) {
    throw new Error(`Refusing to overwrite existing design-system directory: ${systemRoot}`);
  }

  let auditReport = null;
  let auditReportPath = "Not supplied";
  if (options["audit-report"]) {
    const reportPath = requireAbsolutePath(options["audit-report"], "--audit-report");
    auditReport = await readJson(reportPath);
    auditReportPath = reportPath;
  }

  await mkdir(path.join(systemRoot, "tokens"), { recursive: true });
  await mkdir(path.join(systemRoot, "dist"), { recursive: true });
  await copyScaffold("DESIGN.md", path.join(systemRoot, "DESIGN.md"));
  await copyScaffold("TRY.md", path.join(systemRoot, "TRY.md"));
  await copyScaffold("primitives.tokens.json", path.join(systemRoot, "tokens", "primitives.tokens.json"));
  await copyScaffold("semantic.tokens.json", path.join(systemRoot, "tokens", "semantic.tokens.json"));
  await copyScaffold("style-dictionary.config.mjs", path.join(systemRoot, "style-dictionary.config.mjs"));
  await writeText(path.join(systemRoot, "dist", ".gitkeep"), "");

  if (options["with-components"] === true) {
    await copyScaffold("components.tokens.json", path.join(systemRoot, "tokens", "components.tokens.json"));
  }
  if (options["with-themes"] === true) {
    await mkdir(path.join(systemRoot, "themes"), { recursive: true });
    await writeText(path.join(systemRoot, "themes", ".gitkeep"), "");
  }

  const auditTemplate = await readFile(path.join(scaffoldRoot, "AUDIT.md"), "utf8");
  const legacyDocs = Array.isArray(auditReport?.designDocs) && auditReport.designDocs.length > 0
    ? auditReport.designDocs.map((document) => `- \`${document}\``).join("\n")
    : "- 未发现或未提供既有设计文档。";
  const auditDocument = auditTemplate
    .replace("{{PROJECT_ROOT}}", projectRoot)
    .replace("{{SOURCE}}", source)
    .replace("{{AUDIT_REPORT}}", auditReportPath)
    .replace("{{LEGACY_DOCS}}", legacyDocs);
  await writeText(path.join(systemRoot, "AUDIT.md"), auditDocument);

  printJson({
    created: [
      "design-system/DESIGN.md",
      "design-system/AUDIT.md",
      "design-system/TRY.md",
      "design-system/tokens/primitives.tokens.json",
      "design-system/tokens/semantic.tokens.json",
      ...(options["with-components"] === true ? ["design-system/tokens/components.tokens.json"] : []),
      ...(options["with-themes"] === true ? ["design-system/themes/"] : []),
      "design-system/style-dictionary.config.mjs",
      "design-system/dist/.gitkeep"
    ],
    projectRoot,
    source,
    uiSourceChanged: false
  });
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

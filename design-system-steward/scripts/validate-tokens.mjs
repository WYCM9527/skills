import { stat } from "node:fs/promises";

import {
  parseArgs,
  printJson,
  reportError,
  requireAbsolutePath,
  requireStringOption
} from "./lib.mjs";
import { validateTokenDirectory } from "./tokens.mjs";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tokensRoot = requireAbsolutePath(requireStringOption(options, "tokens"), "--tokens");
  const details = await stat(tokensRoot);
  if (!details.isDirectory()) {
    throw new Error(`--tokens must be a directory: ${tokensRoot}`);
  }

  const result = await validateTokenDirectory(tokensRoot);
  printJson(result);
  process.exitCode = result.valid ? 0 : 1;
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 2;
});

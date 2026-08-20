import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const outputRoot = process.env.DS_OUTPUT_DIR
  ? path.resolve(process.env.DS_OUTPUT_DIR)
  : path.join(root, "dist");

export default {
  source: [path.join(root, "tokens/**/*.tokens.json")],
  platforms: {
    css: {
      transformGroup: "css",
      buildPath: `${outputRoot}${path.sep}`,
      files: [
        {
          destination: "tokens.css",
          format: "css/variables",
          options: {
            outputReferences: true,
            showFileHeader: false
          }
        }
      ]
    }
  }
};

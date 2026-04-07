// eslint.config.mjs
// eslint-plugin-obsidianmd's ESM flat config uses the legacy "extends" key,
// which ESLint 9 flat config rejects. Load the CJS build via createRequire so
// that configs.recommended is the plain rules object we can use directly.
import { createRequire } from "module";
import tsparser from "@typescript-eslint/parser";

const require = createRequire(import.meta.url);
const obsidianmdRaw = require("eslint-plugin-obsidianmd");
const obsidianmd = obsidianmdRaw.default ?? obsidianmdRaw;

export default [
  {
    plugins: { obsidianmd },
    rules: {
      ...obsidianmd.configs.recommended,
      "obsidianmd/ui/sentence-case": [
        "error",
        { enforceCamelCaseLower: true, acronyms: ["BM25", "RRF", "WASM", "ONNX", "FTS5", "MCP"] },
      ],
    },
  },
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
    },
  },
];
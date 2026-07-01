import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));
const scorecardSourceFiles = ["main.ts", "src/**/*.ts"];

export default defineConfig([
	{
		ignores: [
			"eslint.config.mjs",
			"eslint.scorecard.config.mjs",
			"esbuild.config.mjs",
			"main.js",
			"node_modules/**",
			"scripts/**",
			"dist/**",
			"coverage/**",
		],
	},
	{
		files: scorecardSourceFiles,
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				project: "./tsconfig.scorecard.json",
				tsconfigRootDir,
			},
		},
		plugins: {
			"@typescript-eslint": tseslint.plugin,
			obsidianmd,
		},
		rules: {
			"@typescript-eslint/no-floating-promises": "warn",
			"@typescript-eslint/no-misused-promises": "warn",
			"@typescript-eslint/no-unnecessary-type-assertion": "warn",
			"@typescript-eslint/no-unsafe-argument": "warn",
			"@typescript-eslint/no-unsafe-assignment": "warn",
			"@typescript-eslint/no-unsafe-call": "warn",
			"@typescript-eslint/no-unsafe-member-access": "warn",
			"@typescript-eslint/no-unsafe-return": "warn",
			"obsidianmd/no-plugin-as-component": "error",
			"obsidianmd/no-unsupported-api": "error",
			"obsidianmd/no-view-references-in-plugin": "error",
		},
	},
]);

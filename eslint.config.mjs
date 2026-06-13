import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import json from "@eslint/json";
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import depend from "eslint-plugin-depend";
import obsidianmd from "eslint-plugin-obsidianmd";
import { PlainTextParser } from "./node_modules/eslint-plugin-obsidianmd/dist/lib/plainTextParser.js";

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));
function useRootDependPlugin(config) {
	if (!config.plugins?.depend) return config;
	const { depend: _depend, ...plugins } = config.plugins;
	return {
		...config,
		plugins,
	};
}

const obsidianRecommended = obsidianmd.configs.recommended.map((config) => {
	const recommendedConfig = useRootDependPlugin(config);
	if (recommendedConfig.rules?.["obsidianmd/validate-manifest"] && !recommendedConfig.files) {
		return {
			...recommendedConfig,
			files: ["**/*.ts", "**/*.tsx"],
		};
	}

	return recommendedConfig;
});

export default defineConfig([
	{
		ignores: [
			"eslint.config.mjs",
			"esbuild.config.mjs",
			"main.js",
			"node_modules/**",
			"scripts/**",
			"dist/**",
			"coverage/**",
		],
	},
	...obsidianRecommended,
	{
		plugins: {
			depend,
			obsidianmd,
		},
		rules: {
			"depend/ban-dependencies": "warn",
			"no-useless-escape": "warn",
			// Keep type-aware Obsidian rules scoped to the TypeScript parser block below.
			"obsidianmd/no-plugin-as-component": "off",
			"obsidianmd/no-unsupported-api": "off",
			"obsidianmd/no-view-references-in-plugin": "off",
			"obsidianmd/prefer-file-manager-trash-file": "off",
			"obsidianmd/prefer-instanceof": "off",
			"obsidianmd/rule-custom-message": "warn",
			"obsidianmd/settings-tab/no-manual-html-headings": "warn",
		},
	},
	{
		files: ["**/*.ts", "**/*.tsx"],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				project: "./tsconfig.json",
				tsconfigRootDir,
			},
		},
		rules: {
			"@typescript-eslint/no-explicit-any": "warn",
			"@typescript-eslint/no-floating-promises": "warn",
			"@typescript-eslint/no-misused-promises": "warn",
			"@typescript-eslint/no-unnecessary-type-assertion": "warn",
			"@typescript-eslint/no-unsafe-argument": "warn",
			"@typescript-eslint/no-unsafe-assignment": "warn",
			"@typescript-eslint/no-unsafe-call": "warn",
			"@typescript-eslint/no-unsafe-member-access": "warn",
			"@typescript-eslint/no-unsafe-return": "warn",
			"@typescript-eslint/no-deprecated": "warn",
			"@typescript-eslint/no-base-to-string": "warn",
			"@typescript-eslint/no-duplicate-type-constituents": "warn",
			"@typescript-eslint/await-thenable": "warn",
			"depend/ban-dependencies": "warn",
			"no-useless-escape": "warn",
			"obsidianmd/no-plugin-as-component": "error",
			"obsidianmd/no-static-styles-assignment": "warn",
			"obsidianmd/no-unsupported-api": "error",
			"obsidianmd/no-view-references-in-plugin": "error",
			"obsidianmd/prefer-file-manager-trash-file": "warn",
			"obsidianmd/rule-custom-message": "warn",
			"obsidianmd/settings-tab/no-manual-html-headings": "warn",
			"obsidianmd/prefer-active-doc": "warn",
			"obsidianmd/prefer-window-timers": "warn",
			"obsidianmd/prefer-instanceof": "warn",
			"obsidianmd/ui/sentence-case": "warn",
		},
	},
	{
		files: ["manifest.json"],
		language: "json/json",
		plugins: {
			json,
			obsidianmd,
		},
		rules: {
			"no-irregular-whitespace": "off",
			"obsidianmd/validate-manifest": "error",
		},
	},
	{
		files: ["LICENSE"],
		languageOptions: {
			parser: PlainTextParser,
		},
		plugins: {
			obsidianmd,
		},
		rules: {
			"obsidianmd/validate-license": "error",
		},
	},
]);

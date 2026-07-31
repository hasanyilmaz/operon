import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import ts from "typescript";
import { OPERON_PRODUCTION_PERSISTENT_READ } from "./operon-build-config.mjs";

const banner = `/*
Operon is a task management system for humans and agents in Obsidian, built around inline tasks,
file tasks, reusable filters, customizable pipelines, pinned task workflows, unique calendar and
Kanban views, recurrence, and time tracking.
GPL-3.0-or-later
*/
`;

const buildMode = process.argv[2] ?? "development";
if (![
	"development",
	"production",
	"production-agent-runtime-probe",
	"production-agent-runtime-transport-feasibility",
	"production-agent-runtime-persistent-read-candidate",
	"production-agent-runtime-persistent-read-disabled",
	"production-agent-runtime-cas-baseline",
	"production-agent-runtime-cas-baseline-probe",
].includes(buildMode)) {
	throw new Error(`Unsupported Operon build mode: ${buildMode}`);
}
const prod = buildMode !== "development";
const agentRuntimeProbe = [
	"production-agent-runtime-probe",
	"production-agent-runtime-cas-baseline-probe",
].includes(buildMode);
const agentRuntimePersistentReadSpecialBuild = [
	"production-agent-runtime-transport-feasibility",
	"production-agent-runtime-persistent-read-candidate",
].includes(buildMode);
const agentRuntimePersistentReadDisabledBuild =
	buildMode === "production-agent-runtime-persistent-read-disabled";
const agentRuntimePersistentRead = agentRuntimePersistentReadSpecialBuild
	|| (
		buildMode === "production"
		&& OPERON_PRODUCTION_PERSISTENT_READ
	);
const agentRuntimePersistentReadCandidate =
	buildMode === "production-agent-runtime-persistent-read-candidate";
const receiptCasBaseline = [
	"production-agent-runtime-cas-baseline",
	"production-agent-runtime-cas-baseline-probe",
].includes(buildMode);
const outfile = receiptCasBaseline
	? (
		agentRuntimeProbe
			? "build/agent-runtime-cas-baseline/main-probe.js"
			: "build/agent-runtime-cas-baseline/main.js"
	)
	: (
		agentRuntimePersistentReadDisabledBuild
			? "build/stage51/main-disabled.js"
			: agentRuntimePersistentReadSpecialBuild
			? (
				agentRuntimePersistentReadCandidate
					? "build/stage51/main-production.js"
					: "build/stage51/main.js"
			)
			: agentRuntimeProbe
			? "build/agent-runtime-probe/main.js"
			: "main.js"
	);
const stripAgentRuntimeTimingPlugin = {
	name: "strip-agent-runtime-timing",
	setup(build) {
		build.onLoad(
			{ filter: /src[\\/]agent-runtime[\\/]runtime[\\/](coherent-read|mutation-gateway)\.ts$/ },
			async ({ path: sourcePath }) => {
				const source = await readFile(sourcePath, "utf8");
				const mutationGateway = /[\\/]mutation-gateway\.ts$/u.test(sourcePath);
				const expectedMethod = mutationGateway ? "measureMutation" : "measure";
				const expectedArity = mutationGateway ? 5 : 4;
				const expectedTransformCount = mutationGateway ? 30 : 6;
				let transformCount = 0;
				const sourceFile = ts.createSourceFile(
					sourcePath,
					source,
					ts.ScriptTarget.Latest,
					true,
					ts.ScriptKind.TS,
				);
				const transformed = ts.transform(sourceFile, [
					context => (root) => {
						const visit = (node) => {
							if (
								ts.isCallExpression(node)
								&& ts.isPropertyAccessExpression(node.expression)
								&& node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
								&& node.expression.name.text === expectedMethod
							) {
								if (node.arguments.length !== expectedArity) {
									throw new Error(
										`${expectedMethod} timing call arity changed in ${sourcePath}.`,
									);
								}
								const operation = node.arguments[node.arguments.length - 1];
								if (
									!(
										ts.isArrowFunction(operation)
										|| ts.isFunctionExpression(operation)
									)
									|| operation.parameters.length !== 0
								) {
									throw new Error(
										`${expectedMethod} timing operation must remain a zero-argument function.`,
									);
								}
								transformCount += 1;
								return ts.factory.createCallExpression(operation, undefined, []);
							}
							return ts.visitEachChild(node, visit, context);
						};
						return ts.visitNode(root, visit);
					},
				]);
				try {
					if (transformCount !== expectedTransformCount) {
						throw new Error(
							`${expectedMethod} timing transform count changed: `
							+ `${transformCount} !== ${expectedTransformCount}.`,
						);
					}
					return {
						contents: ts.createPrinter().printFile(transformed.transformed[0]),
						loader: "ts",
					};
				} finally {
					transformed.dispose();
				}
			},
		);
	},
};
const disableReceiptCasFastPathPlugin = {
	name: "disable-receipt-cas-fast-path",
	setup(build) {
		build.onLoad(
			{ filter: /src[\\/]agent-runtime[\\/]runtime[\\/]receipts[\\/]indexeddb-receipt-store\.ts$/ },
			async ({ path: sourcePath }) => {
				const source = await readFile(sourcePath, "utf8");
				const marker = "const RECEIPT_ADMISSION_FAST_PATH_ENABLED = true;";
				const occurrences = source.split(marker).length - 1;
				if (occurrences !== 1) {
					throw new Error(
						`Receipt CAS baseline marker count changed: ${occurrences} !== 1.`,
					);
				}
				return {
					contents: source.replace(
						marker,
						"const RECEIPT_ADMISSION_FAST_PATH_ENABLED = false;",
					),
					loader: "ts",
				};
			},
		);
	},
};

const context = await esbuild.context({
	banner: {
		js: banner,
	},
	entryPoints: ["main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules,
		...builtinModules.map(moduleName => `node:${moduleName}`),
	],
	format: "cjs",
	charset: "utf8",
	target: "es2018",
	logLevel: "info",
	minify: prod,
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	plugins: [
		...(prod && !agentRuntimeProbe ? [stripAgentRuntimeTimingPlugin] : []),
		...(receiptCasBaseline ? [disableReceiptCasFastPathPlugin] : []),
	],
	metafile: Boolean(process.env.OPERON_ESBUILD_METAFILE),
	define: {
		OPERON_AGENT_RUNTIME_PROBE_ENABLED: agentRuntimeProbe ? "true" : "false",
		OPERON_AGENT_RUNTIME_PERSISTENT_READ_ENABLED: agentRuntimePersistentRead ? "true" : "false",
	},
	outfile,
});

if (prod) {
	const result = await context.rebuild();
	if (process.env.OPERON_ESBUILD_METAFILE && result.metafile) {
		await writeFile(process.env.OPERON_ESBUILD_METAFILE, JSON.stringify(result.metafile));
	}
	process.exit(0);
} else {
	await context.watch();
}

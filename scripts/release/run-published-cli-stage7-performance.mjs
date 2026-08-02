#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	loadPublishedCliBinding,
	sanitizedChildEnvironment,
	withVerifiedPublishedCli,
} from '../agent-runtime/cli/published-cli-v1.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(scriptPath), '../..');
const performanceScript = path.join(
	pluginRoot,
	'scripts',
	'agent-runtime',
	'performance',
	'cli-speed-stage7-live.mjs',
);

export function readPublishedPerformanceArguments(argv) {
	if (argv.length !== 2 || argv[0] !== '--tarball' || !argv[1]) {
		throw new Error('OPERON_PUBLISHED_CLI_PERFORMANCE_USAGE');
	}
	return Object.freeze({ tarballPath: argv[1] });
}

export async function runPublishedCliStage7Performance(arguments_, options = {}) {
	const root = options.pluginRoot ?? pluginRoot;
	const loadBinding = options.loadBinding ?? loadPublishedCliBinding;
	const installVerified = options.installVerified ?? withVerifiedPublishedCli;
	const spawn = options.spawn ?? spawnSync;
	const { binding } = await loadBinding({ pluginRoot: root });
	return installVerified(
		arguments_.tarballPath,
		binding,
		async ({ executable }) => {
			const environment = withoutExecutableOverrides(
				sanitizedChildEnvironment(options.env ?? process.env),
			);
			environment.OPERON_PUBLISHED_CLI_EXECUTABLE = executable;
			const result = spawn(process.execPath, [performanceScript], {
				cwd: root,
				encoding: 'utf8',
				env: environment,
				maxBuffer: 32 * 1024 * 1024,
			});
			if (result.error) throw result.error;
			assert.equal(result.status, 0, `OPERON_PUBLISHED_CLI_PERFORMANCE_FAILED:${result.stderr?.trim() ?? ''}`);
			return result.stdout;
		},
		{ pluginRoot: root, env: options.env ?? process.env },
	);
}

function withoutExecutableOverrides(environment) {
	return Object.fromEntries(Object.entries(environment).filter(([key]) => ![
		'operon_cli_executable',
		'operon_published_cli_executable',
		'operon_cli_stage7_candidate',
	].includes(key.toLowerCase())));
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	const arguments_ = readPublishedPerformanceArguments(process.argv.slice(2));
	const output = await runPublishedCliStage7Performance(arguments_);
	process.stdout.write(output);
}

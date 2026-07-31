#!/usr/bin/env node

import {
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
	assertCliSpeedStage1Vault,
	buildStage1Evidence,
	CLI_SPEED_STAGE1_RESULT_PATH,
	CLI_SPEED_STAGE1_VAULT,
} from './cli-speed-stage1-core.mjs';

const options = parseArguments(process.argv.slice(2));
assertCliSpeedStage1Vault(options.vault, { lstatSync, realpathSync });

if (!options.samples) {
	throw new Error(
		'Stage 1 runner requires --samples <json>. Live destructive collection is intentionally separate.',
	);
}

const input = readJson(options.samples);
const baseline = options.compare ? readJson(options.compare) : undefined;
const evidence = buildStage1Evidence({
	environment: input.environment,
	artifacts: input.artifacts,
	fixtureDigest: input.fixtureDigest,
	samples: input.samples,
	scenarioMetadata: input.scenarioMetadata,
	batchSpeedups: input.batchSpeedups,
	probeStageTimings: input.probeStageTimings,
	baseline,
});

mkdirSync(path.dirname(CLI_SPEED_STAGE1_RESULT_PATH), { recursive: true });
writeFileSync(CLI_SPEED_STAGE1_RESULT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (!evidence.gates.ok) process.exitCode = 1;

function parseArguments(argumentsList) {
	const parsed = {
		vault: CLI_SPEED_STAGE1_VAULT,
		samples: undefined,
		compare: undefined,
	};
	for (let index = 0; index < argumentsList.length; index += 1) {
		const argument = argumentsList[index];
		if (!['--vault', '--samples', '--compare'].includes(argument)) {
			throw new Error(`Unknown CLI speed Stage 1 argument: ${argument}`);
		}
		const value = argumentsList[index + 1];
		if (!value || value.startsWith('--')) {
			throw new Error(`${argument} requires a value.`);
		}
		parsed[argument.slice(2)] = value;
		index += 1;
	}
	return parsed;
}

function readJson(filePath) {
	return JSON.parse(readFileSync(path.resolve(filePath), 'utf8'));
}

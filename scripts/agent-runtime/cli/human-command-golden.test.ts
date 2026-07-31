import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
	OPERON_CLI_COMMAND_DEFINITIONS_V1,
	commandDefinitionByIdV1,
} from '../../../packages/operon-cli/src/command-registry';
import { tokenizeShellLineV1 } from '../../../packages/operon-cli/src/interactive-shell';
import { createCliManifestBaseV1 } from '../../../packages/operon-cli/src/manifest-data';

declare global {
	var __operonHumanCommandGoldenTestRun: Promise<void> | undefined;
}

interface HumanCommandCaseV1 {
	id: string;
	commandId: string;
	route: 'meta' | 'local' | 'runtime' | 'convenience';
	displayCommand: string;
	compactCaseId?: string;
}

globalThis.__operonHumanCommandGoldenTestRun = Promise.resolve().then(() => {
	const fixture = JSON.parse(readFileSync(
		path.resolve(process.cwd(), 'scripts/agent-runtime/fixtures/human-cli-command-golden.json'),
		'utf8',
	)) as {
		schemaVersion: number;
		contract: { minimumUniqueCommands: number };
		cases: HumanCommandCaseV1[];
	};
	assert.equal(fixture.schemaVersion, 1);
	assert(fixture.cases.length >= fixture.contract.minimumUniqueCommands);
	assert.equal(
		new Set(fixture.cases.map(testCase => testCase.displayCommand)).size,
		fixture.cases.length,
	);

	const manifest = createCliManifestBaseV1('0.1.0-test');
	assert.equal(manifest.commands.convenience.length, 19);
	assert.equal(Object.keys(manifest.mutationCapabilities).length, 12);

	for (const testCase of fixture.cases) {
		const definition = commandDefinitionByIdV1(testCase.commandId);
		assert(definition, `Unknown human command ID: ${testCase.commandId}`);
		assert.equal(definition.route, testCase.route, `${testCase.id}/route`);
		assertDisplayRoute(testCase, definition.path, definition.aliases ?? []);
		assertDisplayArgumentsAdmitted(testCase, definition.options ?? []);
	}

	const coveredConvenience = new Set(fixture.cases
		.filter(testCase => testCase.route === 'convenience')
		.map(testCase => testCase.commandId));
	assert.deepEqual(
		[...coveredConvenience].sort(),
		[...manifest.commands.convenience].sort(),
	);
	assert.equal(
		OPERON_CLI_COMMAND_DEFINITIONS_V1.filter(definition => definition.route === 'convenience').length,
		19,
	);
	console.log('Human CLI command golden registry tests passed');
});

function assertDisplayArgumentsAdmitted(
	testCase: HumanCommandCaseV1,
	optionLines: readonly string[],
): void {
	const command = testCase.displayCommand.replace(/\\\r?\n[ \t]*/gu, '');
	const tokens = tokenizeShellLineV1(command);
	assert.equal(tokens.shift(), 'operon', `${testCase.id}/root`);
	if (testCase.commandId === 'help') return;
	const definition = commandDefinitionByIdV1(testCase.commandId);
	assert(definition, `${testCase.id}/definition`);
	if (tokens[0] === 'help') {
		assert.deepEqual(tokens.slice(1), definition.path, `${testCase.id}/help-path`);
		return;
	}
	const commandPath = [definition.path, ...(definition.aliases ?? [])]
		.find(pathSegments => pathSegments.every((token, index) => tokens[index] === token));
	assert(commandPath, `${testCase.id}/command-path`);

	const optionSpecs = new Map<string, boolean>();
	optionSpecs.set('--help', false);
	optionSpecs.set('-h', false);
	for (const line of optionLines) {
		for (const match of line.matchAll(/--[a-z][a-z-]*/gu)) {
			const option = match[0];
			const tail = line.slice((match.index ?? 0) + option.length);
			optionSpecs.set(option, /^\s+<|^=<|^\s+\{/u.test(tail));
		}
	}
	const argumentsAfterPath = tokens.slice(commandPath.length);
	const positionalArguments: string[] = [];
	for (let index = 0; index < argumentsAfterPath.length; index += 1) {
		const token = argumentsAfterPath[index];
		if (!token.startsWith('--')) {
			if (token.includes('::')) {
				assert.match(token, /^[A-Za-z][A-Za-z0-9]*::.+$/u, `${testCase.id}/assignment`);
			} else {
				positionalArguments.push(token);
			}
			continue;
		}
		assert(optionSpecs.has(token), `${testCase.id} uses unregistered option ${token}`);
		if (!optionSpecs.get(token)) continue;
		const value = argumentsAfterPath[index + 1];
		assert(value && !value.startsWith('--'), `${testCase.id} lacks a value for ${token}`);
		index += 1;
	}
	assertFixturePositionalArity(testCase, positionalArguments);
}

function assertFixturePositionalArity(
	testCase: HumanCommandCaseV1,
	positionals: readonly string[],
): void {
	switch (testCase.commandId) {
		case 'task.create':
			assert(
				positionals.length === 1
					|| (
						positionals.length === 2
						&& (positionals[0] === 'inline' || positionals[0] === 'file')
					),
				`${testCase.id}/create-positionals`,
			);
			return;
		case 'task.find':
			assert(positionals.length <= 1, `${testCase.id}/find-positionals`);
			return;
		case 'plan.show':
		case 'plan.apply':
		case 'plan.discard':
			assert.equal(positionals.length, 1, `${testCase.id}/plan-ref`);
			return;
		case 'plan.recover':
			assert(positionals.length <= 1, `${testCase.id}/recovery-plan-ref`);
			return;
		default:
			assert.equal(positionals.length, 0, `${testCase.id}/unexpected-positionals`);
	}
}

function assertDisplayRoute(
	testCase: HumanCommandCaseV1,
	pathSegments: readonly string[],
	aliases: readonly (readonly string[])[],
): void {
	const command = testCase.displayCommand.replace(/\\\r?\n[ \t]*/gu, '');
	if (testCase.commandId === 'help') {
		assert.match(command, /^operon help(?:\s|$)/u, testCase.id);
		return;
	}
	const prefixes = [pathSegments, ...aliases].map(commandPath => `operon ${commandPath.join(' ')}`);
	const helpPrefix = `operon help ${pathSegments.join(' ')}`;
	assert(
		prefixes.some(prefix => command === prefix || command.startsWith(`${prefix} `))
			|| command === helpPrefix
			|| command.startsWith(`${helpPrefix} `),
		`${testCase.id} does not match ${testCase.commandId}`,
	);
}

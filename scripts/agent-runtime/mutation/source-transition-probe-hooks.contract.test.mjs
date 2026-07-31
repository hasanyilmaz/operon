import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const mainSource = readFileSync(path.join(pluginRoot, 'main.ts'), 'utf8');
const executorSource = readFileSync(
	path.join(pluginRoot, 'src/agent-runtime/runtime/graph-transaction-executor.ts'),
	'utf8',
);

test('source-transition interruption hooks are probe-build only and one-shot', () => {
	for (const armedName of [
		'sourceTransitionPreTrashProbeArmed',
		'sourceTransitionPostTrashProbeArmed',
	]) {
		assert.match(
			mainSource,
			new RegExp(`let ${armedName} = OPERON_AGENT_RUNTIME_PROBE_ENABLED;`, 'u'),
		);
		assert.match(
			mainSource,
			new RegExp(
				`OPERON_AGENT_RUNTIME_PROBE_ENABLED\\s*&& ${armedName}[\\s\\S]*?${armedName} = false;`,
				'u',
			),
		);
	}
});

test('pre-trash hook stops after the first reversible source step and before a sealed delete', () => {
	const block = between(
		'&& sourceTransitionPreTrashProbeArmed',
		'&& sourceTransitionPostTrashProbeArmed',
	);
	assert.match(block, /kind === 'source-transition'/u);
	assert.match(block, /step\.resourceKind === 'task-source'/u);
	assert.match(block, /step\.operation !== 'delete'/u);
	assert.match(block, /journal\.steps\.slice\(0, index\)\.some/u);
	assert.match(block, /journal\.steps\.slice\(index \+ 1\)\.some/u);
	assert.match(block, /item\.operation === 'delete'/u);
	assert.match(block, /a12-probe-source-pre-trash-interrupt-v1/u);
});

test('post-trash hook fires only after a source delete step', () => {
	const block = between(
		'&& sourceTransitionPostTrashProbeArmed',
		'},\n\t\t\t\t);',
	);
	assert.match(block, /kind === 'source-transition'/u);
	assert.match(block, /step\.resourceKind === 'task-source'/u);
	assert.match(block, /step\.operation === 'delete'/u);
	assert.match(block, /a12-probe-source-post-trash-interrupt-v1/u);
});

test('graph executor checkpoints each durable step before invoking probe hooks', () => {
	assert.match(
		executorSource,
		/await checkpoint\(\{ phase: 'committing', completedStepCount: index \+ 1 \}\);\s*await afterStep\?\.\(step, index\);/u,
	);
});

function between(start, end) {
	const startIndex = mainSource.indexOf(start);
	assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
	const endIndex = mainSource.indexOf(end, startIndex + start.length);
	assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
	return mainSource.slice(startIndex, endIndex);
}

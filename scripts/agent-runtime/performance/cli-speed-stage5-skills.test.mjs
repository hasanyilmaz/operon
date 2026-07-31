import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const packageReadme = readFileSync(
	path.join(pluginRoot, 'packages/operon-cli/README.md'),
	'utf8',
);
const sessionGuide = readFileSync(
	path.join(
		pluginRoot,
		'docs/operon-docs/DOCS-133 JSONL sessions for scripts and agents.md',
	),
	'utf8',
);

test('public package routes multi-call workflows to the JSONL session protocol', () => {
	assert.match(packageReadme, /operon session --jsonl/u);
	assert.match(sessionGuide, /needs several operations/iu);
	assert.match(sessionGuide, /ordinary frames sequentially/iu);
	assert.match(sessionGuide, /Every stdin line is one closed JSON object/iu);
	assert.match(sessionGuide, /Every stdout line is one result or failure envelope/iu);
});

test('public JSONL guidance limits concurrent groups to safe ordered reads', () => {
	assert.match(sessionGuide, /between 2 and 8 child frames/iu);
	assert.match(sessionGuide, /stdout preserves request order/iu);
	assert.match(sessionGuide, /Mutation commands are never allowed inside a read group/iu);
	assert.match(sessionGuide, /Submit them as ordinary sequential frames/iu);
});

test('public package keeps apply interruption on the same-plan recovery path', () => {
	assert.match(packageReadme, /exits with code `5`/u);
	assert.match(packageReadme, /`outcome-unknown`/u);
	assert.match(packageReadme, /same `planRef`/u);
	assert.match(packageReadme, /operon plan recover <planRef> --json/u);
	assert.match(packageReadme, /pre-dispatch interruption exits\s+with `130`/iu);
});

test('public JSONL guidance forbids mutation retry after dispatch uncertainty', () => {
	assert.match(sessionGuide, /After apply may have started/iu);
	assert.match(sessionGuide, /exit `5`, `outcome-unknown`/iu);
	assert.match(sessionGuide, /Recover only that stored plan/iu);
	assert.match(sessionGuide, /Do not submit a replacement preview, ordinary apply, or discard/iu);
	assert.match(sessionGuide, /Developer API recovery uses a separate opaque `recoveryRef`/iu);
});

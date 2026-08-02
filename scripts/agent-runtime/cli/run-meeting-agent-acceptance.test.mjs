import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { readMeetingAcceptanceArguments } from './run-meeting-agent-acceptance.mjs';

test('meeting acceptance requires an exact tarball and disposable vault', () => {
	assert.deepEqual(readMeetingAcceptanceArguments([
		'--tarball', '/tmp/operon-cli-1.0.8.tgz',
		'--vault', '/tmp/operon-agent-runtime-phase1-meeting',
	]), {
		tarballPath: '/tmp/operon-cli-1.0.8.tgz',
		vaultPath: '/tmp/operon-agent-runtime-phase1-meeting',
	});
	for (const arguments_ of [
		[],
		['--vault', '/tmp/operon-agent-runtime-phase1-meeting'],
		['--tarball', '/tmp/a.tgz', '--tarball', '/tmp/b.tgz'],
		['--executable', '/tmp/operon', '--vault', '/tmp/operon-agent-runtime-phase1-meeting'],
	]) {
		assert.throws(() => readMeetingAcceptanceArguments(arguments_), /OPERON_MEETING_ACCEPTANCE_USAGE/u);
	}
});

test('meeting acceptance has no local package, pack, latest, or user-install fallback', async () => {
	const source = await readFile(new URL('./run-meeting-agent-acceptance.mjs', import.meta.url), 'utf8');
	assert.match(source, /withVerifiedPublishedCli/u);
	assert.doesNotMatch(source, /packages\/operon-cli|npm pack|@latest|\.local\/bin\/operon/u);
});

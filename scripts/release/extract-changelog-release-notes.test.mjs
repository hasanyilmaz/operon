import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	extractChangelogReleaseNotes,
	writeChangelogReleaseNotes,
} from './extract-changelog-release-notes.mjs';

const releaseBody = [
	'Operon 3.0.0 release summary.',
	'',
	'### New',
	'- Added the public Runtime.',
].join('\n');

function changelogWith(section) {
	return [
		'# Changelog',
		'',
		'## [Unreleased]',
		'',
		section,
		'',
		'## [2.6.0] - 2026-07-22',
		'',
		'Previous release.',
		'',
	].join('\n');
}

test('extracts the exact version body without the changelog heading', () => {
	const changelog = changelogWith([
		'## [3.0.0] - 2026-07-31',
		'',
		releaseBody,
	].join('\n'));
	assert.equal(extractChangelogReleaseNotes(changelog, '3.0.0'), `${releaseBody}\n`);
});

test('rejects a missing release version', () => {
	assert.throws(
		() => extractChangelogReleaseNotes(changelogWith(''), '3.0.0'),
		/OPERON_RELEASE_NOTES_VERSION_MISSING/u,
	);
});

test('rejects duplicate release sections', () => {
	const section = [
		'## [3.0.0] - 2026-07-31',
		'',
		releaseBody,
		'',
		'## [3.0.0] - 2026-07-31',
		'',
		releaseBody,
	].join('\n');
	assert.throws(
		() => extractChangelogReleaseNotes(changelogWith(section), '3.0.0'),
		/OPERON_RELEASE_NOTES_VERSION_DUPLICATE/u,
	);
});

test('rejects an empty release section', () => {
	const changelog = changelogWith('## [3.0.0] - 2026-07-31');
	assert.throws(
		() => extractChangelogReleaseNotes(changelog, '3.0.0'),
		/OPERON_RELEASE_NOTES_BODY_EMPTY/u,
	);
});

test('rejects a tag that is not plain stable semver', () => {
	for (const version of ['v3.0.0', '01.0.0', '3.0.0-beta.1', '3.0.0+build.1']) {
		assert.throws(
			() => extractChangelogReleaseNotes(changelogWith(''), version),
			/OPERON_RELEASE_NOTES_VERSION_INVALID/u,
		);
	}
});

test('ignores release-shaped headings inside fenced code blocks', () => {
	const body = [
		releaseBody,
		'',
		'```md',
		'## [3.0.0] - 2099-01-01',
		'```',
	].join('\n');
	const changelog = changelogWith([
		'## [3.0.0] - 2026-07-31',
		'',
		body,
	].join('\n'));
	assert.equal(extractChangelogReleaseNotes(changelog, '3.0.0'), `${body}\n`);
});

test('fails closed on a malformed following release heading', () => {
	const changelog = [
		'# Changelog',
		'',
		'## [3.0.0] - 2026-07-31',
		'',
		releaseBody,
		'',
		'## [2.6.0]',
		'',
		'Previous release.',
	].join('\n');
	assert.throws(
		() => extractChangelogReleaseNotes(changelog, '3.0.0'),
		/OPERON_RELEASE_NOTES_HEADING_INVALID/u,
	);
});

test('ignores release-shaped headings inside HTML comments', () => {
	const body = [
		releaseBody,
		'',
		'<!--',
		'## [3.0.0] - 2099-01-01',
		'-->',
	].join('\n');
	const changelog = changelogWith([
		'## [3.0.0] - 2026-07-31',
		'',
		body,
	].join('\n'));
	assert.equal(extractChangelogReleaseNotes(changelog, '3.0.0'), `${body}\n`);
});

test('rejects impossible release dates and accepts a valid leap day', () => {
	for (const date of ['2026-00-01', '2026-02-29', '2026-04-31', '2026-13-01']) {
		assert.throws(
			() => extractChangelogReleaseNotes(changelogWith([
				`## [3.0.0] - ${date}`,
				'',
				releaseBody,
			].join('\n')), '3.0.0'),
			/OPERON_RELEASE_NOTES_HEADING_INVALID/u,
		);
	}
	const leapRelease = changelogWith([
		'## [3.0.0] - 2028-02-29',
		'',
		releaseBody,
	].join('\n'));
	assert.equal(extractChangelogReleaseNotes(leapRelease, '3.0.0'), `${releaseBody}\n`);
});

test('normalizes CRLF input and no-final-newline input to LF output', () => {
	const changelog = [
		'# Changelog',
		'',
		'## [Unreleased]',
		'',
		'## [3.0.0] - 2026-07-31',
		'',
		'Line one.',
		'Line two.',
	].join('\r\n');
	assert.equal(
		extractChangelogReleaseNotes(changelog, '3.0.0'),
		'Line one.\nLine two.\n',
	);
});

test('writes exact release-note bytes through the workflow CLI contract', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-release-notes-test-'));
	try {
		const changelogPath = path.join(root, 'CHANGELOG.md');
		const outputPath = path.join(root, 'release-notes.md');
		const changelog = changelogWith([
			'## [3.0.0] - 2026-07-31',
			'',
			releaseBody,
		].join('\n'));
		await writeFile(changelogPath, changelog, 'utf8');
		await writeChangelogReleaseNotes([
			'--changelog', changelogPath,
			'--version', '3.0.0',
			'--out', outputPath,
		]);
		assert.equal(await readFile(outputPath, 'utf8'), `${releaseBody}\n`);
		await assert.rejects(
			writeChangelogReleaseNotes(['--version', '3.0.0']),
			/Usage: extract-changelog-release-notes/u,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	mkdtemp,
	mkdir,
	link,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	runNativeDeveloperApiAcceptance,
	stageExactFile,
	stageExactFiles,
} from './run-native-developer-api-acceptance.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const source = await readFile(
	path.join(scriptDirectory, 'run-native-developer-api-acceptance.mjs'),
	'utf8',
);

test('native Developer API orchestrator is repo-owned and command-driven', () => {
	assert.doesNotMatch(source, /OPERON_DEVELOPER_API_ACCEPTANCE_(?:INPUT|OUTPUT)/u);
	assert.match(source, /plugin:reload/u);
	assert.match(source, /plugin:enable/u);
	assert.match(source, /run-native-acceptance-\$\{phase\}/u);
	assert.match(source, /routineEvidenceSha256/u);
	assert.match(source, /commandTranscript/u);
});

test('orchestrator fails closed before staging when the disposable vault marker is absent', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-native-orchestrator-test-'));
	try {
		const vault = path.join(root, 'vault');
		const artifact = path.join(root, 'artifact');
		const tarball = path.join(root, 'candidate.tgz');
		const executable = path.join(root, 'operon');
		const candidateEvidence = path.join(root, 'candidate-evidence.json');
		await mkdir(vault);
		await mkdir(artifact);
		await writeFile(tarball, 'candidate', 'utf8');
		await writeFile(executable, 'executable', { encoding: 'utf8', mode: 0o700 });
		const artifactValues = new Map([
			['main.js', 'main'],
			['manifest.json', '{}'],
			['styles.css', 'styles'],
		]);
		for (const [fileName, value] of artifactValues) {
			await writeFile(path.join(artifact, fileName), value, 'utf8');
		}
		await writeFile(candidateEvidence, JSON.stringify({
			kind: 'operon-cli-native-candidate',
			sha256: digest('candidate'),
			compatiblePublicPlugin: {
				kind: 'operon-plugin-native-candidate',
				mainJsSha256: digest('main'),
				manifestSha256: digest('{}'),
				stylesCssSha256: digest('styles'),
			},
		}), 'utf8');
		const canonicalVault = await realpath(vault);
		const canonicalArtifact = await realpath(artifact);
		const canonicalTarball = await realpath(tarball);
		const canonicalExecutable = await realpath(executable);
		const canonicalCandidateEvidence = await realpath(candidateEvidence);
		await assert.rejects(
			() => runNativeDeveloperApiAcceptance({
				vault: canonicalVault,
				operonArtifactRoot: canonicalArtifact,
				tarball: canonicalTarball,
				cliExecutable: canonicalExecutable,
				candidateEvidence: canonicalCandidateEvidence,
				operonId: '00000000-0000-4000-8000-000000000001',
				representation: 'inline',
				taskFile: 'Tasks.md',
				lineNumber: '0',
				output: path.join(root, 'proof.json'),
				obsidianBin: 'must-not-run',
			}),
			/ENOENT/u,
		);
		assert.equal(
			await readFile(tarball, 'utf8'),
			'candidate',
			'Fail-closed marker rejection must not stage or mutate artifacts.',
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

function digest(value) {
	return createHash('sha256').update(value).digest('hex');
}

test('consumer runtime source contains no parent-process runner path dependency', async () => {
	const main = await readFile(
		path.join(
			pluginRoot,
			'scripts/agent-runtime/developer-api/native-acceptance-consumer/main.ts',
		),
		'utf8',
	);
	assert.doesNotMatch(main, /process\.env/u);
	assert.match(main, /ACCEPTANCE_RUNNER_DIRECTORY_V1/u);
	assert.match(main, /ROUTINE_EVIDENCE_DIGEST_MISMATCH/u);
});

test('artifact staging rejects destination symlinks and hardlinks without touching targets', async () => {
	const temporary = await mkdtemp(path.join(tmpdir(), 'operon-native-stage-test-'));
	try {
		const root = await realpath(temporary);
		const source = path.join(root, 'source');
		const destinationRoot = path.join(root, 'destination');
		const victim = path.join(root, 'victim');
		await mkdir(destinationRoot);
		await writeFile(source, 'candidate', 'utf8');
		await writeFile(victim, 'preserve', 'utf8');

		const symlinkDestination = path.join(destinationRoot, 'symlink-target');
		await symlink(victim, symlinkDestination);
		await assert.rejects(
			() => stageExactFile(source, symlinkDestination, destinationRoot),
			/single-link regular file/u,
		);
		assert.equal(await readFile(victim, 'utf8'), 'preserve');

		const hardlinkDestination = path.join(destinationRoot, 'hardlink-target');
		await link(victim, hardlinkDestination);
		await assert.rejects(
			() => stageExactFile(source, hardlinkDestination, destinationRoot),
			/single-link regular file/u,
		);
		assert.equal(await readFile(victim, 'utf8'), 'preserve');
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test('artifact-set preflight leaves earlier files unchanged when a later destination is unsafe', async () => {
	const temporary = await mkdtemp(path.join(tmpdir(), 'operon-native-stage-set-test-'));
	try {
		const root = await realpath(temporary);
		const sourceRoot = path.join(root, 'source');
		const destinationRoot = path.join(root, 'destination');
		const victim = path.join(root, 'victim');
		await mkdir(sourceRoot);
		await mkdir(destinationRoot);
		await writeFile(path.join(sourceRoot, 'main.js'), 'new-main', 'utf8');
		await writeFile(path.join(sourceRoot, 'manifest.json'), 'new-manifest', 'utf8');
		await writeFile(path.join(destinationRoot, 'main.js'), 'old-main', 'utf8');
		await writeFile(victim, 'preserve', 'utf8');
		await symlink(victim, path.join(destinationRoot, 'manifest.json'));
		await assert.rejects(
			() => stageExactFiles([
				{
					sourcePath: path.join(sourceRoot, 'main.js'),
					destinationPath: path.join(destinationRoot, 'main.js'),
					destinationRoot,
				},
				{
					sourcePath: path.join(sourceRoot, 'manifest.json'),
					destinationPath: path.join(destinationRoot, 'manifest.json'),
					destinationRoot,
				},
			]),
			/single-link regular file/u,
		);
		assert.equal(await readFile(path.join(destinationRoot, 'main.js'), 'utf8'), 'old-main');
		assert.equal(await readFile(victim, 'utf8'), 'preserve');
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

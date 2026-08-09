import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { canonicalJson, checkEvidenceSealV3, classifyEvidenceSealV3, sealPaths, writeEvidenceSealV3 } from './evidence-seal-v3.mjs';
import { verifyHostedEvidenceV3 } from './verify-hosted-evidence-v3.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('writer creates only the v3 allowlist and classifier requires its direct-child commit', async () => {
	const fixture = await createFixture();
	try {
		const result = await writeEvidenceSealV3(fixture.receiptPath, { pluginRoot: fixture.root });
		assert.deepEqual(result.paths, sealPaths('3.2.0'));
		assert.deepEqual(statusPaths(fixture.root), [...sealPaths('3.2.0')].sort());
		git(fixture.root, ['add', ...sealPaths('3.2.0')]);
		git(fixture.root, ['commit', '-m', 'chore(release): seal Operon 3.2.0 evidence']);
		const classification = await classifyEvidenceSealV3({ pluginRoot: fixture.root });
		assert.equal(classification.mode, 'evidence-seal');
		assert.equal(classification.candidateCommit, fixture.candidateCommit);
		const checked = await checkEvidenceSealV3({ pluginRoot: fixture.root });
		assert.equal(checked.candidateCommit, fixture.candidateCommit);
	} finally {
		await rm(fixture.receiptPath, { force: true });
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('writer fails closed for receipt drift without changing the candidate', async () => {
	const fixture = await createFixture();
	try {
		const receipt = JSON.parse(await readFile(fixture.receiptPath, 'utf8'));
		receipt.hostedValidation.ci.headSha = 'f'.repeat(40);
		await writeFile(fixture.receiptPath, `${JSON.stringify(receipt)}\n`);
		await assert.rejects(writeEvidenceSealV3(fixture.receiptPath, { pluginRoot: fixture.root }));
		assert.deepEqual(statusPaths(fixture.root), []);
	} finally {
		await rm(fixture.receiptPath, { force: true });
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('online verifier binds all three run and job identities', async () => {
	const fixture = await createFixture();
	try {
		await writeEvidenceSealV3(fixture.receiptPath, { pluginRoot: fixture.root });
		git(fixture.root, ['add', ...sealPaths('3.2.0')]);
		git(fixture.root, ['commit', '-m', 'chore(release): seal Operon 3.2.0 evidence']);
		const receipt = JSON.parse(await readFile(fixture.receiptPath, 'utf8'));
		const proofs = [receipt.hostedValidation.ci, receipt.hostedValidation.codeql, receipt.windowsPairProof];
		const responses = new Map();
		for (const proof of proofs) {
			responses.set(`/runs/${proof.runId}`, { id: proof.runId, repository: { full_name: proof.repository }, path: proof.workflowPath, head_sha: proof.headSha, head_branch: 'main', event: proof.repository === 'hasanyilmaz/operon-cli' ? 'workflow_dispatch' : 'push', run_attempt: proof.runAttempt, status: 'completed', conclusion: 'success' });
			responses.set(`/jobs/${proof.jobId}`, { id: proof.jobId, run_id: proof.runId, run_attempt: proof.runAttempt, name: proof.jobName, status: 'completed', conclusion: 'success' });
		}
		const fetchImpl = async url => ({ status: 200, json: async () => responses.get(new URL(url).pathname.match(/\/(runs|jobs)\/\d+$/u)?.[0]) });
		const verified = await verifyHostedEvidenceV3({ pluginRoot: fixture.root, fetchImpl, token: 'fixture' });
		assert.equal(verified.proofs.length, 3);
		responses.get('/jobs/202').conclusion = 'failure';
		await assert.rejects(verifyHostedEvidenceV3({ pluginRoot: fixture.root, fetchImpl, token: 'fixture' }));
	} finally {
		await rm(fixture.receiptPath, { force: true });
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('strict seal check rejects rebuilt release artifact drift', async () => {
	const fixture = await createFixture();
	try {
		await writeEvidenceSealV3(fixture.receiptPath, { pluginRoot: fixture.root });
		git(fixture.root, ['add', ...sealPaths('3.2.0')]);
		git(fixture.root, ['commit', '-m', 'chore(release): seal Operon 3.2.0 evidence']);
		await writeFile(path.join(fixture.root, 'main.js'), 'drifted release artifact\n');
		await assert.rejects(checkEvidenceSealV3({ pluginRoot: fixture.root }));
	} finally {
		await rm(fixture.receiptPath, { force: true });
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('strict seal check rejects semantically tampered audit with recomputed hashes', async () => {
	const fixture = await createFixture();
	try {
		await writeEvidenceSealV3(fixture.receiptPath, { pluginRoot: fixture.root });
		const freezePath = path.join(fixture.root, 'contracts/agent-runtime/releases/3.2.0/public-v1-external-freeze.json');
		const registryPath = path.join(fixture.root, 'contracts/agent-runtime/public-v1-release-freezes.json');
		const freeze = JSON.parse(await readFile(freezePath, 'utf8'));
		freeze.audit.validation.status = 'failed';
		const { inputsAggregateSha256: _old, ...body } = freeze;
		freeze.inputsAggregateSha256 = createHash('sha256').update(canonicalJson(body)).digest('hex');
		const freezeBytes = Buffer.from(`${JSON.stringify(freeze, null, 2)}\n`);
		await writeFile(freezePath, freezeBytes);
		const registry = JSON.parse(await readFile(registryPath, 'utf8'));
		const identity = registry.releases.at(-1).files.find(item => item.path.endsWith('/public-v1-external-freeze.json'));
		identity.bytes = freezeBytes.byteLength;
		identity.sha256 = createHash('sha256').update(freezeBytes).digest('hex');
		await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
		git(fixture.root, ['add', ...sealPaths('3.2.0')]);
		git(fixture.root, ['commit', '-m', 'tampered evidence seal']);
		await assert.rejects(checkEvidenceSealV3({ pluginRoot: fixture.root }));
		assert.equal((await classifyEvidenceSealV3({ pluginRoot: fixture.root })).mode, 'candidate');
	} finally {
		await rm(fixture.receiptPath, { force: true });
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('strict seal check rejects a self-authorized replacement schema', async () => {
	const fixture = await createFixture();
	try {
		await writeEvidenceSealV3(fixture.receiptPath, { pluginRoot: fixture.root });
		const schemaPath = path.join(fixture.root, 'contracts/agent-runtime/releases/3.2.0/public-v1-external-freeze.schema.json');
		const registryPath = path.join(fixture.root, 'contracts/agent-runtime/public-v1-release-freezes.json');
		const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
		schema.title = 'Attacker-controlled permissive schema';
		const schemaBytes = Buffer.from(`${JSON.stringify(schema, null, 2)}\n`);
		await writeFile(schemaPath, schemaBytes);
		const registry = JSON.parse(await readFile(registryPath, 'utf8'));
		const identity = registry.releases.at(-1).files.find(item => item.path.endsWith('/public-v1-external-freeze.schema.json'));
		identity.bytes = schemaBytes.byteLength;
		identity.sha256 = createHash('sha256').update(schemaBytes).digest('hex');
		await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
		git(fixture.root, ['add', ...sealPaths('3.2.0')]);
		git(fixture.root, ['commit', '-m', 'tampered evidence schema']);
		await assert.rejects(checkEvidenceSealV3({ pluginRoot: fixture.root }));
	} finally {
		await rm(fixture.receiptPath, { force: true });
		await rm(fixture.root, { recursive: true, force: true });
	}
});

async function createFixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), 'operon-evidence-seal-v3-'));
	await mkdir(path.join(root, 'contracts/agent-runtime'), { recursive: true });
	await copyFile(path.join(projectRoot, 'contracts/agent-runtime/published-cli-v1.json'), path.join(root, 'contracts/agent-runtime/published-cli-v1.json'));
	await writeFile(path.join(root, 'package.json'), '{"version":"3.2.0"}\n');
	await writeFile(path.join(root, 'main.js'), 'candidate main\n');
	await writeFile(path.join(root, 'manifest.json'), '{"version":"3.2.0"}\n');
	await writeFile(path.join(root, 'styles.css'), 'candidate styles\n');
	await writeFile(path.join(root, 'contracts/agent-runtime/public-v1-release-freezes.json'), `${JSON.stringify({
		registryVersion: 1,
		kind: 'operon-public-v1-release-freeze-registry',
		currentPluginVersion: '3.1.1',
		releases: [{ pluginVersion: '3.1.1', cliVersion: '1.0.9', evidenceKind: 'paired-automated-validation', files: [{ path: 'historical', bytes: 1, sha256: 'a'.repeat(64) }] }],
	}, null, 2)}\n`);
	git(root, ['init']);
	git(root, ['config', 'user.email', 'test@example.com']);
	git(root, ['config', 'user.name', 'Evidence Test']);
	git(root, ['add', '.']);
	git(root, ['commit', '-m', 'Release 3.2.0']);
	const candidateCommit = git(root, ['rev-parse', 'HEAD']);
	const artifact = {
		version: '3.2.0',
		files: await Promise.all(['main.js', 'manifest.json', 'styles.css'].map(async file => {
			const bytes = await readFile(path.join(root, file));
			return { path: file, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
		})),
	};
	const binding = JSON.parse(await readFile(path.join(root, 'contracts/agent-runtime/published-cli-v1.json'), 'utf8'));
	const proof = (repository, workflowPath, runId, jobId, jobName) => ({ repository, workflowPath, runId, runAttempt: 1, jobId, jobName, headSha: candidateCommit, status: 'success' });
	const receipt = {
		receiptVersion: 3,
		kind: 'operon-release-evidence-receipt',
		version: '3.2.0',
		candidateCommit,
		localValidation: { candidateCommit, trackedClean: true, node: '24.18.0', npm: '11.12.1', npmCi: 'passed', checkCandidate: 'passed', phase5: { passed: 1526, total: 1526 }, releaseGuard: 'passed-candidate-mode', audit: { status: 'accepted-clean', productionFindings: 0, developmentFindings: 0 }, artifact },
		hostedValidation: { candidateCommit, ci: proof('hasanyilmaz/operon', '.github/workflows/ci.yml', 101, 201, 'Validation gate'), codeql: proof('hasanyilmaz/operon', '.github/workflows/codeql.yml', 102, 202, 'CodeQL gate') },
		cli: { candidateCommit: 'b'.repeat(40), integratedCommit: binding.source.commit, integratedTree: 'c'.repeat(40), treeMatchesCandidate: true },
		windowsPairProof: { ...proof('hasanyilmaz/operon-cli', '.github/workflows/windows-pair-validation.yml', 103, 203, 'validate-pair'), headSha: 'b'.repeat(40), pluginCommit: candidateCommit, cliCandidateCommit: 'b'.repeat(40), pluginNative: { tests: 22, failed: 0, cancelled: 0, skipped: 0 }, cliHosted: { assertions: 4, skipped: 0 }, trackedClean: true },
		limitations: { liveDeployment: 'not-run', manualAcceptance: 'not-run-not-required', publishedCliLiveMutationSuite: 'not-rerun', cliInstalledInLiveVault: false },
	};
	const receiptPath = `${root}-receipt.json`;
	await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
	return { root, receiptPath, candidateCommit };
}

function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
function statusPaths(root) {
	return execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, encoding: 'utf8' })
		.split('\n').filter(Boolean).map(line => line.slice(3)).sort();
}

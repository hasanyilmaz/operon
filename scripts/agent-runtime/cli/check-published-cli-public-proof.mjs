import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	loadPublishedCliBinding,
	resolveNpmInvocation,
	sanitizedChildEnvironment,
	sha256,
	verifyCanonicalPluginInputs,
	verifyTarballIdentity,
} from './published-cli-v1.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const githubApiRoot = 'https://api.github.com/repos/hasanyilmaz/operon-cli';

export async function checkPublishedCliPublicProof(options = {}) {
	const loaded = await loadPublishedCliBinding(options);
	const { binding } = loaded;
	const npmPackagePath = binding.package.name.replaceAll('/', '%2f');
	const metadataUrl = `${binding.package.registry}${npmPackagePath}/${binding.package.version}`;
	await verifyCanonicalPluginInputs(binding, options);
	const metadata = await fetchJson(metadataUrl);
	assert.equal(metadata.name, binding.package.name, 'OPERON_PUBLISHED_CLI_PUBLIC_PACKAGE_NAME_MISMATCH');
	assert.equal(metadata.version, binding.package.version, 'OPERON_PUBLISHED_CLI_PUBLIC_PACKAGE_VERSION_MISMATCH');
	assert.equal(metadata.dist.tarball, binding.package.tarballUrl, 'OPERON_PUBLISHED_CLI_PUBLIC_TARBALL_URL_MISMATCH');
	assert.equal(metadata.dist.integrity, binding.tarball.integrity, 'OPERON_PUBLISHED_CLI_PUBLIC_INTEGRITY_MISMATCH');
	assert.equal(metadata.dist.shasum, binding.tarball.registryShasum, 'OPERON_PUBLISHED_CLI_PUBLIC_SHASUM_MISMATCH');
	assert.equal(metadata.dist.fileCount, binding.artifact.inventoryEntries, 'OPERON_PUBLISHED_CLI_PUBLIC_FILE_COUNT_MISMATCH');
	assert.equal(metadata.dist.attestations?.provenance?.predicateType, 'https://slsa.dev/provenance/v1');

	const releaseAssetRoot = `https://github.com/${binding.source.repository}/releases/download/${binding.source.tag}`;
	const [npmTarball, releaseTarball, artifactManifest, determinismReport, sha256sums] = await Promise.all([
		fetchBytes(binding.package.tarballUrl),
		fetchBytes(binding.source.releaseTarballUrl),
		fetchBytes(`${releaseAssetRoot}/artifact-manifest.json`),
		fetchBytes(`${releaseAssetRoot}/determinism-report.json`),
		fetchBytes(`${releaseAssetRoot}/SHA256SUMS`),
	]);
	assert.deepEqual(releaseTarball, npmTarball, 'OPERON_PUBLISHED_CLI_PUBLIC_TARBALL_PARITY_MISMATCH');
	verifyReleaseAsset(artifactManifest, binding.source.releaseAssets.artifactManifest, 'artifact-manifest.json');
	verifyReleaseAsset(determinismReport, binding.source.releaseAssets.determinismReport, 'determinism-report.json');
	verifyReleaseAsset(sha256sums, binding.source.releaseAssets.sha256sums, 'SHA256SUMS');
	const releaseManifest = JSON.parse(artifactManifest.toString('utf8'));
	assert.equal(releaseManifest.canonical?.tarball?.sha256, binding.tarball.sha256);
	assert.equal(releaseManifest.canonical?.tarball?.bytes, binding.tarball.bytes);
	assert.equal(releaseManifest.canonical?.inventory?.length, binding.artifact.inventoryEntries);
	assert.match(
		sha256sums.toString('utf8'),
		new RegExp(`^${binding.tarball.sha256}  operon-cli-${binding.package.version.replaceAll('.', '\\.')}\\.tgz$`, 'mu'),
		'OPERON_PUBLISHED_CLI_RELEASE_CHECKSUM_MISMATCH',
	);
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'operon-cli-public-proof-'));
	try {
		const npmTarballPath = path.join(temporaryRoot, `npm-operon-cli-${binding.package.version}.tgz`);
		const releaseTarballPath = path.join(temporaryRoot, `release-operon-cli-${binding.package.version}.tgz`);
		await Promise.all([
			writeFile(npmTarballPath, npmTarball, { mode: 0o600 }),
			writeFile(releaseTarballPath, releaseTarball, { mode: 0o600 }),
		]);
		await verifyTarballIdentity(npmTarballPath, binding);
		await verifyTarballIdentity(releaseTarballPath, binding);
		await verifyNpmAttestations(metadata.dist.attestations.url, binding);
		await verifyGithubIdentity(binding);
		await verifyGithubReleaseAttestation(releaseTarballPath, binding, options.env ?? process.env);
		await verifyNpmAuditSignatures(temporaryRoot, binding, options.env ?? process.env);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
	return Object.freeze({
		package: `${binding.package.name}@${binding.package.version}`,
		tarballSha256: binding.tarball.sha256,
		provenanceRun: binding.provenance.publishRun,
		releaseTag: binding.source.tag,
	});
}

async function verifyNpmAttestations(url, binding) {
	assert.equal(
		url,
		`https://registry.npmjs.org/-/npm/v1/attestations/${binding.package.name.replaceAll('/', '%2f')}@${binding.package.version}`,
	);
	const response = await fetchJson(url);
	const provenance = response.attestations?.find(item => item.predicateType === 'https://slsa.dev/provenance/v1');
	assert.ok(provenance, 'OPERON_PUBLISHED_CLI_PROVENANCE_MISSING');
	const payload = JSON.parse(Buffer.from(provenance.bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
	assert.equal(payload.predicateType, 'https://slsa.dev/provenance/v1');
	assert.equal(payload.subject?.length, 1, 'OPERON_PUBLISHED_CLI_PROVENANCE_SUBJECT_INVALID');
	assert.equal(
		payload.subject[0].name,
		`pkg:npm/${binding.package.name.replaceAll('@', '%40')}@${binding.package.version}`,
	);
	assert.equal(
		payload.subject[0].digest.sha512,
		Buffer.from(binding.tarball.sha512, 'base64').toString('hex'),
		'OPERON_PUBLISHED_CLI_PROVENANCE_DIGEST_MISMATCH',
	);
	const workflow = payload.predicate.buildDefinition.externalParameters.workflow;
	assert.equal(workflow.repository, 'https://github.com/hasanyilmaz/operon-cli');
	assert.equal(workflow.path, `.github/workflows/${binding.provenance.workflow}`);
	assert.equal(workflow.ref, binding.provenance.ref);
	assert.equal(
		payload.predicate.buildDefinition.resolvedDependencies?.[0]?.digest?.gitCommit,
		binding.provenance.commit,
	);
	assert.match(
		payload.predicate.runDetails.metadata.invocationId,
		new RegExp(`/actions/runs/${binding.provenance.publishRun}/attempts/1$`, 'u'),
	);
	return true;
}

async function verifyGithubIdentity(binding) {
	const tagRef = await fetchJson(`${githubApiRoot}/git/ref/tags/${binding.source.tag}`);
	assert.equal(tagRef.object.type, 'tag');
	assert.equal(tagRef.object.sha, binding.source.annotatedTagObject);
	const tag = await fetchJson(`${githubApiRoot}/git/tags/${binding.source.annotatedTagObject}`);
	assert.equal(tag.object.type, 'commit');
	assert.equal(tag.object.sha, binding.source.commit);
	const release = await fetchJson(`${githubApiRoot}/releases/tags/${binding.source.tag}`);
	assert.equal(release.tag_name, binding.source.tag);
	assert.equal(release.immutable, true, 'OPERON_PUBLISHED_CLI_RELEASE_NOT_IMMUTABLE');
	const asset = release.assets.find(item => item.name === `operon-cli-${binding.package.version}.tgz`);
	assert.ok(asset, 'OPERON_PUBLISHED_CLI_RELEASE_ASSET_MISSING');
	assert.equal(asset.size, binding.tarball.bytes);
	assert.equal(asset.digest, `sha256:${binding.tarball.sha256}`);
	for (const expected of [
		{
			runId: binding.provenance.canonicalHostedRun,
			path: '.github/workflows/hosted-validation.yml',
			headBranch: 'main',
		},
		{
			runId: binding.provenance.publishRun,
			path: `.github/workflows/${binding.provenance.workflow}`,
			headBranch: binding.source.tag,
		},
	]) {
		const run = await fetchJson(`${githubApiRoot}/actions/runs/${expected.runId}`);
		assert.equal(run.repository.full_name, binding.source.repository);
		assert.equal(run.head_sha, binding.source.commit);
		assert.equal(run.event, 'workflow_dispatch');
		assert.equal(run.conclusion, 'success');
		assert.equal(run.path, expected.path, 'OPERON_PUBLISHED_CLI_RUN_WORKFLOW_MISMATCH');
		assert.equal(run.head_branch, expected.headBranch, 'OPERON_PUBLISHED_CLI_RUN_REF_MISMATCH');
	}
	return true;
}

async function verifyGithubReleaseAttestation(assetPath, binding, env) {
	const repository = binding.source.repository;
	const release = spawnSync('gh', ['release', 'verify', binding.source.tag, '--repo', repository], {
		encoding: 'utf8',
		env: sanitizedChildEnvironment(env),
	});
	assertSpawnSucceeded(release, 'OPERON_PUBLISHED_CLI_GITHUB_RELEASE_VERIFY_FAILED');
	const asset = spawnSync(
		'gh',
		['release', 'verify-asset', binding.source.tag, assetPath, '--repo', repository],
		{ encoding: 'utf8', env: sanitizedChildEnvironment(env) },
	);
	assertSpawnSucceeded(asset, 'OPERON_PUBLISHED_CLI_GITHUB_ASSET_VERIFY_FAILED');
	return true;
}

async function verifyNpmAuditSignatures(temporaryRoot, binding, env) {
	const npm = await resolveNpmInvocation(env);
	await writeFile(path.join(temporaryRoot, 'package.json'), `${JSON.stringify({
		name: 'operon-cli-public-proof',
		private: true,
		version: '0.0.0',
		dependencies: { [binding.package.name]: binding.package.version },
	}, null, 2)}\n`, 'utf8');
	const childEnvironment = sanitizedChildEnvironment(env);
	childEnvironment.npm_config_cache = path.join(temporaryRoot, 'npm-cache');
	childEnvironment.NPM_CONFIG_USERCONFIG = path.join(temporaryRoot, 'empty.npmrc');
	childEnvironment.npm_config_registry = binding.package.registry;
	await writeFile(childEnvironment.NPM_CONFIG_USERCONFIG, '', { mode: 0o600 });
	const install = spawnSync(
		process.execPath,
		[npm.path, 'install', '--ignore-scripts', '--no-audit', '--no-fund'],
		{ cwd: temporaryRoot, encoding: 'utf8', env: childEnvironment },
	);
	assertSpawnSucceeded(install, 'OPERON_PUBLISHED_CLI_AUDIT_INSTALL_FAILED');
	const audit = spawnSync(
		process.execPath,
		[npm.path, 'audit', 'signatures'],
		{ cwd: temporaryRoot, encoding: 'utf8', env: childEnvironment },
	);
	assertSpawnSucceeded(audit, 'OPERON_PUBLISHED_CLI_AUDIT_SIGNATURES_FAILED');
	return true;
}

async function fetchJson(url) {
	const bytes = await fetchBytes(url, { accept: 'application/json' });
	return JSON.parse(bytes.toString('utf8'));
}

async function fetchBytes(url, headers = {}) {
	const response = await fetch(url, {
		headers: {
			...headers,
			'user-agent': 'operon-plugin-public-cli-proof/1',
		},
		redirect: 'follow',
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) throw new Error(`OPERON_PUBLISHED_CLI_FETCH_FAILED:${response.status}:${url}`);
	return Buffer.from(await response.arrayBuffer());
}

function verifyReleaseAsset(bytes, identity, name) {
	assert.equal(bytes.length, identity.bytes, `OPERON_PUBLISHED_CLI_RELEASE_ASSET_SIZE_MISMATCH:${name}`);
	assert.equal(sha256(bytes), identity.sha256, `OPERON_PUBLISHED_CLI_RELEASE_ASSET_HASH_MISMATCH:${name}`);
}

function assertSpawnSucceeded(result, code) {
	if (result.error) throw new Error(`${code}:${result.error.message}`);
	if (result.status !== 0) {
		const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
		throw new Error(`${code}:${result.status}\n${output}`);
	}
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	const result = await checkPublishedCliPublicProof();
	process.stdout.write(`${JSON.stringify({ status: 'ok', ...result })}\n`);
}

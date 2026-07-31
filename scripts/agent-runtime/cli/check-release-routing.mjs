#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const packageDocument = JSON.parse(
	await readFile(path.join(pluginRoot, 'packages/operon-cli/package.json'), 'utf8'),
);
const pluginWorkflow = await readFile(
	path.join(pluginRoot, '.github/workflows/release.yml'),
	'utf8',
);
const candidateWorkflow = await readFile(
	path.join(pluginRoot, '.github/workflows/cli-release-ready.yml'),
	'utf8',
);
const ciWorkflow = await readFile(
	path.join(pluginRoot, '.github/workflows/cli-ci.yml'),
	'utf8',
);
const nativeCandidateWorkflow = await readFile(
	path.join(pluginRoot, '.github/workflows/cli-native-candidate.yml'),
	'utf8',
);
const publishWorkflow = await readFile(
	path.join(pluginRoot, '.github/workflows/cli-publish.yml'),
	'utf8',
);
const liveAcceptanceWorkflow = await readFile(
	path.join(pluginRoot, '.github/workflows/cli-live-acceptance.yml'),
	'utf8',
);

assert.match(pluginWorkflow, /-\s+["']!cli-v\*["']/u);
assert.match(
	pluginWorkflow,
	/actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/u,
);
assert.match(
	pluginWorkflow,
	/actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/u,
);
assert.doesNotMatch(pluginWorkflow, /uses:\s+actions\/[^@\s]+@v[0-9]+/u);
assert.match(candidateWorkflow, /workflow_dispatch:/u);
assert.doesNotMatch(candidateWorkflow, /\bnpm publish\b/u);
assert.match(candidateWorkflow, /REQUIRE_CLEAN_SOURCE:\s*"1"/u);
assert.match(candidateWorkflow, /fetch-depth:\s*0/u);
assert.match(candidateWorkflow, /test "\$GITHUB_REF" = "refs\/tags\/\$SOURCE_REF"/u);
assert.match(candidateWorkflow, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/u);
assert.match(candidateWorkflow, /plugin_release_tag:/u);
assert.match(candidateWorkflow, /node-version:\s*"24\.18\.0"/u);
assert.match(candidateWorkflow, /test "\$\(node --version\)" = "v24\.18\.0"/u);
assert.match(candidateWorkflow, /npm install --global npm@11\.12\.1/u);
assert.match(candidateWorkflow, /gh release download "\$PLUGIN_RELEASE_TAG"/u);
assert.match(candidateWorkflow, /FROZEN_PLUGIN_VERSION/u);
assert.match(candidateWorkflow, /write-public-plugin-release-evidence\.mjs/u);
assert.match(candidateWorkflow, /REQUIRE_PUBLIC_PLUGIN_RELEASE:\s*"1"/u);
assert.match(candidateWorkflow, /subject-path:\s*"packages\/operon-cli\/release\/candidate-evidence\.json"/u);
assert.match(candidateWorkflow, /packages\/operon-cli\/release\/plugin-release\/main\.js/u);
assert.match(candidateWorkflow, /Build the canonical 9-cell hosted portability matrix/u);
assert.match(candidateWorkflow, /hostedPortabilityCellsV1/u);
assert.match(candidateWorkflow, /name:\s+operon-cli-hosted-portability/u);
assert.match(candidateWorkflow, /verify-hosted-candidate-install\.mjs/u);
const hostedTransportStep = /name:\s+Run platform transport and security checks\s*\n\s+timeout-minutes:\s*5\s*\n\s+run:\s+node scripts\/agent-runtime\/cli\/run-hosted-transport-security-tests\.mjs/u;
assert.match(candidateWorkflow, hostedTransportStep);
assert.match(ciWorkflow, hostedTransportStep);
assert.match(
	candidateWorkflow,
	/OPERON_CLI_CANDIDATE_ROOT:\s*\$\{\{\s*github\.workspace\s*\}\}\/candidate/u,
);
assert.match(candidateWorkflow, /npm run agent-runtime:cli:package/u);
assert.match(candidateWorkflow, /write-hosted-portability-evidence\.mjs/u);
assert.match(candidateWorkflow, /aggregate-hosted-portability\.mjs/u);
assert.match(candidateWorkflow, /verify-hosted-portability\.mjs/u);
assert.match(candidateWorkflow, /node-version:\s+\$\{\{\s*matrix\.node\s*\}\}/u);
assert.match(
	candidateWorkflow,
	/aggregate-hosted-portability:[\s\S]+?node-version:\s*"24\.18\.0"[\s\S]+?Pin aggregate npm[\s\S]+?npm install --global npm@11\.12\.1[\s\S]+?Verify aggregate toolchain[\s\S]+?test "\$\(node --version\)" = "v24\.18\.0"[\s\S]+?test "\$\(npm --version\)" = "11\.12\.1"[\s\S]+?- run: npm ci/u,
);
for (const runner of ['ubuntu-24.04', 'macos-15', 'windows-2025']) {
	assert.match(
		await readFile(
			path.join(pluginRoot, 'contracts/agent-runtime/native-acceptance-matrix-v1.json'),
			'utf8',
		),
		new RegExp(runner.replace('.', '\\.'), 'u'),
	);
}
assert.match(nativeCandidateWorkflow, /source_commit:/u);
assert.match(nativeCandidateWorkflow, /ref:\s+\$\{\{\s*inputs\.source_commit\s*\}\}/u);
assert.match(nativeCandidateWorkflow, /write-native-candidate-evidence\.mjs/u);
assert.match(nativeCandidateWorkflow, /operon-plugin-native-candidate/u);
assert.match(nativeCandidateWorkflow, /name:\s+operon-cli-native-candidate/u);
assert.doesNotMatch(nativeCandidateWorkflow, /\bnpm publish\b/u);
assert.doesNotMatch(nativeCandidateWorkflow, /refs\/tags\//u);
assert.match(liveAcceptanceWorkflow, /name:\s+Optional Operon CLI native desktop certification/u);
assert.match(liveAcceptanceWorkflow, /candidate_run_id:/u);
assert.match(liveAcceptanceWorkflow, /runs-on:\s+\$\{\{\s*matrix\.runner\s*\}\}/u);
assert.match(liveAcceptanceWorkflow, /environment:\s+cli-native-acceptance/u);
assert.match(liveAcceptanceWorkflow, /node-version:\s+\$\{\{\s*matrix\.node\s*\}\}/u);
assert.match(liveAcceptanceWorkflow, /npm install --global npm@11\.12\.1/u);
assert.match(liveAcceptanceWorkflow, /ref:\s+\$\{\{\s*inputs\.source_commit\s*\}\}/u);
assert.match(liveAcceptanceWorkflow, /OPERON_ACCEPTANCE_ALLOW_APP_LAUNCH:\s*"0"/u);
assert.match(liveAcceptanceWorkflow, /OPERON_ACCEPTANCE_HEADLESS:\s*"0"/u);
assert.match(liveAcceptanceWorkflow, /OPERON_ACCEPTANCE_MUTATION_HOOK/u);
assert.match(liveAcceptanceWorkflow, /OPERON_ACCEPTANCE_NATIVE_PROOF_HOOK/u);
assert.match(liveAcceptanceWorkflow, /native-acceptance-\$\{\{\s*matrix\.cellId\s*\}\}\.json/u);
assert.match(liveAcceptanceWorkflow, /aggregate-native-acceptance\.mjs/u);
assert.match(liveAcceptanceWorkflow, /path:\s+acceptance\/cells/u);
assert.match(
	liveAcceptanceWorkflow,
	/actions\/attest-build-provenance@e8998f949152b193b063cb0ec769d69d929409be/u,
);
assert.match(liveAcceptanceWorkflow, /secrets\[matrix\.vaultSecret\]/u);
assert.match(liveAcceptanceWorkflow, /--candidate-evidence candidate\/candidate-evidence\.json/u);
assert.match(
	liveAcceptanceWorkflow,
	/--public-plugin-root candidate\/operon-plugin-native-candidate/u,
);
assert.match(liveAcceptanceWorkflow, /gh attestation verify candidate\/candidate-evidence\.json/u);
assert.doesNotMatch(liveAcceptanceWorkflow, /\bvault_path:/u);
assert.match(
	liveAcceptanceWorkflow,
	/--signer-workflow\s+"\$\{\{\s*github\.repository\s*\}\}\/\.github\/workflows\/cli-native-candidate\.yml"/u,
);
assert.match(publishWorkflow, /name:\s+\$\{\{[^}]+npm-bootstrap[^}]+npm[^}]+\}\}/u);
assert.match(publishWorkflow, /authentication_mode:/u);
assert.match(publishWorkflow, /node-version:\s*"24\.18\.0"/u);
assert.match(publishWorkflow, /test "\$\(node --version\)" = "v24\.18\.0"/u);
assert.match(publishWorkflow, /npm install --global npm@11\.12\.1/u);
assert.match(publishWorkflow, /test "\$GITHUB_REF" = "refs\/tags\/\$SOURCE_REF"/u);
assert.match(publishWorkflow, /ref:\s+refs\/tags\/\$\{\{\s*inputs\.source_ref\s*\}\}/u);
assert.match(
	publishWorkflow,
	/npm publish candidate\/\*\.tgz[\s\S]+--access public[\s\S]+--tag latest[\s\S]+--provenance/u,
);
assert.match(publishWorkflow, /secrets\.NPM_TOKEN/u);
assert.match(publishWorkflow, /bootstrap-token is only allowed while operon-cli is unpublished/u);
assert.match(publishWorkflow, /npm view operon-cli@latest version/u);
assert.match(publishWorkflow, /d\.latest===process\.argv\[2\]/u);
assert.match(publishWorkflow, /Capture the isolated beta channel before stable publication/u);
assert.match(
	publishWorkflow,
	/if test "\$AUTHENTICATION_MODE" = "trusted-publisher"; then[\s\S]+DIST_TAGS="\$\(npm view operon-cli dist-tags/u,
);
assert.match(publishWorkflow, /npm dist-tags could not be verified before bootstrap publication/u);
assert.match(publishWorkflow, /beta===process\.argv\[2\]/u);
assert.match(publishWorkflow, /npm pack operon-cli@latest/u);
assert.match(publishWorkflow, /verify-published-release\.mjs/u);
assert.match(publishWorkflow, /npm audit signatures --registry https:\/\/registry\.npmjs\.org\//u);
assert.match(publishWorkflow, /id:\s+registry_version/u);
assert.match(publishWorkflow, /steps\.registry_version\.outputs\.version/u);
assert.doesNotMatch(publishWorkflow, /env\.EXPECTED_PACKAGE_VERSION/u);
for (const commandPattern of [
	/npm view operon-cli version --json --registry https:\/\/registry\.npmjs\.org\//u,
	/npm view operon-cli@latest version --registry https:\/\/registry\.npmjs\.org\//u,
	/npm view operon-cli dist-tags --json --registry https:\/\/registry\.npmjs\.org\//u,
	/npm publish candidate\/\*\.tgz[\s\S]+--registry https:\/\/registry\.npmjs\.org\//u,
]) {
	assert.match(publishWorkflow, commandPattern);
}
assert.match(publishWorkflow, /REQUIRE_PUBLIC_PLUGIN_RELEASE:\s*"1"/u);
assert.match(publishWorkflow, /EXPECTED_SHA256/u);
assert.match(publishWorkflow, /verify-release-candidate\.mjs/u);
assert.match(publishWorkflow, /verify-hosted-portability\.mjs/u);
assert.doesNotMatch(publishWorkflow, /verify-native-acceptance\.mjs/u);
assert.doesNotMatch(publishWorkflow, /verify-live-acceptance\.mjs/u);
assert.match(publishWorkflow, /gh attestation verify candidate\/\*\.tgz/u);
assert.match(publishWorkflow, /gh attestation verify candidate\/candidate-evidence\.json/u);
assert.match(publishWorkflow, /name:\s+operon-cli-hosted-portability/u);
assert.match(publishWorkflow, /gh attestation verify acceptance\/hosted-portability-index\.json/u);
assert.doesNotMatch(publishWorkflow, /acceptance_run_id/u);
assert.doesNotMatch(publishWorkflow, /native-acceptance-index\.json/u);
assert.match(publishWorkflow, /Reverify compatible public plugin availability and digest/u);
assert.match(publishWorkflow, /verify-public-plugin-release-evidence\.mjs/u);
assert.match(
	publishWorkflow,
	/--signer-workflow\s+"\$GITHUB_REPOSITORY\/\.github\/workflows\/cli-release-ready\.yml"/u,
);
assert.match(
	publishWorkflow,
	/--signer-workflow\s+"\$GITHUB_REPOSITORY\/\.github\/workflows\/cli-release-ready\.yml"/u,
);
for (const [name, workflow] of [
	['candidate', candidateWorkflow],
	['native candidate', nativeCandidateWorkflow],
	['live acceptance', liveAcceptanceWorkflow],
	['publish', publishWorkflow],
]) {
	assert.doesNotMatch(
		workflow,
		/uses:\s+actions\/[^@\s]+@v[0-9]+/u,
		`${name} workflow contains a floating release-critical action reference.`,
	);
}

const checker = path.join(scriptDirectory, 'check-release-tag.mjs');
const exactTag = `cli-v${packageDocument.version}`;
const accepted = spawnSync(process.execPath, [checker], {
	cwd: pluginRoot,
	encoding: 'utf8',
	env: {
		...process.env,
		GITHUB_REF: `refs/tags/${exactTag}`,
		GITHUB_REF_NAME: exactTag,
		GITHUB_REF_TYPE: 'tag',
	},
});
assert.equal(accepted.status, 0, accepted.stderr);

const pullRequest = spawnSync(process.execPath, [checker], {
	cwd: pluginRoot,
	encoding: 'utf8',
	env: {
		...process.env,
		GITHUB_REF: 'refs/pull/87/merge',
		GITHUB_REF_NAME: '87/merge',
		GITHUB_REF_TYPE: 'branch',
	},
});
assert.equal(pullRequest.status, 0, pullRequest.stderr);

for (const invalidTag of [
	packageDocument.version,
	`v${packageDocument.version}`,
	'cli-v0.0.0',
	'cli-v1.0.0-beta.1',
	'cli-v0.1.0-beta.11-extra',
]) {
	const rejected = spawnSync(process.execPath, [checker], {
		cwd: pluginRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			GITHUB_REF: `refs/tags/${invalidTag}`,
			GITHUB_REF_NAME: invalidTag,
			GITHUB_REF_TYPE: 'tag',
		},
	});
	assert.notEqual(rejected.status, 0, `Release checker accepted invalid tag ${invalidTag}.`);
}

const pluginEvidenceRoot = await mkdtemp(path.join(tmpdir(), 'operon-plugin-release-evidence-'));
const registryRoundTripRoot = await mkdtemp(path.join(tmpdir(), 'operon-cli-registry-roundtrip-'));
let sanitizedVault;
try {
	const pluginBuild = spawnSync(
		process.execPath,
		['esbuild.config.mjs', 'production'],
		{ cwd: pluginRoot, encoding: 'utf8' },
	);
	assert.equal(pluginBuild.status, 0, pluginBuild.stderr);
	const pluginArtifacts = path.join(pluginEvidenceRoot, 'artifacts');
	await mkdir(pluginArtifacts);
	for (const artifact of ['main.js', 'manifest.json', 'styles.css']) {
		await copyFile(path.join(pluginRoot, artifact), path.join(pluginArtifacts, artifact));
	}
	const publicV1Freeze = JSON.parse(await readFile(
		path.join(pluginRoot, 'contracts/agent-runtime/public-v1-freeze.json'),
		'utf8',
	));
	const frozenPluginVersion = publicV1Freeze.plugin.version;
	const pluginEvidence = path.join(pluginEvidenceRoot, 'evidence.json');
	const evidenceWriter = path.join(scriptDirectory, 'write-public-plugin-release-evidence.mjs');
	const written = spawnSync(
		process.execPath,
		[evidenceWriter, pluginArtifacts, frozenPluginVersion, pluginEvidence],
		{ cwd: pluginRoot, encoding: 'utf8' },
	);
	if (publicV1Freeze.state === 'accepted') {
		assert.equal(written.status, 0, written.stderr);
		const evidence = JSON.parse(await readFile(pluginEvidence, 'utf8'));
		assert.equal(evidence.evidenceVersion, 2);
		assert.equal(evidence.kind, 'operon-public-plugin-release');
		assert.equal(evidence.pluginVersion, frozenPluginVersion);
		assert.deepEqual(evidence.publicV1Freeze.runtimeApi, { min: 1, max: 1 });
		assert.match(evidence.mainJsSha256, /^[a-f0-9]{64}$/u);
		assert.match(evidence.stylesCssSha256, /^[a-f0-9]{64}$/u);
	} else {
		assert.notEqual(
			written.status,
			0,
			'Plugin evidence accepted artifacts without an accepted Public V1 freeze.',
		);
	}
	const mismatched = spawnSync(
		process.execPath,
		[evidenceWriter, pluginArtifacts, '9.8.8', pluginEvidence],
		{ cwd: pluginRoot, encoding: 'utf8' },
	);
	assert.notEqual(mismatched.status, 0, 'Plugin evidence accepted a tag/version mismatch.');
	await writeFile(path.join(pluginArtifacts, 'main.js'), 'tampered-plugin-bundle\n', 'utf8');
	const tamperedArtifact = spawnSync(
		process.execPath,
		[evidenceWriter, pluginArtifacts, frozenPluginVersion, pluginEvidence],
		{ cwd: pluginRoot, encoding: 'utf8' },
	);
	assert.notEqual(
		tamperedArtifact.status,
		0,
		'Plugin evidence accepted an artifact outside the Public V1 freeze.',
	);
	await copyFile(path.join(pluginRoot, 'main.js'), path.join(pluginArtifacts, 'main.js'));
	sanitizedVault = path.join(
		await realpath(process.platform === 'darwin' ? '/private/tmp' : tmpdir()),
		`operon-agent-runtime-phase1-artifact-${process.pid}`,
	);
	const sanitizedGenerator = path.join(
		pluginRoot,
		'scripts/agent-runtime/create-sanitized-vault.mjs',
	);
	const generated = spawnSync(
		process.execPath,
		[sanitizedGenerator, '--production', sanitizedVault],
		{
			cwd: pluginRoot,
			encoding: 'utf8',
			env: {
				...process.env,
				OPERON_SANITIZED_PLUGIN_ARTIFACT_ROOT: pluginArtifacts,
			},
		},
	);
	assert.equal(generated.status, 0, generated.stderr);
	assert.equal(
		createHash('sha256')
			.update(await readFile(path.join(sanitizedVault, '.obsidian/plugins/operon/main.js')))
			.digest('hex'),
		publicV1Freeze.plugin.main.sha256,
	);
	assert.equal(
		createHash('sha256')
			.update(await readFile(path.join(sanitizedVault, '.obsidian/plugins/operon/styles.css')))
			.digest('hex'),
		publicV1Freeze.plugin.styles.sha256,
	);

	const candidateRoot = path.join(registryRoundTripRoot, 'candidate');
	const registryRoot = path.join(registryRoundTripRoot, 'registry');
	await mkdir(candidateRoot);
	await mkdir(registryRoot);
	const tarballName = 'operon-cli-9.8.7.tgz';
	const candidateTarball = path.join(candidateRoot, tarballName);
	const registryTarball = path.join(registryRoot, tarballName);
	await writeFile(candidateTarball, 'accepted-registry-tarball\n', 'utf8');
	await copyFile(candidateTarball, registryTarball);
	const candidateSha256 = createHash('sha256')
		.update(await readFile(candidateTarball))
		.digest('hex');
	await writeFile(
		path.join(candidateRoot, 'candidate-evidence.json'),
		`${JSON.stringify({
			kind: 'operon-cli-release-candidate',
			package: 'operon-cli@9.8.7',
			tarball: tarballName,
			sha256: candidateSha256,
		}, null, 2)}\n`,
		'utf8',
	);
	const registryVerifier = path.join(scriptDirectory, 'verify-published-release.mjs');
	const verifiedRoundTrip = spawnSync(
		process.execPath,
		[registryVerifier, candidateRoot, registryRoot],
		{
			cwd: pluginRoot,
			encoding: 'utf8',
			env: {
				...process.env,
				EXPECTED_VERSION: '9.8.7',
				EXPECTED_SHA256: candidateSha256,
			},
		},
	);
	assert.equal(verifiedRoundTrip.status, 0, verifiedRoundTrip.stderr);
	await writeFile(registryTarball, 'different-registry-tarball\n', 'utf8');
	const rejectedRoundTrip = spawnSync(
		process.execPath,
		[registryVerifier, candidateRoot, registryRoot],
		{ cwd: pluginRoot, encoding: 'utf8' },
	);
	assert.notEqual(
		rejectedRoundTrip.status,
		0,
		'Registry round-trip verifier accepted mismatched tarball bytes.',
	);
} finally {
	if (sanitizedVault) await rm(sanitizedVault, { recursive: true, force: true });
	await rm(pluginEvidenceRoot, { recursive: true, force: true });
	await rm(registryRoundTripRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({
	status: 'ok',
	pluginTagsExcludeCli: true,
	expectedCliTag: exactTag,
	candidatePublishes: false,
	hostedPortabilityAttested: true,
	nativeDesktopCertificationRequired: false,
	publicPluginArtifactBound: true,
	acceptedPublicV1FreezeRequired: true,
	releaseNode: 24,
	releaseNpm: '11.12.1',
	publishRequiresEnvironments: ['npm-bootstrap', 'npm'],
	publishDistTag: 'latest',
	betaChannelIsolated: true,
	registryRoundTripVerified: true,
	registrySignaturesAndProvenanceRequired: true,
}, null, 2)}\n`);

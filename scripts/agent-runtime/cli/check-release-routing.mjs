#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	realpath,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const packageDocument = JSON.parse(
	await readFile(path.join(pluginRoot, 'packages/operon-cli/package.json'), 'utf8'),
);
const pluginManifest = JSON.parse(
	await readFile(path.join(pluginRoot, 'manifest.json'), 'utf8'),
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
const candidateEvidenceWriter = await readFile(
	path.join(pluginRoot, 'scripts/agent-runtime/cli/write-release-candidate-evidence.mjs'),
	'utf8',
);

const workflowRoot = path.join(pluginRoot, '.github/workflows');
const workflowFiles = (await readdir(workflowRoot))
	.filter(file => file.endsWith('.yml') || file.endsWith('.yaml'))
	.sort();
const exactCheckoutRevision = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const exactSetupNodeRevision = '820762786026740c76f36085b0efc47a31fe5020';
const exactWorkflowPermissions = new Map([
	['ci.yml', ['contents: read']],
	['cli-ci.yml', ['contents: read']],
	['cli-live-acceptance.yml', ['actions: read', 'attestations: write', 'contents: read', 'id-token: write']],
	['cli-native-candidate.yml', ['attestations: write', 'contents: read', 'id-token: write']],
	['cli-publish.yml', ['actions: read', 'attestations: read', 'contents: read', 'id-token: write']],
	['cli-release-ready.yml', ['contents: read', 'id-token: write', 'attestations: write']],
	['codeql.yml', ['actions: read', 'contents: read', 'security-events: write']],
	['release.yml', ['contents: write', 'id-token: write', 'attestations: write']],
]);
for (const file of workflowFiles) {
	const workflow = await readFile(path.join(workflowRoot, file), 'utf8');
	const expectedPermissions = exactWorkflowPermissions.get(file);
	assert.ok(expectedPermissions, `${file}: workflow lacks an approved permission policy.`);
	const permissionsMatch = workflow.match(/^permissions:\s*\n((?:  [a-z-]+:\s+(?:read|write)\s*\n)+)/mu);
	assert.ok(permissionsMatch, `${file}: workflow must declare top-level explicit permissions.`);
	assert.deepEqual(
		permissionsMatch[1].trim().split(/\r?\n/u).map(line => line.trim()),
		expectedPermissions,
		`${file}: workflow permissions drifted from the least-privilege allowlist.`,
	);
	const lines = workflow.split(/\r?\n/u);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const actionMatch = line.match(/uses:\s+([^@\s]+)@([^\s#]+)/u);
		if (!actionMatch) continue;
		const [, action, revision] = actionMatch;
		assert.match(
			revision,
			/^[a-f0-9]{40}$/u,
			`${file}:${index + 1}: ${action} must use an immutable 40-character revision.`,
		);
		if (action === 'actions/checkout') {
			assert.equal(revision, exactCheckoutRevision, `${file}:${index + 1}: checkout revision drifted.`);
		}
		if (action === 'actions/setup-node') {
			assert.equal(revision, exactSetupNodeRevision, `${file}:${index + 1}: setup-node revision drifted.`);
		}
		if (action !== 'actions/checkout') continue;
		const usesIndent = line.length - line.trimStart().length;
		const stepIndent = line.trimStart().startsWith('- uses:')
			? usesIndent
			: Math.max(0, usesIndent - 2);
		const block = [line];
		for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
			const candidate = lines[cursor];
			const indent = candidate.length - candidate.trimStart().length;
			if (indent <= stepIndent && candidate.trimStart().startsWith('- ')) break;
			block.push(candidate);
		}
		assert.ok(
			block.some(candidate => /^\s+persist-credentials:\s+false\s*(?:#.*)?$/u.test(candidate)),
			`${file}:${index + 1}: checkout must set persist-credentials: false.`,
		);
	}
}
assert.equal(
	exactWorkflowPermissions.size,
	workflowFiles.length,
	'Workflow permission policy must cover every checked-in workflow.',
);
assert.match(
	ciWorkflow,
	/^permissions:\s*\n\s{2}contents:\s+read\s*$/mu,
	'CLI CI must explicitly grant only contents: read.',
);
assert.doesNotMatch(ciWorkflow, /OPERON_PLUGIN_RELEASE_VALIDATION/u);

assert.match(pluginWorkflow, /-\s+["']!cli-v\*["']/u);
assert.match(
	pluginWorkflow,
	/- name: Run validation\s+env:\s+OPERON_PLUGIN_RELEASE_VALIDATION: "1"\s+OPERON_TASK_FINDER_PERFORMANCE_MODE: diagnostic\s+run: npm run check/u,
);
assert.match(
	pluginWorkflow,
	/actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/u,
);
assert.match(
	pluginWorkflow,
	/actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/u,
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
assert.match(candidateWorkflow, /name:\s+Bind pinned Windows npm CLI/u);
assert.match(candidateWorkflow, /OPERON_ACCEPTANCE_NPM_CLI_JS=\$npmCli/u);
assert.match(candidateWorkflow, /Pinned npm prefix lookup failed with exit code/u);
assert.match(candidateWorkflow, /Pinned npm CLI execution failed with exit code/u);
assert.match(candidateWorkflow, /name:\s+Verify exact helper npm identity/u);
assert.match(candidateWorkflow, /execNpmV1\(\['--version'\], \{ encoding: 'utf8' \}\)/u);
assert.match(liveAcceptanceWorkflow, /name:\s+Bind pinned Windows npm CLI/u);
assert.match(liveAcceptanceWorkflow, /OPERON_ACCEPTANCE_NPM_CLI_JS=\$npmCli/u);
assert.match(liveAcceptanceWorkflow, /Pinned npm prefix lookup failed with exit code/u);
assert.match(liveAcceptanceWorkflow, /Pinned npm CLI execution failed with exit code/u);
assert.match(liveAcceptanceWorkflow, /name:\s+Verify exact npm version/u);
assert.match(liveAcceptanceWorkflow, /test "\$\(npm --version\)" = "11\.12\.1"/u);
assert.match(liveAcceptanceWorkflow, /name:\s+Verify exact helper npm identity/u);
for (const [workflowName, workflowText, markers] of [
	[
		'candidate',
		candidateWorkflow,
		[
			'Pin portability npm',
			'Bind pinned Windows npm CLI',
			'OPERON_ACCEPTANCE_NPM_CLI_JS=$npmCli',
			'Verify exact npm version',
			'Verify exact helper npm identity',
			"execNpmV1(['--version'], { encoding: 'utf8' })",
			'- run: npm ci',
		],
	],
	[
		'live acceptance',
		liveAcceptanceWorkflow,
		[
			'Pin acceptance npm',
			'Bind pinned Windows npm CLI',
			'OPERON_ACCEPTANCE_NPM_CLI_JS=$npmCli',
			'Verify exact npm version',
			'Verify exact helper npm identity',
			"execNpmV1(['--version'], { encoding: 'utf8' })",
			'- run: npm ci',
		],
	],
]) {
	let previousIndex = -1;
	for (const marker of markers) {
		const markerIndex = workflowText.indexOf(marker, previousIndex + 1);
		assert.ok(
			markerIndex > previousIndex,
			`${workflowName} npm identity step is missing or out of order: ${marker}`,
		);
		previousIndex = markerIndex;
	}
}
const candidatePackStep = candidateWorkflow.match(
	/^      - name: Materialize the accepted frozen candidate tarball\s*\n(?:(?!^      - ).*(?:\n|$))*/mu,
)?.[0];
assert.ok(candidatePackStep, 'Candidate workflow must materialize the accepted frozen tarball.');
assert.match(candidatePackStep, /materialize-frozen-candidate\.mjs/u);
assert.match(candidatePackStep, /packages\/operon-cli\/release/u);
assert.doesNotMatch(candidatePackStep, /npm pack|rm -rf/u);
assert.match(candidateWorkflow, /gh release download "\$PLUGIN_RELEASE_TAG"/u);
assert.match(candidateWorkflow, /FROZEN_PLUGIN_VERSION/u);
assert.match(candidateWorkflow, /write-public-plugin-release-evidence\.mjs/u);
assert.match(candidateWorkflow, /REQUIRE_PUBLIC_PLUGIN_RELEASE:\s*"1"/u);
assert.match(candidateWorkflow, /subject-path:\s*"packages\/operon-cli\/release\/candidate-evidence\.json"/u);
assert.match(
	candidateWorkflow,
	/Verify public plugin evidence round trip before attestation[\s\S]+verify-public-plugin-release-evidence\.mjs/u,
);
assert.match(
	candidateEvidenceWriter,
	/evidenceVersion:\s*pluginReleaseEvidence\.evidenceVersion/u,
	'Candidate evidence must preserve the public plugin evidence version.',
);
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
const publishStepPattern = /npm publish \.\/candidate\/\*\.tgz[\s\S]+--access public[\s\S]+--tag latest[\s\S]+--provenance/u;
for (const [stepName, authenticationMode] of [
	['Publish first approved stable release with temporary token and provenance', 'bootstrap-token'],
	['Publish approved stable release through npm trusted publishing', 'trusted-publisher'],
]) {
	const escapedStepName = stepName.replace(/[.*+?^\${}()|[\]\\]/gu, '\\$&');
	const stepBlock = publishWorkflow.match(
		new RegExp(`- name: ${escapedStepName}\\n[\\s\\S]*?(?=\\n\\s+- name: )`, 'u'),
	)?.[0];
	assert.ok(stepBlock, `Missing ${authenticationMode} publish step.`);
	assert.match(stepBlock, new RegExp(`if: inputs\\.authentication_mode == '${authenticationMode}'`, 'u'));
	assert.match(stepBlock, publishStepPattern);
	assert.equal(
		stepBlock.match(/npm publish \.\/candidate\/\*\.tgz/gu)?.length,
		1,
		`The ${authenticationMode} step must publish exactly one explicit local tarball path.`,
	);
}
assert.doesNotMatch(
	publishWorkflow,
	/npm publish candidate\/\*\.tgz/u,
	'Bare relative tarball paths can be misinterpreted as GitHub shorthand by npm.',
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
	/npm publish \.\/candidate\/\*\.tgz[\s\S]+--registry https:\/\/registry\.npmjs\.org\//u,
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
const checkerEnvironment = { ...process.env };
delete checkerEnvironment.OPERON_PLUGIN_RELEASE_VALIDATION;
delete checkerEnvironment.REQUIRE_EXACT_GIT_TAG;
const accepted = spawnSync(process.execPath, [checker], {
	cwd: pluginRoot,
	encoding: 'utf8',
	env: {
		...checkerEnvironment,
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
		...checkerEnvironment,
		GITHUB_REF: 'refs/pull/87/merge',
		GITHUB_REF_NAME: '87/merge',
		GITHUB_REF_TYPE: 'branch',
	},
});
assert.equal(pullRequest.status, 0, pullRequest.stderr);

const pluginRelease = spawnSync(process.execPath, [checker], {
	cwd: pluginRoot,
	encoding: 'utf8',
	env: {
		...checkerEnvironment,
		GITHUB_REF: `refs/tags/${pluginManifest.version}`,
		GITHUB_REF_NAME: pluginManifest.version,
		GITHUB_REF_TYPE: 'tag',
		OPERON_PLUGIN_RELEASE_VALIDATION: '1',
	},
});
assert.equal(pluginRelease.status, 0, pluginRelease.stderr);

for (const [name, environment] of [
	['plugin tag without release mode', {
		GITHUB_REF: `refs/tags/${pluginManifest.version}`,
		GITHUB_REF_NAME: pluginManifest.version,
		GITHUB_REF_TYPE: 'tag',
	}],
	['CLI tag in plugin release mode', {
		GITHUB_REF: `refs/tags/${exactTag}`,
		GITHUB_REF_NAME: exactTag,
		GITHUB_REF_TYPE: 'tag',
		OPERON_PLUGIN_RELEASE_VALIDATION: '1',
	}],
	['wrong plugin tag in release mode', {
		GITHUB_REF: 'refs/tags/0.0.0',
		GITHUB_REF_NAME: '0.0.0',
		GITHUB_REF_TYPE: 'tag',
		OPERON_PLUGIN_RELEASE_VALIDATION: '1',
	}],
	['branch in plugin release mode', {
		GITHUB_REF: 'refs/heads/main',
		GITHUB_REF_NAME: 'main',
		GITHUB_REF_TYPE: 'branch',
		OPERON_PLUGIN_RELEASE_VALIDATION: '1',
	}],
	['inconsistent plugin release ref', {
		GITHUB_REF: `refs/tags/${pluginManifest.version}-other`,
		GITHUB_REF_NAME: pluginManifest.version,
		GITHUB_REF_TYPE: 'tag',
		OPERON_PLUGIN_RELEASE_VALIDATION: '1',
	}],
	['plugin and exact CLI release modes together', {
		GITHUB_REF: `refs/tags/${pluginManifest.version}`,
		GITHUB_REF_NAME: pluginManifest.version,
		GITHUB_REF_TYPE: 'tag',
		OPERON_PLUGIN_RELEASE_VALIDATION: '1',
		REQUIRE_EXACT_GIT_TAG: '1',
	}],
]) {
	const rejected = spawnSync(process.execPath, [checker], {
		cwd: pluginRoot,
		encoding: 'utf8',
		env: { ...checkerEnvironment, ...environment },
	});
	assert.notEqual(rejected.status, 0, `Release checker accepted ${name}.`);
}

for (const invalidTag of [
	packageDocument.version,
	`v${packageDocument.version}`,
	'cli-v0.0.0',
	`cli-v${packageDocument.version}-beta.1`,
	'cli-v0.1.0-beta.11-extra',
]) {
	const rejected = spawnSync(process.execPath, [checker], {
		cwd: pluginRoot,
		encoding: 'utf8',
		env: {
			...checkerEnvironment,
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
		const projectedCandidatePath = path.join(pluginEvidenceRoot, 'candidate-evidence.json');
		const projectedPlugin = {
			evidenceVersion: evidence.evidenceVersion,
			kind: evidence.kind,
			releaseTag: evidence.releaseTag,
			pluginId: evidence.pluginId,
			pluginVersion: evidence.pluginVersion,
			mainJsSha256: evidence.mainJsSha256,
			manifestSha256: evidence.manifestSha256,
			stylesCssSha256: evidence.stylesCssSha256,
		};
		await writeFile(projectedCandidatePath, `${JSON.stringify({
			compatiblePublicPlugin: projectedPlugin,
			publicV1Freeze: evidence.publicV1Freeze,
		}, null, 2)}\n`, 'utf8');
		const pluginVerifier = path.join(
			scriptDirectory,
			'verify-public-plugin-release-evidence.mjs',
		);
		const verifiedProjection = spawnSync(
			process.execPath,
			[pluginVerifier, projectedCandidatePath, pluginArtifacts],
			{ cwd: pluginRoot, encoding: 'utf8' },
		);
		assert.equal(verifiedProjection.status, 0, verifiedProjection.stderr);
		delete projectedPlugin.evidenceVersion;
		await writeFile(projectedCandidatePath, `${JSON.stringify({
			compatiblePublicPlugin: projectedPlugin,
			publicV1Freeze: evidence.publicV1Freeze,
		}, null, 2)}\n`, 'utf8');
		const missingEvidenceVersion = spawnSync(
			process.execPath,
			[pluginVerifier, projectedCandidatePath, pluginArtifacts],
			{ cwd: pluginRoot, encoding: 'utf8' },
		);
		assert.notEqual(
			missingEvidenceVersion.status,
			0,
			'Plugin release verifier accepted a compact binding without evidenceVersion.',
		);
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

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	chmod,
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	acceptedFreezeControl,
	checkPublicV1FreezeIndex,
	preparePublicV1FreezeArtifacts,
	resolveNpmPackInvocation,
	runReleaseAuditForFreeze,
	writeCanonicalCliTarball,
	writePublicV1FreezeIndex,
} from './public-v1-freeze.mjs';
import { installDeclarationTreeV1 } from '../../../packages/operon-cli/type-build.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PASSED_AUDIT_RESULT = Object.freeze({
	status: 'accepted-clean',
	productionVulnerabilities: 0,
	developmentVulnerabilities: 0,
	directRoot: 'eslint-plugin-obsidianmd',
});

test('type declaration swap restores the last good tree when installation fails', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-type-swap-'));
	const stagingRoot = path.join(root, 'staging');
	const generatedRoot = path.join(stagingRoot, 'types');
	const destinationRoot = path.join(root, 'types');
	try {
		await mkdir(generatedRoot, { recursive: true });
		await mkdir(destinationRoot, { recursive: true });
		await writeFile(path.join(generatedRoot, 'index.d.ts'), 'export type Next = true;\n');
		await writeFile(path.join(destinationRoot, 'index.d.ts'), 'export type Current = true;\n');
		let renameCalls = 0;
		await assert.rejects(
			installDeclarationTreeV1(generatedRoot, destinationRoot, {
				renamePath: async (source, target) => {
					renameCalls += 1;
					if (renameCalls === 2) {
						const error = new Error('fixture install failure');
						error.code = 'EACCES';
						throw error;
					}
					await rename(source, target);
				},
			}),
			/fixture install failure/u,
		);
		assert.equal(renameCalls, 3);
		assert.equal(
			await readFile(path.join(destinationRoot, 'index.d.ts'), 'utf8'),
			'export type Current = true;\n',
		);
		assert.equal(
			await readFile(path.join(generatedRoot, 'index.d.ts'), 'utf8'),
			'export type Next = true;\n',
		);
		assert.deepEqual(
			(await readdir(root)).filter(entry => entry.startsWith('.operon-cli-types-backup-')),
			[],
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('type declaration swap preserves the last good tree when rollback also fails', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-type-rescue-'));
	const stagingRoot = path.join(root, 'staging');
	const generatedRoot = path.join(stagingRoot, 'types');
	const destinationRoot = path.join(root, 'types');
	try {
		await mkdir(generatedRoot, { recursive: true });
		await mkdir(destinationRoot, { recursive: true });
		await writeFile(path.join(generatedRoot, 'index.d.ts'), 'export type Next = true;\n');
		await writeFile(path.join(destinationRoot, 'index.d.ts'), 'export type Current = true;\n');
		let renameCalls = 0;
		let failure;
		try {
			await installDeclarationTreeV1(generatedRoot, destinationRoot, {
				renamePath: async (source, target) => {
					renameCalls += 1;
					if (renameCalls >= 2) {
						const error = new Error(`fixture rename failure ${renameCalls}`);
						error.code = 'EACCES';
						throw error;
					}
					await rename(source, target);
				},
			});
		} catch (error) {
			failure = error;
		}
		assert.ok(failure instanceof AggregateError);
		assert.equal(failure.message, 'OPERON_CLI_TYPE_INSTALL_ROLLBACK_FAILED');
		assert.equal(renameCalls, 3);
		assert.equal(
			await readFile(path.join(failure.recoveryPath, 'index.d.ts'), 'utf8'),
			'export type Current = true;\n',
		);
		await rm(stagingRoot, { recursive: true, force: true });
		assert.equal(
			await readFile(path.join(failure.recoveryPath, 'index.d.ts'), 'utf8'),
			'export type Current = true;\n',
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('npm pack invocation is shell-free and fail-closed across platforms', () => {
	assert.deepEqual(resolveNpmPackInvocation({
		npmExecPath: ' C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js ',
		platform: 'win32',
		nodeExecPath: 'C:\\Program Files\\nodejs\\node.exe',
	}), {
		command: 'C:\\Program Files\\nodejs\\node.exe',
		argumentPrefix: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'],
	});
	assert.deepEqual(resolveNpmPackInvocation({
		npmExecPath: '   ',
		platform: 'linux',
		nodeExecPath: '/usr/bin/node',
	}), {
		command: 'npm',
		argumentPrefix: [],
	});
	assert.throws(
		() => resolveNpmPackInvocation({
			npmExecPath: null,
			platform: 'win32',
			nodeExecPath: 'C:\\Program Files\\nodejs\\node.exe',
		}),
		/OPERON_PUBLIC_V1_FREEZE_NPM_EXECPATH_REQUIRED/u,
	);
});

test('freeze writer binds exact local inputs and check rejects byte drift', async () => {
	const root = await fixtureRoot();
	try {
		const written = await writePublicV1FreezeIndex({
			pluginRoot: root,
			generateTarball: false,
		});
		assert.equal(written.state, 'provisional');
		assert.equal(written.plugin.artifactStatus, 'local-rebuilt-artifact');
		assert.equal(
			written.cli.tarball.path,
			'packages/operon-cli/freeze/operon-cli-0.1.0-beta.1.tgz',
		);
		assert.equal(written.cli.executable.path, 'packages/operon-cli/dist/operon.mjs');
		assert.equal(written.cli.license.path, 'packages/operon-cli/LICENSE');
		assert.equal(written.documentation.fileCount, 1);
		assert.equal(written.documentation.tree.fileCount, 2);
		assert.equal(written.audit.validation.status, 'pending');
		assert.deepEqual(written.audit.validation.result, { status: 'pending' });
		assert.equal(written.audit.rootPackage.path, 'package.json');
		assert.equal(written.audit.packageLock.path, 'package-lock.json');
		assert.equal(written.audit.checker.path, 'scripts/check-release-audit-policy.mjs');
		assert.equal(written.audit.evaluator.path, 'scripts/release/audit-policy.mjs');
		assert.equal(written.hostedPortability.evidenceStatus, 'pending-stage-10');
		assert.equal(written.hostedPortability.requiredCells, 9);
		assert.deepEqual(await checkPublicV1FreezeIndex({ pluginRoot: root }), written);
		await writeFile(path.join(root, 'package-lock.json'), '{"changed":true}\n');
		await assert.rejects(
			checkPublicV1FreezeIndex({ pluginRoot: root }),
			/OPERON_PUBLIC_V1_FREEZE_STALE/u,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('accepted freeze requires final versions, passed audit and explicit maintainer record', async () => {
	const root = await fixtureRoot();
	try {
		const control = acceptedFreezeControl(
			'maintainer',
			'2026-07-30T15:00:00.000Z',
			PASSED_AUDIT_RESULT,
		);
		await assert.rejects(
			writePublicV1FreezeIndex({ pluginRoot: root, control, generateTarball: false }),
			/OPERON_PUBLIC_V1_FREEZE_ACCEPTANCE_PREREQUISITES_UNMET/u,
		);
		await writeJson(path.join(root, 'packages/operon-cli/package.json'), {
			name: 'operon-cli',
			version: '1.0.4',
		});
		await writeFile(
			path.join(root, 'packages/operon-cli/freeze/operon-cli-1.0.4.tgz'),
			'stable tarball\n',
		);
		await writeJson(path.join(root, 'manifest.json'), {
			id: 'operon',
			version: '3.0.1',
		});
		const accepted = await writePublicV1FreezeIndex({
			pluginRoot: root,
			control,
			generateTarball: false,
		});
		assert.equal(accepted.state, 'accepted');
		assert.deepEqual(accepted.maintainerAcceptance, {
			status: 'accepted',
			acceptedBy: 'maintainer',
			acceptedAt: '2026-07-30T15:00:00.000Z',
		});
		assert.equal(accepted.audit.validation.status, 'passed');
		assert.deepEqual(accepted.audit.validation.result, PASSED_AUDIT_RESULT);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('ordinary write clears prior acceptance and audit attestation', async () => {
	const root = await fixtureRoot();
	try {
		await writeJson(path.join(root, 'packages/operon-cli/package.json'), {
			name: 'operon-cli',
			version: '1.0.4',
		});
		await writeFile(
			path.join(root, 'packages/operon-cli/freeze/operon-cli-1.0.4.tgz'),
			'stable tarball\n',
		);
		await writeJson(path.join(root, 'manifest.json'), {
			id: 'operon',
			version: '3.0.1',
		});
		await writePublicV1FreezeIndex({
			pluginRoot: root,
			control: acceptedFreezeControl(
					'maintainer',
					'2026-07-30T15:00:00.000Z',
					PASSED_AUDIT_RESULT,
			),
			generateTarball: false,
		});
		const rewritten = await writePublicV1FreezeIndex({
			pluginRoot: root,
			generateTarball: false,
		});
		assert.equal(rewritten.state, 'provisional');
		assert.equal(rewritten.audit.validation.status, 'pending');
		assert.deepEqual(rewritten.audit.validation.result, { status: 'pending' });
		assert.deepEqual(rewritten.maintainerAcceptance, { status: 'pending' });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('acceptance requires an explicit passed audit gate result', () => {
	assert.throws(
		() => acceptedFreezeControl('maintainer', '2026-07-30T15:00:00.000Z'),
		/OPERON_PUBLIC_V1_FREEZE_AUDIT_PASS_REQUIRED/u,
	);
});

test('canonical npm tarball generation is reproducible', async () => {
	const root = await fixtureRoot();
	try {
		await writeJson(path.join(root, 'packages/operon-cli/package.json'), {
			name: 'operon-cli',
			version: '0.1.0-beta.1',
			files: ['dist/', 'README.md', 'LICENSE'],
		});
		const firstPath = await writeCanonicalCliTarball(root);
		const first = await readFile(firstPath);
		const secondPath = await writeCanonicalCliTarball(root);
		const second = await readFile(secondPath);
		assert.equal(path.basename(firstPath), 'operon-cli-0.1.0-beta.1.tgz');
		assert.equal(
			createHash('sha256').update(first).digest('hex'),
			createHash('sha256').update(second).digest('hex'),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('canonical npm tarball rejects non-public file modes', {
	skip: process.platform === 'win32',
}, async () => {
	const root = await fixtureRoot();
	try {
		await writeJson(path.join(root, 'packages/operon-cli/package.json'), {
			name: 'operon-cli',
			version: '0.1.0-beta.1',
			files: ['README.md', 'LICENSE'],
		});
		await chmod(path.join(root, 'packages/operon-cli/README.md'), 0o600);
		await assert.rejects(
			writeCanonicalCliTarball(root),
			/OPERON_PUBLIC_V1_FREEZE_PACK_MODE_INVALID:README\.md:384/u,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('source-first preparation rebuilds plugin and CLI before packing', async () => {
	const root = await fixtureRoot();
	const calls = [];
	try {
		await preparePublicV1FreezeArtifacts(root, {
			runner: (executable, arguments_, options) => {
				calls.push({ executable, arguments_, cwd: options.cwd });
				return { status: 0, stdout: '', stderr: '' };
			},
		});
		assert.deepEqual(calls, [
			{
				executable: process.execPath,
				arguments_: ['esbuild.config.mjs', 'production'],
				cwd: root,
			},
			{
				executable: process.execPath,
				arguments_: ['packages/operon-cli/build.mjs'],
				cwd: root,
			},
		]);
		assert.equal(
			await readFile(
				path.join(root, 'packages/operon-cli/freeze/operon-cli-0.1.0-beta.1.tgz'),
			).then(bytes => bytes.byteLength > 0),
			true,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('source-first preparation fails closed when either production build fails', async () => {
	const root = await fixtureRoot();
	try {
		await assert.rejects(
			preparePublicV1FreezeArtifacts(root, {
				runner: (_executable, arguments_) => ({
					status: arguments_[0] === 'packages/operon-cli/build.mjs' ? 1 : 0,
					stdout: '',
					stderr: 'fixture build failure',
				}),
			}),
			/OPERON_PUBLIC_V1_FREEZE_PREPARE_FAILED:cli:fixture build failure/u,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('raw npm audit reports are canonically evaluated for freeze acceptance', async () => {
	const root = await fixtureRoot();
	try {
		const evidenceRoot = path.join(root, 'audit-evidence');
		const productionPath = path.join(evidenceRoot, 'production.json');
		const fullPath = path.join(evidenceRoot, 'full.json');
		await writeJson(productionPath, auditReport({}, {
			info: 0,
			low: 0,
			moderate: 0,
			high: 0,
			critical: 0,
			total: 0,
		}));
		await writeJson(fullPath, auditReport({}, {
			info: 0,
			low: 0,
			moderate: 0,
			high: 0,
			critical: 0,
			total: 0,
		}));
		assert.deepEqual(await runReleaseAuditForFreeze(root, {
			productionAuditReportPath: productionPath,
			fullAuditReportPath: fullPath,
			artifactMetafiles: {
				plugin: { inputs: { 'src/main.ts': {} } },
				cli: { inputs: { 'src/cli.ts': {} } },
			},
				artifactMetafiles: {
					plugin: { inputs: { 'main.ts': { bytes: 1 } } },
					cli: { inputs: { 'packages/operon-cli/src/main.ts': { bytes: 1 } } },
				},
			}), {
			status: 'accepted-clean',
			productionVulnerabilities: 0,
			developmentVulnerabilities: 0,
			directRoot: 'dev-tool',
		});
		await assert.rejects(
			runReleaseAuditForFreeze(root, {
				productionAuditReportPath: productionPath,
			}),
			/OPERON_PUBLIC_V1_FREEZE_AUDIT_REPORT_PAIR_REQUIRED/u,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('documentation manifest cannot escape its generated docs root', async () => {
	const root = await fixtureRoot();
	try {
		const manifestPath = path.join(root, 'docs/operon-docs/manifest.json');
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		manifest.files[0].path = '../main.js';
		await writeJson(manifestPath, manifest);
		await assert.rejects(
			writePublicV1FreezeIndex({
				pluginRoot: root,
				generateTarball: false,
			}),
			/OPERON_PUBLIC_V1_FREEZE_RELATIVE_PATH_INVALID/u,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

async function fixtureRoot() {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-public-v1-freeze-'));
	const files = new Map([
		['contracts/agent-runtime/public-v1-scope.md', 'scope\n'],
		['contracts/agent-runtime/contract-evolution-v1.md', 'evolution\n'],
		['contracts/agent-runtime/developer-api-v1.md', 'developer\n'],
		['contracts/agent-runtime/public-v1-baseline.json', '{}\n'],
		['contracts/release/dev-audit-policy-v1.json', `${JSON.stringify({
			policyVersion: 2,
			production: { maximumVulnerabilities: 0 },
			development: {
				maximumVulnerabilities: 0,
				directRoot: 'dev-tool',
				resolvedAdvisory: {
					packageName: 'dev-tool',
					url: 'https://example.invalid/advisory/1',
					allowedInstalledVersions: ['1.0.0'],
				},
				forbiddenRuntimePackages: ['dev-tool'],
			},
		})}\n`],
		['package.json', `${JSON.stringify({
			name: 'operon',
			version: 'fixture',
			devDependencies: { 'dev-tool': '1.0.0' },
		})}\n`],
		['package-lock.json', `${JSON.stringify({
			lockfileVersion: 3,
			packages: {
				'': {
					name: 'operon',
					devDependencies: { 'dev-tool': '1.0.0' },
				},
				'node_modules/dev-tool': {
					version: '1.0.0',
					dev: true,
				},
			},
		})}\n`],
		['contracts/agent-runtime/hosted-portability-v1.schema.json', '{}\n'],
		['scripts/agent-runtime/contracts/contract-evolution.mjs', 'export {};\n'],
		['scripts/agent-runtime/contracts/check-public-v1-baseline.mjs', 'export {};\n'],
		['scripts/agent-runtime/contracts/public-v1-freeze.mjs', 'export {};\n'],
		['scripts/check-release-audit-policy.mjs', 'export {};\n'],
		['scripts/release/audit-policy.mjs', 'export {};\n'],
		['packages/operon-cli/README.md', 'readme\n'],
		['packages/operon-cli/LICENSE', 'license\n'],
		['packages/operon-cli/dist/operon.mjs', 'executable\n'],
		['packages/operon-cli/freeze/operon-cli-0.1.0-beta.1.tgz', 'tarball\n'],
		['packages/operon-cli/schemas/v1/schema.json', '{}\n'],
		['packages/operon-cli/types/index.d.ts', 'export type Value = string;\n'],
		['packages/operon-cli/examples/developer-api-consumer/main.ts', 'export {};\n'],
		['main.js', 'plugin bundle\n'],
		['styles.css', 'plugin styles\n'],
	]);
	for (const [relative, content] of files) {
		const target = path.join(root, relative);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, content);
	}
	await cp(
		path.join(pluginRoot, 'contracts/agent-runtime/public-v1-freeze.schema.json'),
		path.join(root, 'contracts/agent-runtime/public-v1-freeze.schema.json'),
	);
	const runtimeSchema = `${JSON.stringify({
		$schema: 'https://json-schema.org/draft/2020-12/schema',
		$id: 'urn:operon:schema:runtime:v1:fixture.schema.json',
		type: 'object',
	}, null, 2)}\n`;
	await mkdir(path.join(root, 'contracts/agent-runtime/v1'), { recursive: true });
	await writeFile(
		path.join(root, 'contracts/agent-runtime/v1/fixture.schema.json'),
		runtimeSchema,
	);
	const runtimeDocuments = [{
		file: 'fixture.schema.json',
		id: 'urn:operon:schema:runtime:v1:fixture.schema.json',
		sha256: createHash('sha256').update(runtimeSchema).digest('hex'),
	}];
	const runtimeContractPolicy = {
		inputs: 'strict',
		outputs: 'additive',
		deprecationRemoval: 'runtime-v2',
	};
	const runtimeEntrypoints = [];
	await writeJson(path.join(root, 'contracts/agent-runtime/v1/schema-manifest.json'), {
		contractVersion: 1,
		contractPolicy: runtimeContractPolicy,
		documents: runtimeDocuments,
		entrypoints: runtimeEntrypoints,
		aggregateSha256: createHash('sha256').update(JSON.stringify({
			contractPolicy: runtimeContractPolicy,
			documents: runtimeDocuments,
			entrypoints: runtimeEntrypoints,
		})).digest('hex'),
	});
	await writeJson(path.join(root, 'packages/operon-cli/cli-manifest-v1.json'), {
		compatibility: { cliContract: { min: 1, max: 1 } },
		contractDigest: 'b'.repeat(64),
	});
	await writeJson(path.join(root, 'packages/operon-cli/package.json'), {
		name: 'operon-cli',
		version: '0.1.0-beta.1',
	});
	await writeJson(path.join(root, 'manifest.json'), {
		id: 'operon',
		version: '2.6.0',
	});
	const docsRoot = path.join(root, 'docs/operon-docs');
	await mkdir(docsRoot, { recursive: true });
	const docBytes = Buffer.from('docs\n');
	await writeFile(path.join(docsRoot, 'DOCS-001 Docs.md'), docBytes);
	await writeJson(path.join(docsRoot, 'manifest.json'), {
		files: [{
			path: 'DOCS-001 Docs.md',
			sha256: createHash('sha256').update(docBytes).digest('hex'),
			bytes: docBytes.byteLength,
		}],
	});
	return root;
}

async function writeJson(target, value) {
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

function auditReport(vulnerabilities, counts) {
	return {
		auditReportVersion: 2,
		vulnerabilities,
		metadata: { vulnerabilities: counts },
	};
}

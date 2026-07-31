import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import { evaluateReleaseAuditPolicy } from '../../release/audit-policy.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const defaultPluginRoot = path.resolve(path.dirname(scriptPath), '../../..');
const FREEZE_RELATIVE_PATH = 'contracts/agent-runtime/public-v1-freeze.json';
const FREEZE_SCHEMA_RELATIVE_PATH = 'contracts/agent-runtime/public-v1-freeze.schema.json';
const AUDIT_POLICY_RELATIVE_PATH = 'contracts/release/dev-audit-policy-v1.json';
const HOSTED_SCHEMA_RELATIVE_PATH = 'contracts/agent-runtime/hosted-portability-v1.schema.json';
const CONTRACT_FILES = [
	'contracts/agent-runtime/public-v1-scope.md',
	'contracts/agent-runtime/contract-evolution-v1.md',
	'contracts/agent-runtime/developer-api-v1.md',
	'contracts/agent-runtime/public-v1-baseline.json',
	FREEZE_SCHEMA_RELATIVE_PATH,
	'scripts/agent-runtime/contracts/contract-evolution.mjs',
	'scripts/agent-runtime/contracts/check-public-v1-baseline.mjs',
	'scripts/agent-runtime/contracts/public-v1-freeze.mjs',
];

export async function buildPublicV1FreezeIndex(options = {}) {
	const root = options.pluginRoot ?? defaultPluginRoot;
	const control = options.control ?? await readFreezeControl(root);
	const contractFiles = await Promise.all(CONTRACT_FILES.map(file => fileRecord(root, file)));
	const runtimeManifestRecord = await fileRecord(
		root,
		'contracts/agent-runtime/v1/schema-manifest.json',
	);
	const runtimeManifest = JSON.parse(await readFile(
		path.join(root, runtimeManifestRecord.path),
		'utf8',
	));
	const runtimeSchemaTree = await verifyRuntimeSchemaManifest(root, runtimeManifest);
	const cliManifestRecord = await fileRecord(root, 'packages/operon-cli/cli-manifest-v1.json');
	const cliManifest = JSON.parse(await readFile(path.join(root, cliManifestRecord.path), 'utf8'));
	const packageMetadata = await fileRecord(root, 'packages/operon-cli/package.json');
	const packageDocument = JSON.parse(await readFile(path.join(root, packageMetadata.path), 'utf8'));
	assertCliPackageIdentity(packageDocument);
	const tarball = await fileRecord(
		root,
		`packages/operon-cli/freeze/operon-cli-${packageDocument.version}.tgz`,
	);
	const executable = await fileRecord(root, 'packages/operon-cli/dist/operon.mjs');
	const license = await fileRecord(root, 'packages/operon-cli/LICENSE');
	const readme = await fileRecord(root, 'packages/operon-cli/README.md');
	const schemas = await treeRecord(root, 'packages/operon-cli/schemas/v1');
	const declarations = await treeRecord(root, 'packages/operon-cli/types');
	const developerExample = await treeRecord(
		root,
		'packages/operon-cli/examples/developer-api-consumer',
	);
	const docsManifestRecord = await fileRecord(root, 'docs/operon-docs/manifest.json');
	const docsManifest = JSON.parse(await readFile(path.join(root, docsManifestRecord.path), 'utf8'));
	const docsAggregate = await verifyDocumentationManifest(root, docsManifest);
	const docsTree = await treeRecord(root, 'docs/operon-docs');
	const pluginManifestRecord = await fileRecord(root, 'manifest.json');
	const pluginManifest = JSON.parse(await readFile(path.join(root, pluginManifestRecord.path), 'utf8'));
	const auditPolicy = await fileRecord(root, AUDIT_POLICY_RELATIVE_PATH);
	const auditChecker = await fileRecord(root, 'scripts/check-release-audit-policy.mjs');
	const auditEvaluator = await fileRecord(root, 'scripts/release/audit-policy.mjs');
	const auditRootPackage = await fileRecord(root, 'package.json');
	const auditPackageLock = await fileRecord(root, 'package-lock.json');
	const hostedSchema = await fileRecord(root, HOSTED_SCHEMA_RELATIVE_PATH);
	const contractsAggregate = digestJson(contractFiles);
	const packageInputAggregate = digestJson({
		manifest: cliManifestRecord,
		packageMetadata,
		tarball,
		executable,
		license,
		readme,
		schemas,
		declarations,
		developerExample,
	});
	const indexWithoutAggregate = {
		freezeVersion: 1,
		kind: 'operon-public-v1-local-freeze',
		state: control.maintainerAcceptance.status === 'accepted' ? 'accepted' : 'provisional',
		contracts: {
			files: contractFiles,
			aggregateSha256: contractsAggregate,
		},
		runtime: {
			contractVersion: runtimeManifest.contractVersion,
			schemaManifest: runtimeManifestRecord,
			schemaTree: runtimeSchemaTree,
			schemaAggregateSha256: runtimeManifest.aggregateSha256,
		},
		cli: {
			contractVersion: cliManifest.compatibility?.cliContract?.max,
			packageVersion: packageDocument.version,
			contractDigest: cliManifest.contractDigest,
			tarball,
			executable,
			license,
			manifest: cliManifestRecord,
			packageMetadata,
			readme,
			schemas,
			declarations,
			developerExample,
			packageInputAggregateSha256: packageInputAggregate,
		},
		documentation: {
			manifest: docsManifestRecord,
			tree: docsTree,
			fileCount: docsAggregate.fileCount,
			contentAggregateSha256: docsAggregate.aggregateSha256,
		},
		plugin: {
			artifactStatus: 'provisional-unpublished',
			pluginId: pluginManifest.id,
			version: pluginManifest.version,
			main: await fileRecord(root, 'main.js'),
			manifest: pluginManifestRecord,
			styles: await fileRecord(root, 'styles.css'),
		},
		audit: {
			policy: auditPolicy,
			checker: auditChecker,
			evaluator: auditEvaluator,
			rootPackage: auditRootPackage,
			packageLock: auditPackageLock,
			validation: {
				command: 'npm run release:audit-policy',
				status: control.auditStatus,
				result: control.auditResult,
			},
		},
		hostedPortability: {
			evidenceStatus: 'pending-stage-10',
			requiredCells: 9,
			contractSchema: hostedSchema,
			verificationCommand: 'npm run agent-runtime:cli:hosted-portability:test',
		},
		maintainerAcceptance: control.maintainerAcceptance,
	};
	const index = {
		...indexWithoutAggregate,
		inputsAggregateSha256: digestJson(indexWithoutAggregate),
	};
	await validateFreezeIndex(root, index);
	if (index.state === 'accepted') assertAcceptedFreeze(index);
	return index;
}

export async function writePublicV1FreezeIndex(options = {}) {
	const root = options.pluginRoot ?? defaultPluginRoot;
	const target = options.freezePath ?? path.join(root, FREEZE_RELATIVE_PATH);
	if (options.generateTarball !== false) await writeCanonicalCliTarball(root);
	const index = await buildPublicV1FreezeIndex({
		...options,
		pluginRoot: root,
		control: options.control ?? {
			auditStatus: 'pending',
			auditResult: { status: 'pending' },
			maintainerAcceptance: { status: 'pending' },
		},
	});
	const output = `${JSON.stringify(index, null, 2)}\n`;
	const temporary = `${target}.${process.pid}.tmp`;
	await writeFile(temporary, output, { encoding: 'utf8', mode: 0o600 });
	await rename(temporary, target);
	return index;
}

export async function writeCanonicalCliTarball(root = defaultPluginRoot) {
	const packageRoot = path.join(root, 'packages/operon-cli');
	const packageDocument = JSON.parse(await readFile(
		path.join(packageRoot, 'package.json'),
		'utf8',
	));
	assertCliPackageIdentity(packageDocument);
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'operon-public-v1-pack-'));
	try {
		const result = spawnSync(
			'npm',
			['pack', '--json', '--pack-destination', temporaryRoot],
			{
				cwd: packageRoot,
				encoding: 'utf8',
				env: {
					...process.env,
					npm_config_cache: path.join(temporaryRoot, 'npm-cache'),
					npm_config_audit: 'false',
					npm_config_fund: 'false',
					npm_config_update_notifier: 'false',
					NO_COLOR: '1',
				},
			},
		);
		if (result.error) throw result.error;
		if (result.status !== 0) {
			throw new Error(
				`OPERON_PUBLIC_V1_FREEZE_PACK_FAILED:${[result.stdout, result.stderr]
					.filter(Boolean)
					.join('\n')
					.trim()}`,
			);
		}
		const packed = JSON.parse(result.stdout);
		if (!Array.isArray(packed) || packed.length !== 1) {
			throw new Error('OPERON_PUBLIC_V1_FREEZE_PACK_RESULT_INVALID');
		}
		const expectedFilename = `operon-cli-${packageDocument.version}.tgz`;
		if (packed[0]?.filename !== expectedFilename) {
			throw new Error('OPERON_PUBLIC_V1_FREEZE_PACK_FILENAME_INVALID');
		}
		const freezeRoot = path.join(packageRoot, 'freeze');
		await mkdir(freezeRoot, { recursive: true });
		await copyFile(
			path.join(temporaryRoot, expectedFilename),
			path.join(freezeRoot, expectedFilename),
		);
		return path.join(freezeRoot, expectedFilename);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

export async function preparePublicV1FreezeArtifacts(
	root = defaultPluginRoot,
	options = {},
) {
	const runner = options.runner ?? spawnSync;
	for (const [artifact, arguments_] of [
		['plugin', ['esbuild.config.mjs', 'production']],
		['cli', ['packages/operon-cli/build.mjs']],
	]) {
		const result = runner(process.execPath, arguments_, {
			cwd: root,
			encoding: 'utf8',
			env: process.env,
		});
		if (result?.error || result?.status !== 0) {
			throw new Error(
				`OPERON_PUBLIC_V1_FREEZE_PREPARE_FAILED:${artifact}:${
					result?.error?.message
					|| result?.stderr?.trim()
					|| result?.stdout?.trim()
					|| `exit ${result?.status ?? 'unknown'}`
				}`,
			);
		}
	}
	await writeCanonicalCliTarball(root);
}

export async function checkPublicV1FreezeIndex(options = {}) {
	const root = options.pluginRoot ?? defaultPluginRoot;
	const target = options.freezePath ?? path.join(root, FREEZE_RELATIVE_PATH);
	const actualBytes = await readFile(target, 'utf8');
	const actual = JSON.parse(actualBytes);
	const expected = await buildPublicV1FreezeIndex({
		...options,
		pluginRoot: root,
		control: controlFromIndex(actual),
	});
	const expectedBytes = `${JSON.stringify(expected, null, 2)}\n`;
	if (actualBytes !== expectedBytes) throw new Error('OPERON_PUBLIC_V1_FREEZE_STALE');
	return expected;
}

export function acceptedFreezeControl(acceptedBy, acceptedAt, auditResult) {
	if (typeof acceptedBy !== 'string' || acceptedBy.trim() === '') {
		throw new Error('OPERON_PUBLIC_V1_FREEZE_ACCEPTOR_REQUIRED');
	}
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(acceptedAt ?? '')) {
		throw new Error('OPERON_PUBLIC_V1_FREEZE_ACCEPTED_AT_INVALID');
	}
	const normalizedAuditResult = normalizeAuditResult(auditResult);
	return {
		auditStatus: 'passed',
		auditResult: normalizedAuditResult,
		maintainerAcceptance: {
			status: 'accepted',
			acceptedBy: acceptedBy.trim(),
			acceptedAt,
		},
	};
}

export async function runReleaseAuditForFreeze(root = defaultPluginRoot, options = {}) {
	const productionReportPath = options.productionAuditReportPath;
	const fullReportPath = options.fullAuditReportPath;
	if (Boolean(productionReportPath) !== Boolean(fullReportPath)) {
		throw new Error('OPERON_PUBLIC_V1_FREEZE_AUDIT_REPORT_PAIR_REQUIRED');
	}
	if (productionReportPath && fullReportPath) {
		const [
			policy,
			productionReport,
			fullReport,
			packageLock,
			rootPackage,
			cliPackage,
		] = await Promise.all([
			readJsonFile(path.join(root, AUDIT_POLICY_RELATIVE_PATH)),
			readJsonFile(resolveEvidencePath(root, productionReportPath)),
			readJsonFile(resolveEvidencePath(root, fullReportPath)),
			readJsonFile(path.join(root, 'package-lock.json')),
			readJsonFile(path.join(root, 'package.json')),
			readJsonFile(path.join(root, 'packages/operon-cli/package.json')),
		]);
		const artifactMetafiles = options.artifactMetafiles
			?? await buildAuditArtifactMetafiles(root);
		return normalizeAuditResult(evaluateReleaseAuditPolicy({
			policy,
			productionReport,
			fullReport,
			packageLock,
			rootPackage,
			cliPackage,
			rootDir: root,
			artifactMetafiles,
		}));
	}
	const result = spawnSync(
		'npm',
		['run', '--silent', 'release:audit-policy'],
		{ cwd: root, encoding: 'utf8' },
	);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`OPERON_PUBLIC_V1_FREEZE_AUDIT_FAILED:${[result.stdout, result.stderr]
				.filter(Boolean)
				.join('\n')
				.trim()}`,
		);
	}
	let auditResult;
	try {
		auditResult = JSON.parse(result.stdout);
	} catch {
		throw new Error('OPERON_PUBLIC_V1_FREEZE_AUDIT_RESULT_INVALID');
	}
	return normalizeAuditResult(auditResult);
}

async function buildAuditArtifactMetafiles(root) {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'operon-public-v1-audit-'));
	try {
		const definitions = [
			{
				artifact: 'plugin',
				arguments: ['esbuild.config.mjs', 'production'],
				environmentKey: 'OPERON_ESBUILD_METAFILE',
			},
			{
				artifact: 'cli',
				arguments: ['packages/operon-cli/build.mjs'],
				environmentKey: 'OPERON_CLI_ESBUILD_METAFILE',
			},
		];
		const metafiles = {};
		for (const definition of definitions) {
			const metafilePath = path.join(temporaryRoot, `${definition.artifact}.json`);
			const result = spawnSync(process.execPath, definition.arguments, {
				cwd: root,
				encoding: 'utf8',
				env: {
					...process.env,
					[definition.environmentKey]: metafilePath,
				},
			});
			if (result.error || result.status !== 0) {
				throw new Error(
					`OPERON_PUBLIC_V1_FREEZE_AUDIT_PROVENANCE_FAILED:${definition.artifact}:${
						result.error?.message
						|| result.stderr.trim()
						|| result.stdout.trim()
						|| `exit ${result.status ?? 'signal'}`
					}`,
				);
			}
			metafiles[definition.artifact] = JSON.parse(await readFile(metafilePath, 'utf8'));
		}
		return metafiles;
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

function assertAcceptedFreeze(index) {
	if (
		index.cli.packageVersion !== '1.0.0'
		|| index.plugin.version !== '3.0.0'
		|| index.audit.validation.status !== 'passed'
		|| index.audit.validation.result?.status !== 'accepted-development-exception'
	) {
		throw new Error('OPERON_PUBLIC_V1_FREEZE_ACCEPTANCE_PREREQUISITES_UNMET');
	}
}

async function readFreezeControl(root) {
	try {
		const existing = JSON.parse(await readFile(
			path.join(root, FREEZE_RELATIVE_PATH),
			'utf8',
		));
		return controlFromIndex(existing);
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
			return {
				auditStatus: 'pending',
				auditResult: { status: 'pending' },
				maintainerAcceptance: { status: 'pending' },
			};
	}
}

async function verifyRuntimeSchemaManifest(root, manifest) {
	if (
		!Array.isArray(manifest?.documents)
		|| !Array.isArray(manifest?.entrypoints)
		|| !manifest.contractPolicy
	) {
		throw new Error('OPERON_PUBLIC_V1_FREEZE_RUNTIME_MANIFEST_INVALID');
	}
	const schemaRoot = 'contracts/agent-runtime/v1';
	const schemaFiles = (await readdir(path.join(root, schemaRoot)))
		.filter(file => file.endsWith('.schema.json'))
		.sort();
	const manifestFiles = [...manifest.documents]
		.map(document => document?.file)
		.sort();
	if (JSON.stringify(schemaFiles) !== JSON.stringify(manifestFiles)) {
		throw new Error('OPERON_PUBLIC_V1_FREEZE_RUNTIME_SCHEMA_SET_MISMATCH');
	}
	const documents = [];
	for (const expected of manifest.documents) {
		const bytes = await readFile(path.join(root, schemaRoot, safeRelativePath(expected.file)));
		const document = JSON.parse(bytes.toString('utf8'));
		const digest = sha256(bytes);
		if (document.$id !== expected.id || digest !== expected.sha256) {
			throw new Error(`OPERON_PUBLIC_V1_FREEZE_RUNTIME_SCHEMA_STALE:${expected.file}`);
		}
		documents.push({
			file: expected.file,
			id: expected.id,
			sha256: digest,
		});
	}
	const aggregateSha256 = digestJson({
		contractPolicy: manifest.contractPolicy,
		documents,
		entrypoints: manifest.entrypoints,
	});
	if (aggregateSha256 !== manifest.aggregateSha256) {
		throw new Error('OPERON_PUBLIC_V1_FREEZE_RUNTIME_AGGREGATE_STALE');
	}
	return treeRecord(root, schemaRoot);
}

function controlFromIndex(index) {
	const passed = index?.audit?.validation?.status === 'passed';
	return {
		auditStatus: passed ? 'passed' : 'pending',
		auditResult: passed
			? normalizeAuditResult(index?.audit?.validation?.result)
			: { status: 'pending' },
		maintainerAcceptance: index?.maintainerAcceptance?.status === 'accepted'
			? index.maintainerAcceptance
			: { status: 'pending' },
	};
}

function normalizeAuditResult(result) {
	if (
		result?.status !== 'accepted-development-exception'
		|| !Number.isSafeInteger(result.productionVulnerabilities)
		|| result.productionVulnerabilities !== 0
		|| !Number.isSafeInteger(result.developmentVulnerabilities)
		|| result.developmentVulnerabilities < 0
		|| typeof result.directRoot !== 'string'
		|| result.directRoot === ''
	) {
		throw new Error(
			`OPERON_PUBLIC_V1_FREEZE_AUDIT_PASS_REQUIRED:${JSON.stringify(result)}`,
		);
	}
	return {
		status: result.status,
		productionVulnerabilities: result.productionVulnerabilities,
		developmentVulnerabilities: result.developmentVulnerabilities,
		directRoot: result.directRoot,
	};
}

async function readJsonFile(target) {
	try {
		return JSON.parse(await readFile(target, 'utf8'));
	} catch (error) {
		throw new Error(
			`OPERON_PUBLIC_V1_FREEZE_AUDIT_REPORT_INVALID:${target}`,
			{ cause: error },
		);
	}
}

function resolveEvidencePath(root, target) {
	if (typeof target !== 'string' || target.trim() === '') {
		throw new Error('OPERON_PUBLIC_V1_FREEZE_AUDIT_REPORT_PATH_INVALID');
	}
	return path.resolve(root, target);
}

function commandOption(name, environmentName) {
	const index = process.argv.indexOf(name);
	if (index >= 0) {
		const value = process.argv[index + 1];
		if (!value || value.startsWith('--')) {
			throw new Error(`OPERON_PUBLIC_V1_FREEZE_OPTION_VALUE_REQUIRED:${name}`);
		}
		return value;
	}
	return process.env[environmentName];
}

async function fileRecord(root, relativePath) {
	const normalized = relativePath.split(path.sep).join('/');
	const bytes = await readFile(path.join(root, normalized));
	return {
		path: normalized,
		sha256: sha256(bytes),
		bytes: bytes.byteLength,
	};
}

async function treeRecord(root, relativeRoot) {
	const records = [];
	await walk(path.join(root, relativeRoot), '');
	return {
		root: relativeRoot,
		fileCount: records.length,
		aggregateSha256: digestJson(records),
	};

	async function walk(directory, relativeDirectory) {
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			const relative = relativeDirectory
				? path.posix.join(relativeDirectory, entry.name)
				: entry.name;
			const absolute = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				await walk(absolute, relative);
				continue;
			}
			if (!entry.isFile()) throw new Error(`OPERON_PUBLIC_V1_FREEZE_NON_FILE:${relative}`);
			const bytes = await readFile(absolute);
			records.push({
				path: relative,
				sha256: sha256(bytes),
				bytes: bytes.byteLength,
			});
		}
	}
}

async function verifyDocumentationManifest(root, manifest) {
	if (!Array.isArray(manifest?.files) || manifest.files.length === 0) {
		throw new Error('OPERON_PUBLIC_V1_FREEZE_DOCS_MANIFEST_INVALID');
	}
	const records = [];
	const seenPaths = new Set();
	for (const record of [...manifest.files].sort((left, right) => (
		left.path.localeCompare(right.path)
	))) {
		const relativePath = safeRelativePath(record.path);
		if (seenPaths.has(relativePath)) {
			throw new Error(`OPERON_PUBLIC_V1_FREEZE_DOCS_DUPLICATE:${relativePath}`);
		}
		seenPaths.add(relativePath);
		const bytes = await readFile(path.join(root, 'docs/operon-docs', relativePath));
		const actual = {
			path: relativePath,
			sha256: sha256(bytes),
			bytes: bytes.byteLength,
		};
		if (actual.sha256 !== record.sha256 || actual.bytes !== record.bytes) {
			throw new Error(`OPERON_PUBLIC_V1_FREEZE_DOCS_STALE:${relativePath}`);
		}
		records.push(actual);
	}
	return {
		fileCount: records.length,
		aggregateSha256: digestJson(records),
	};
}

function assertCliPackageIdentity(packageDocument) {
	if (
		packageDocument?.name !== 'operon-cli'
		|| typeof packageDocument.version !== 'string'
		|| !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(packageDocument.version)
	) {
		throw new Error('OPERON_PUBLIC_V1_FREEZE_PACKAGE_IDENTITY_INVALID');
	}
}

function safeRelativePath(value) {
	if (
		typeof value !== 'string'
		|| value === ''
		|| path.isAbsolute(value)
		|| value.split(/[\\/]/u).some(segment => segment === '..' || segment === '')
	) {
		throw new Error('OPERON_PUBLIC_V1_FREEZE_RELATIVE_PATH_INVALID');
	}
	return value.split(path.sep).join('/');
}

async function validateFreezeIndex(root, index) {
	const schema = JSON.parse(await readFile(
		path.join(root, FREEZE_SCHEMA_RELATIVE_PATH),
		'utf8',
	));
	const validate = new Ajv2020({ strict: true, validateFormats: false }).compile(schema);
	if (!validate(index)) {
		throw new Error(`OPERON_PUBLIC_V1_FREEZE_INVALID:${JSON.stringify(validate.errors)}`);
	}
}

function digestJson(value) {
	return sha256(Buffer.from(JSON.stringify(value), 'utf8'));
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	const write = process.argv.includes('--write');
	const check = process.argv.includes('--check');
	const accept = process.argv.includes('--accept');
	if (Number(write) + Number(check) + Number(accept) !== 1) {
		throw new Error('Usage: public-v1-freeze.mjs --write|--check|--accept');
	}
	if (check) {
		await preparePublicV1FreezeArtifacts();
		await checkPublicV1FreezeIndex();
	} else if (accept) {
		await preparePublicV1FreezeArtifacts();
		const auditResult = await runReleaseAuditForFreeze(defaultPluginRoot, {
			productionAuditReportPath: commandOption(
				'--production-audit-report',
				'OPERON_PRODUCTION_AUDIT_REPORT',
			),
			fullAuditReportPath: commandOption(
				'--full-audit-report',
				'OPERON_FULL_AUDIT_REPORT',
			),
		});
		await writePublicV1FreezeIndex({
			generateTarball: false,
			control: acceptedFreezeControl(
				process.env.OPERON_FREEZE_ACCEPTED_BY,
				process.env.OPERON_FREEZE_ACCEPTED_AT,
				auditResult,
			),
		});
	} else {
		await preparePublicV1FreezeArtifacts();
		await writePublicV1FreezeIndex({
			generateTarball: false,
			control: {
				auditStatus: 'pending',
				auditResult: { status: 'pending' },
				maintainerAcceptance: { status: 'pending' },
			},
		});
	}
}

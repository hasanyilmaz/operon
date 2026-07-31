import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const vaultRoot = path.resolve(pluginRoot, '../../..');
const generatedRoot = path.join(pluginRoot, 'docs/operon-docs');
const configuredSourceRoot = process.env.OPERON_DOCS_SOURCE_ROOT;
const externalSourceRoot = configuredSourceRoot
	? path.resolve(configuredSourceRoot)
	: path.join(vaultRoot, 'Operon/Operon Docs Source');
if (configuredSourceRoot && !existsSync(externalSourceRoot)) {
	throw new Error(`OPERON_DOCS_SOURCE_ROOT_NOT_FOUND:${externalSourceRoot}`);
}
const sourceRoot = existsSync(externalSourceRoot) ? externalSourceRoot : generatedRoot;
const cliPackageRoot = path.join(pluginRoot, 'packages/operon-cli');
const managedPattern = /^DOCS-\d{3} .+\.md$/u;
const publicIntegrationNumbers = new Set([
	'001',
	'036',
	...Array.from({ length: 16 }, (_, index) => String(index + 118).padStart(3, '0')),
]);

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

async function managedFiles(root) {
	return (await readdir(root))
		.filter(file => managedPattern.test(file))
		.sort((left, right) => left.localeCompare(right, 'en'));
}

function docNumber(file) {
	return file.slice(5, 8);
}

function frontmatterOf(source, file) {
	const match = /^---\n([\s\S]*?)\n---\n/u.exec(source);
	assert.ok(match, `${file} must start with YAML frontmatter.`);
	return match[1];
}

async function sourceDoc(number) {
	const file = (await managedFiles(sourceRoot))
		.find(value => value.startsWith(`DOCS-${number} `));
	assert.ok(file, `DOCS-${number} is missing.`);
	return readFile(path.join(sourceRoot, file), 'utf8');
}

function jsonBlocks(source) {
	return [...source.matchAll(/```json\n([\s\S]*?)\n```/gu)]
		.map(match => JSON.parse(match[1]));
}

async function publicSchemaValidators() {
	const schemaRoot = path.join(cliPackageRoot, 'schemas/v1');
	const manifest = JSON.parse(await readFile(
		path.join(cliPackageRoot, 'cli-manifest-v1.json'),
		'utf8',
	));
	const ajv = new Ajv2020({
		strict: true,
		strictRequired: false,
		strictTypes: false,
		allowUnionTypes: true,
	});
	for (const keyword of [
		'x-operon-acknowledgementBindings',
		'x-operon-catalogResultSafety',
		'x-operon-cliInvocationBinding',
		'x-operon-cliResultBinding',
		'x-operon-contiguousOrder',
		'x-operon-createGraphSafety',
		'x-operon-fieldCatalogSafety',
		'x-operon-frozenCapabilityRegistry',
		'x-operon-knownValues',
		'x-operon-maxUtf8Bytes',
		'x-operon-receiptTimeline',
		'x-operon-resultState',
		'x-operon-sealedPlanSafety',
		'x-operon-sessionOrder',
		'x-operon-sessionReadCommand',
		'x-operon-truncationState',
		'x-operon-uniqueBy',
		'x-operon-updateBatchSafety',
	]) ajv.addKeyword({ keyword });
	ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/u);
	ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T/u);
	ajv.addFormat('operon-audit-date-time', /^\d{4}-\d{2}-\d{2}T/u);
	ajv.addFormat('operon-local-date-time', /^\d{4}-\d{2}-\d{2}T/u);
	for (const file of await readdir(schemaRoot)) {
		if (!file.endsWith('.json')) continue;
		const schema = JSON.parse(await readFile(path.join(schemaRoot, file), 'utf8'));
		if (typeof schema.$id === 'string') ajv.addSchema(schema);
	}
	const refs = new Map(manifest.schemaEntrypoints.map(entrypoint => [
		entrypoint.schemaId,
		entrypoint.ref,
	]));
	return (schemaId, value) => {
		const ref = refs.get(schemaId);
		assert.ok(ref, `Missing schema entrypoint ${schemaId}.`);
		const validator = ajv.compile({ $ref: ref });
		assert.equal(
			validator(value),
			true,
			`${schemaId}: ${JSON.stringify(validator.errors)}`,
		);
	};
}

test('Public V1 integration docs follow the source conventions', async () => {
	const files = await managedFiles(sourceRoot);
	assert.equal(files.length, 133, 'Aşama 8 must finish with exactly DOCS-001 through DOCS-133.');
	const selected = files.filter(file => publicIntegrationNumbers.has(docNumber(file)));
	assert.equal(selected.length, publicIntegrationNumbers.size);

	for (const file of selected) {
		const source = await readFile(path.join(sourceRoot, file), 'utf8');
		const frontmatter = frontmatterOf(source, file);
		for (const field of ['Notes', 'Icon', 'Color', 'Updated']) {
			assert.match(frontmatter, new RegExp(`^${field}:`, 'mu'), `${file} is missing ${field}.`);
		}
		assert.match(frontmatter, /^Updated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/mu);
		assert.doesNotMatch(source, /[—–]/u, `${file} contains banned dash punctuation.`);
		assert.doesNotMatch(
			source,
			/(?:operon-cli@|CLI\s+\d+\.\d+|Operon\s+\d+\.\d+|Node(?:\.js)?\s+22\+)/iu,
			`${file} contains a drift-prone product or package version.`,
		);
		assert.doesNotMatch(
			source,
			/(?:only documented and supported public|one public (?:way|surface)|Windows and WSL are not supported)/iu,
			`${file} contains a retired Public V1 support statement.`,
		);
	}
});

test('Public V1 integration wikilinks resolve inside the source package', async () => {
	const files = await managedFiles(sourceRoot);
	const stems = new Set(files.map(file => file.slice(0, -3)));
	for (const file of files.filter(value => publicIntegrationNumbers.has(docNumber(value)))) {
		const source = await readFile(path.join(sourceRoot, file), 'utf8');
		for (const match of source.matchAll(/\[\[(DOCS-\d{3} [^|\]]+)(?:\|[^\]]+)?\]\]/gu)) {
			assert.ok(stems.has(match[1]), `${file} links to missing ${match[1]}.md.`);
		}
	}
});

test('DOCS-120 and DOCS-121 typed read examples match shipped request schemas', async () => {
	const validate = await publicSchemaValidators();
	const [firstRead, readReference] = await Promise.all([
		sourceDoc('120'),
		sourceDoc('121'),
	]);
	const firstReadRequests = jsonBlocks(firstRead);
	const referenceRequests = jsonBlocks(readReference);

	assert.equal(firstReadRequests.length, 1);
	validate('entity-resolve-request', firstReadRequests[0]);

	const requestsByKind = Map.groupBy(referenceRequests, request => request.kind);
	assert.equal(requestsByKind.get('task-query')?.length, 2);
	validate('task-query-request', requestsByKind.get('task-query')[0]);
	validate('task-query-request', requestsByKind.get('task-query')[1]);
	validate('task-finder-request', requestsByKind.get('task-finder')[0]);
	validate('relationship-request', requestsByKind.get('relationship')[0]);
	validate('context-request', requestsByKind.get('context')[0]);
});

test('DOCS-121 pagination preserves cursor-bound request fields', async () => {
	const source = await sourceDoc('121');
	const [firstPage, nextPage] = jsonBlocks(source)
		.filter(request => request.kind === 'task-query');

	assert.deepEqual(nextPage.filters, firstPage.filters);
	assert.equal(nextPage.limit, firstPage.limit);
	assert.equal(nextPage.consistency, firstPage.consistency);
	assert.notEqual(nextPage.requestId, firstPage.requestId);
	assert.equal(typeof nextPage.cursor, 'string');
	assert.ok(nextPage.cursor.length > 0);
	assert.match(source, /stale-cursor/u);
	assert.match(source, /restart from page one/iu);
	assert.match(source, /never combine pages from different Context revisions/iu);
	assert.doesNotMatch(source, /unbounded-depth/iu);
	assert.match(source, /planning-workload[\s\S]*does not accept a depth parameter[\s\S]*250 tasks/iu);
});

test('DOCS-120 and DOCS-121 use canonical stdin for typed read requests', async () => {
	const [firstRead, readReference] = await Promise.all([
		sourceDoc('120'),
		sourceDoc('121'),
	]);
	for (const source of [firstRead, readReference]) {
		assert.match(source, /--input -/u);
		assert.doesNotMatch(
			source,
			/--input (?:selector|query|finder|rel|context)\.json/u,
		);
		assert.match(source, /owner-only temporary file outside the (?:synchronized )?vault/iu);
		assert.match(source, /delete it/iu);
	}
});

test('DOCS-122 through DOCS-124 preserve preview, expiry, and recovery boundaries', async () => {
	const [overview, changing, security, recovery] = await Promise.all([
		sourceDoc('118'),
		sourceDoc('122'),
		sourceDoc('123'),
		sourceDoc('124'),
	]);
	assert.match(overview, /Eligible routine direct CLI commands may apply/iu);
	assert.match(overview, /Typed CLI input, agent stdin, `--preview-only`/iu);
	for (const source of [changing, recovery]) {
		assert.match(source, /--json[^.\n]*(?:output only|only changes output)/iu);
		assert.match(source, /--preview-only/u);
		assert.match(source, /typed `?--input`?/iu);
		assert.match(source, /routine[\s\S]{0,50}(?:direct|argv)/iu);
		assert.doesNotMatch(
			source,
			/--json[^.\n]*(?:always|guarantees?)[^.\n]*(?:preview|stop|retain)/iu,
		);
	}
	for (const source of [changing, security]) {
		assert.match(source, /routine or elevated plan[\s\S]{0,80}five minutes/iu);
		assert.match(source, /destructive plan[\s\S]{0,80}60 seconds/iu);
		assert.match(source, /before dispatch[\s\S]{0,80}preview again/iu);
		assert.match(source, /dispatch may have begun[\s\S]{0,120}24-hour recovery window/iu);
	}
	assert.match(recovery, /destructive JSON or non-interactive/iu);
	assert.match(recovery, /recover (?:the same plan|through the stored plan)/iu);
});

test('DOCS-125 through DOCS-127 document compact batches and recurrence scopes', async () => {
	const [contract, syntax, commands] = await Promise.all([
		sourceDoc('125'),
		sourceDoc('126'),
		sourceDoc('127'),
	]);
	assert.match(contract, /manifest records a SHA-256/iu);
	assert.match(contract, /not a field stored inside the schema file/iu);
	for (const field of [
		'compactBatchInputFormat',
		'compactBatchMaxItems',
		'compactUpdateBatchInputFormat',
		'compactUpdateBatchMaxItems',
	]) assert.match(contract, new RegExp(`\\b${field}\\b`, 'u'));

	for (const source of [syntax, commands]) {
		assert.match(source, /task create --input-format compact-lines --input/u);
		assert.match(source, /task update --input-format compact-lines --input/u);
		assert.match(source, /one to 64/iu);
		assert.match(source, /two to 64/iu);
		assert.match(source, /--scope this-task/u);
		assert.match(source, /--scope this-and-following/u);
	}
	assert.match(syntax, /note::"call them; then email"/u);
	assert.doesNotMatch(syntax, /note::"call them\\; then email"/u);
	assert.match(syntax, /one `planRef`/u);
	assert.match(syntax, /There is no sequential fallback/iu);
	assert.match(syntax, /typed JSON route/iu);
	assert.match(syntax, /same preview-only rule applies whether `--input` reads stdin or a file/iu);
	assert.match(syntax, /temporal change on a repeating task requires `--scope this-task` or `--scope this-and-following`/iu);
	assert.match(syntax, /Starting recurrence on a non-repeating task defaults to `this-and-following`/iu);
	assert.match(syntax, /Recurrence fields cannot be mixed with general fields or relationship keys/iu);
	assert.doesNotMatch(syntax, /Compact syntax is limited to one task/iu);
});

test('DOCS-127 and DOCS-128 keep JSON output separate from guided and batch behavior', async () => {
	const [commands, interactive] = await Promise.all([
		sourceDoc('127'),
		sourceDoc('128'),
	]);
	assert.match(commands, /--json` changes output only/iu);
	assert.match(commands, /warning-free direct argv command can still apply automatically/iu);
	assert.match(commands, /Destructive JSON or non-interactive calls retain the plan/iu);
	assert.doesNotMatch(
		commands,
		/JSON convenience mutation[^.\n]*stop at the preview/iu,
	);
	assert.match(interactive, /Most result-producing direct commands/iu);
	assert.match(interactive, /`completion` is the deliberate exception/iu);
	assert.match(interactive, /Guided wizards require an interactive terminal/iu);
	assert.match(interactive, /Guided creation makes one task/iu);
	assert.match(interactive, /Compact line batches[\s\S]{0,100}(?:file|stdin)/iu);
});

test('DOCS-129 through DOCS-133 expose the versionless public maturity and navigation structure', async () => {
	const sources = new Map(await Promise.all(
		['129', '130', '131', '132', '133'].map(async number => [number, await sourceDoc(number)]),
	));
	for (const number of ['129', '130', '131', '132']) {
		assert.match(sources.get(number), /> \*\*Maturity:\*\* Public .*Developer API.*Obsidian Desktop.*Runtime API V1/iu);
	}
	assert.match(
		sources.get('133'),
		/> \*\*Maturity:\*\* Public CLI JSONL session protocol.*Obsidian Desktop.*CLI contract V1/iu,
	);
	for (const number of ['130', '131', '132', '133']) {
		assert.match(sources.get(number), /^## (?:Where to go next|Related)$/mu);
	}
});

test('Developer API docs preserve projected discovery and typed result distinctions', async () => {
	const [overview, identity, reads] = await Promise.all([
		sourceDoc('129'),
		sourceDoc('130'),
		sourceDoc('131'),
	]);
	assert.match(overview, /operon-cli\/contracts\/v1\/developer-api/u);
	assert.match(overview, /"system\.health"/u);
	assert.match(overview, /"system\.capabilities"/u);
	assert.match(overview, /projected/iu);
	assert.match(overview, /not an unrestricted list/iu);
	assert.match(reads, /system\.diagnostics\(\)/u);
	assert.match(reads, /exact `system\.diagnostics` grant/iu);
	assert.match(reads, /status `applied`[\s\S]*postflight status of `verified`/iu);
	assert.match(reads, /`already-applied`[\s\S]*`receipt-replay`[\s\S]*no source write/iu);
	assert.match(identity, /access and mutation preview, apply, and recovery inputs must not add/iu);
	assert.match(identity, /Runtime read DTOs still require a caller-generated `requestId`/iu);
});

test('Generated docs and manifest are byte-identical to all source docs', async () => {
	const sourceFiles = await managedFiles(sourceRoot);
	const generatedFiles = await managedFiles(generatedRoot);
	assert.deepEqual(generatedFiles, sourceFiles);
	const manifest = JSON.parse(await readFile(path.join(generatedRoot, 'manifest.json'), 'utf8'));
	assert.equal(manifest.schemaVersion, 1);
	assert.equal(manifest.packageId, 'operon-docs');
	assert.equal(manifest.files.length, sourceFiles.length);
	const records = new Map(manifest.files.map(record => [record.path, record]));

	for (const file of sourceFiles) {
		const source = await readFile(path.join(sourceRoot, file));
		const generated = await readFile(path.join(generatedRoot, file));
		assert.deepEqual(generated, source, `${file} differs from its canonical source.`);
		const record = records.get(file);
		assert.ok(record, `${file} is absent from the generated manifest.`);
		assert.equal(record.bytes, source.byteLength);
		assert.equal(record.sha256, sha256(source));
	}
});

test('README and discoverable contracts expose the documented public boundary', async () => {
	const [readme, manifestSource, packageSource] = await Promise.all([
		readFile(path.join(cliPackageRoot, 'README.md'), 'utf8'),
		readFile(path.join(cliPackageRoot, 'cli-manifest-v1.json'), 'utf8'),
		readFile(path.join(cliPackageRoot, 'package.json'), 'utf8'),
	]);
	const manifest = JSON.parse(manifestSource);
	const packageDocument = JSON.parse(packageSource);

	assert.match(readme, /npm install --global operon-cli/u);
	assert.match(readme, /Node(?:\.js)? 22, 24, (?:and|or) 26/iu);
	assert.match(readme, /macOS/u);
	assert.match(readme, /Linux/u);
	assert.match(readme, /Windows 11/u);
	assert.match(readme, /WSL/u);
	assert.match(readme, /public beta/iu);
	assert.match(readme, /recoveryRef/u);
	assert.match(readme, /operon-cli\/contracts\/v1\/developer-api/u);
	assert.doesNotMatch(readme, /^## \d+\.\d+/mu, 'README must not copy the package version.');
	assert.equal(packageDocument.engines.node, '^22.0.0 || ^24.0.0 || ^26.0.0');
	assert.deepEqual(manifest.platforms, {
		darwin: 'supported',
		linux: 'acceptance-required',
		win32: 'acceptance-required',
		wsl: 'unsupported',
	});
	assert.equal(manifest.exitCodes.interrupted, 130);
	assert.equal(manifest.exitCodes.runtimeFailure, 5);
	assert.equal(manifest.protocols.sessionJsonl.invocation, 'operon session --jsonl');
	assert.equal(manifest.protocols.sessionJsonl.readGroupMin, 2);
	assert.equal(manifest.protocols.sessionJsonl.readGroupMax, 8);
	assert.equal(manifest.protocols.sessionJsonl.abortExitCode, 130);
});

test('DOCS-133 JSONL examples validate against the shipped session schemas', async () => {
	const validate = await publicSchemaValidators();

	const source = await sourceDoc('133');
	const blocks = [...source.matchAll(/```json\n([\s\S]*?)\n```/gu)]
		.map(match => match[1].split('\n').map(line => JSON.parse(
			line.replaceAll('<same-plan-ref>', `p${'a'.repeat(31)}`),
		)));
	assert.equal(blocks.length, 5);
	for (const frame of blocks[0]) validate('session-frame', frame);
	validate('session-result', blocks[1][0]);
	validate('session-read-group', blocks[2][0]);
	const readGroup = blocks[2][0];
	const childIds = readGroup.reads.map(child => child.id);
	assert.equal(new Set(childIds).size, childIds.length);
	assert.ok(!childIds.includes(readGroup.id));
	validate('session-uncertain-result', blocks[3][0]);
	validate('session-frame', blocks[4][0]);
});

test('DOCS-133 distinguishes protocol IDs, argv prefixes, and frame exit status', async () => {
	const source = await sourceDoc('133');
	const manifest = JSON.parse(await readFile(
		path.join(cliPackageRoot, 'cli-manifest-v1.json'),
		'utf8',
	));
	assert.deepEqual(
		manifest.protocols.sessionJsonl.readGroupCommands,
		['health', 'task.get', 'tasks.query', 'context.build'],
	);
	for (const row of [
		/\| `health` \| `\["health"\]` \|/u,
		/\| `task\.get` \| `\["task", "get"\]` \|/u,
		/\| `tasks\.query` \| `\["query"\]` \|/u,
		/\| `context\.build` \| `\["context"\]` \|/u,
	]) assert.match(source, row);
	assert.match(source, /\["tasks\.query"\][\s\S]*not commands/iu);
	assert.match(source, /child IDs must be unique/iu);
	assert.match(source, /Reusing an ID in a separate top-level frame is valid/iu);
	assert.match(source, /frame-level usage failures[\s\S]{0,80}exit `2`/iu);
	assert.match(source, /process may exit `0`/iu);
	assert.match(source, /Inspect every response envelope's `exitCode`/iu);
	assert.match(source, /stdout preserves request order/iu);
	assert.match(source, /group ID does not receive a separate response/iu);
	assert.match(source, /exits `130`/iu);
	assert.match(source, /emits exit `5`[\s\S]*outcome-unknown/iu);
});

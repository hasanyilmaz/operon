import assert from 'node:assert/strict';
import { TFile, parseYaml, stringifyYaml } from 'obsidian';
import { TaskWriter } from '../src/core/task-writer';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function ok(value: unknown, message?: string): asserts value {
	assert.ok(value, message);
	assertions += 1;
}

class FakeFile extends TFile {
	constructor(path: string) {
		super(...([path] as unknown as []));
		Object.assign(this, {
			path,
			name: path.split('/').pop() ?? path,
			basename: (path.split('/').pop() ?? path).replace(/\.[^.]+$/u, ''),
			extension: 'md',
		});
	}
}

class FakeApp {
	readonly file = new FakeFile('Tasks/Plain file.md');
	content: string;
	processFrontMatterCalls = 0;
	processCalls = 0;
	throwProcessFrontMatter = false;
	throwAfterProcessFrontMatter = false;
	throwProcess = false;
	throwAfterProcess = false;
	throwRead = false;
	throwReadAfterFrontmatter = false;
	mutateBeforeProcessCallback: (() => void) | null = null;
	mutateBeforeFrontmatterCallback: (() => void) | null = null;

	constructor(content: string) {
		this.content = content;
	}

	readonly vault = {
		getAbstractFileByPath: (path: string): TFile | null => path === this.file.path ? this.file : null,
		read: async (_file: TFile): Promise<string> => {
			if (this.throwRead) throw new Error('read failed');
			return this.content;
		},
		process: async (_file: TFile, mutate: (content: string) => string): Promise<string> => {
			this.processCalls += 1;
			if (this.throwProcess) throw new Error('process failed');
			this.mutateBeforeProcessCallback?.();
			this.mutateBeforeProcessCallback = null;
			this.content = mutate(this.content);
			if (this.throwAfterProcess) throw new Error('process acknowledgement lost');
			return this.content;
		},
	};

	readonly fileManager = {
		processFrontMatter: async (_file: TFile, mutate: (frontmatter: Record<string, unknown>) => void): Promise<void> => {
			this.processFrontMatterCalls += 1;
			if (this.throwProcessFrontMatter) throw new Error('processFrontMatter failed');
			this.mutateBeforeFrontmatterCallback?.();
			this.mutateBeforeFrontmatterCallback = null;
			const match = this.content.match(/^(---\n)([\s\S]*?)(\n---\n)([\s\S]*)$/u);
			if (!match) throw new Error('missing test frontmatter');
			const frontmatter = parseYaml(match[2]);
			mutate(frontmatter);
			this.content = `${match[1]}${stringifyYaml(frontmatter).trimEnd()}${match[3]}${match[4]}`;
			if (this.throwReadAfterFrontmatter) this.throwRead = true;
			if (this.throwAfterProcessFrontMatter) throw new Error('frontmatter acknowledgement lost');
		},
	};
}

function createIndexer(duplicate = false): any {
	return {
		getTask: (operonId: string) => operonId === 'ABC1234' ? {
			operonId,
			primary: { format: 'yaml', filePath: 'Tasks/Plain file.md', lineNumber: 0 },
		} : undefined,
		hasDuplicateOperonIdConflict: () => duplicate,
	};
}

const keyMappings: any[] = [
	{ canonicalKey: 'status', visiblePropertyName: 'Status', type: 'text', sync: 'yes', enabled: true, isSystem: true },
	{ canonicalKey: 'datetimeCreated', visiblePropertyName: 'Created', type: 'datetime', sync: 'no', enabled: true, isSystem: true },
	{ canonicalKey: 'customField', visiblePropertyName: 'Custom Visible', type: 'text', sync: 'yes', enabled: true, isSystem: false, description: 'Custom value' },
];

const source = [
	'---',
	'operonId: ABC1234',
	'Status: Todo',
	'status: Todo',
	'datetimeCreated: 2026-01-01T00:00:01',
	'dateCreated: 2026-01-01',
	'Custom Visible: keep me',
	'priority: high',
	'tags: keep',
	'owner: untouched',
	'---',
	'# Keep this body',
	'',
].join('\n');

async function run(): Promise<void> {
	const app = new FakeApp(source);
	const writer = new TaskWriter(app as any, createIndexer(), keyMappings);
	const catalog = await writer.getPlainFileTaskPropertyCatalog('ABC1234');
	ok(catalog.outcome === 'ready', 'catalog must resolve current YAML task properties');
	if (catalog.outcome !== 'ready') return;
	equal(catalog.properties[0]?.canonicalKey, 'operonId', 'identity is first and available');
	ok(catalog.properties.some(option => option.canonicalKey === 'customField'));
	ok(!catalog.properties.some(option => option.propertyName === 'owner'), 'unmanaged properties are never offered');

	const detached = await writer.detachYamlTaskProperties(
		'ABC1234',
		catalog.expectedContent,
		['operonId', 'status', 'datetimeCreated', 'customField'],
	);
	equal(detached.outcome, 'detached');
	equal(app.processFrontMatterCalls, 1, 'all selected aliases use exactly one frontmatter transaction');
	ok(!app.content.includes('operonId:'), 'identity is removed');
	ok(!app.content.includes('Status:'), 'visible status alias is removed');
	ok(!app.content.includes('status:'), 'canonical status alias is removed');
	ok(!app.content.includes('datetimeCreated:'), 'canonical datetime alias is removed');
	ok(!app.content.includes('dateCreated:'), 'legacy datetime alias is removed');
	ok(!app.content.includes('Custom Visible:'), 'custom visible property is removed');
	ok(app.content.includes('priority: high'), 'unselected managed property remains');
	ok(app.content.includes('tags: keep'), 'tags remain');
	ok(app.content.includes('owner: untouched'), 'unmanaged property remains');
	ok(app.content.endsWith('# Keep this body\n'), 'body remains byte-for-byte after frontmatter');

	const staleApp = new FakeApp(source);
	const staleWriter = new TaskWriter(staleApp as any, createIndexer(), keyMappings);
	const staleCatalog = await staleWriter.getPlainFileTaskPropertyCatalog('ABC1234');
	ok(staleCatalog.outcome === 'ready');
	if (staleCatalog.outcome === 'ready') {
		staleApp.content = `${source}\nchanged`;
		const stale = await staleWriter.detachYamlTaskProperties('ABC1234', staleCatalog.expectedContent, ['operonId']);
		equal(stale.outcome, 'conflict', 'changed source fails closed');
		equal(staleApp.processFrontMatterCalls, 0, 'stale source never enters the mutation callback');
		}

	const callbackRaceApp = new FakeApp(source);
	const callbackRaceWriter = new TaskWriter(callbackRaceApp as any, createIndexer(), keyMappings);
	const callbackRaceCatalog = await callbackRaceWriter.getPlainFileTaskPropertyCatalog('ABC1234');
	ok(callbackRaceCatalog.outcome === 'ready');
	if (callbackRaceCatalog.outcome === 'ready') {
		callbackRaceApp.mutateBeforeFrontmatterCallback = () => {
			callbackRaceApp.content = callbackRaceApp.content.replace('Status: Todo', 'Status: Doing');
		};
		const callbackRace = await callbackRaceWriter.detachYamlTaskProperties(
			'ABC1234',
			callbackRaceCatalog.expectedContent,
			['operonId', 'status'],
		);
		equal(callbackRace.outcome, 'conflict', 'callback-time property changes fail closed');
		equal(callbackRaceApp.processFrontMatterCalls, 1);
		ok(callbackRaceApp.content.includes('Status: Doing'), 'external change remains intact');
		ok(callbackRaceApp.content.includes('operonId: ABC1234'), 'identity is not partially removed');
	}

	const blockerRaceApp = new FakeApp(source);
	const blockerRaceWriter = new TaskWriter(blockerRaceApp as any, createIndexer(), keyMappings);
	const blockerRaceCatalog = await blockerRaceWriter.getPlainFileTaskPropertyCatalog('ABC1234');
	ok(blockerRaceCatalog.outcome === 'ready');
	if (blockerRaceCatalog.outcome === 'ready') {
		blockerRaceApp.mutateBeforeFrontmatterCallback = () => {
			blockerRaceApp.content = blockerRaceApp.content.replace('priority: high', 'priority: high\nparentTask: PARENT1');
		};
		const blockerRace = await blockerRaceWriter.detachYamlTaskProperties(
			'ABC1234',
			blockerRaceCatalog.expectedContent,
			['operonId'],
		);
		equal(blockerRace.outcome, 'conflict', 'callback-time blocker additions fail closed');
		ok(blockerRaceApp.content.includes('parentTask: PARENT1'), 'new blocker remains intact');
		ok(blockerRaceApp.content.includes('operonId: ABC1234'), 'identity remains when a blocker races the cleanup');
	}

	const duplicateApp = new FakeApp(source);
	const duplicateWriter = new TaskWriter(duplicateApp as any, createIndexer(true), keyMappings);
	const duplicate = await duplicateWriter.detachYamlTaskProperties('ABC1234', source, ['operonId']);
	equal(duplicate.outcome, 'conflict', 'duplicate identity conflicts fail closed');
		equal(duplicateApp.processFrontMatterCalls, 0);

	const failureApp = new FakeApp(source);
	failureApp.throwProcessFrontMatter = true;
	const failureWriter = new TaskWriter(failureApp as any, createIndexer(), keyMappings);
	const originalConsoleError = console.error;
	console.error = () => undefined;
	const failed = await failureWriter.detachYamlTaskProperties('ABC1234', source, ['operonId']);
	console.error = originalConsoleError;
	equal(failed.outcome, 'failed', 'frontmatter failure is surfaced without a partial report');
	equal(failureApp.content, source, 'failed transaction leaves source unchanged');

	const acknowledgedLateApp = new FakeApp(source);
	acknowledgedLateApp.throwAfterProcessFrontMatter = true;
	const acknowledgedLateWriter = new TaskWriter(acknowledgedLateApp as any, createIndexer(), keyMappings);
	console.error = () => undefined;
	const acknowledgedLate = await acknowledgedLateWriter.detachYamlTaskProperties('ABC1234', source, ['operonId']);
	console.error = originalConsoleError;
	equal(acknowledgedLate.outcome, 'detached', 'committed YAML cleanup survives acknowledgement loss');
	ok(!acknowledgedLateApp.content.includes('operonId:'), 'readback recognizes the committed cleanup');

	const postReadFailureApp = new FakeApp(source);
	postReadFailureApp.throwReadAfterFrontmatter = true;
	const postReadFailureWriter = new TaskWriter(postReadFailureApp as any, createIndexer(), keyMappings);
	const postReadFailure = await postReadFailureWriter.detachYamlTaskProperties('ABC1234', source, ['operonId']);
	equal(postReadFailure.outcome, 'detached', 'post-commit read failure never reclassifies a committed YAML cleanup');
	equal(postReadFailure.committedContent, undefined, 'unverified committed source is reported explicitly');

	const inlineSource = '# Tasks\n- [ ] Task {{operonId:: ABC1234}}\n';
	const exactApp = new FakeApp(inlineSource);
	const exactWriter = new TaskWriter(exactApp as any, createIndexer(), keyMappings);
	const exact = await exactWriter.applyExactMarkdownSourceMutation(
		exactApp.file.path,
		inlineSource,
		'# Tasks\n- [ ] Task\n',
	);
	equal(exact.outcome, 'committed', 'exact Markdown source commits through one atomic process call');
	equal(exactApp.processCalls, 1);
	equal(exact.committedContent, '# Tasks\n- [ ] Task\n');

	const racedApp = new FakeApp(inlineSource);
	const racedWriter = new TaskWriter(racedApp as any, createIndexer(), keyMappings);
	racedApp.mutateBeforeProcessCallback = () => {
		racedApp.content = `${inlineSource}external change\n`;
	};
	const raced = await racedWriter.applyExactMarkdownSourceMutation(
		racedApp.file.path,
		inlineSource,
		'# Tasks\n- [ ] Task\n',
	);
	equal(raced.outcome, 'conflict', 'callback-time source drift aborts atomically');
	equal(racedApp.content, `${inlineSource}external change\n`, 'external source change is never overwritten');

	const processFailureApp = new FakeApp(inlineSource);
	processFailureApp.throwProcess = true;
	const processFailureWriter = new TaskWriter(processFailureApp as any, createIndexer(), keyMappings);
	console.error = () => undefined;
	const processFailed = await processFailureWriter.applyExactMarkdownSourceMutation(
		processFailureApp.file.path,
		inlineSource,
		'# Tasks\n- [ ] Task\n',
	);
	console.error = originalConsoleError;
	equal(processFailed.outcome, 'failed', 'atomic process failures are surfaced');
	equal(processFailureApp.content, inlineSource, 'failed atomic process keeps the original source');

	const processAcknowledgedLateApp = new FakeApp(inlineSource);
	processAcknowledgedLateApp.throwAfterProcess = true;
	const processAcknowledgedLateWriter = new TaskWriter(processAcknowledgedLateApp as any, createIndexer(), keyMappings);
	console.error = () => undefined;
	const processAcknowledgedLate = await processAcknowledgedLateWriter.applyExactMarkdownSourceMutation(
		processAcknowledgedLateApp.file.path,
		inlineSource,
		'# Tasks\n- [ ] Task\n',
	);
	console.error = originalConsoleError;
	equal(processAcknowledgedLate.outcome, 'committed', 'atomic source mutation recognizes commit after acknowledgement loss');
	equal(processAcknowledgedLate.committedContent, '# Tasks\n- [ ] Task\n');

	console.log(`Task writer plain-file cleanup: ${assertions}/${assertions} passed`);
}

globalThis.__operonTaskWriterDeoperonCleanupTestRun = run();

declare global {
	var __operonTaskWriterDeoperonCleanupTestRun: Promise<void> | undefined;
}

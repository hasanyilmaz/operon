import assert from 'node:assert/strict';
import { TFile, parseYaml, stringifyYaml } from 'obsidian';
import { TaskWriter, type TaskWriterIndexerPort } from '../src/core/task-writer';
import { analyzeTaskSourceRelationshipAuthority } from '../src/core/task-source-relationship-authority';

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
			stat: { ctime: Date.now(), mtime: Date.now(), size: 0 },
		});
	}
}

class FakeApp {
	readonly file = new FakeFile('Tasks/Plain file.md');
	readonly createdContents = new Map<string, string>();
	content: string;
	processFrontMatterCalls = 0;
	processCalls = 0;
	throwProcessFrontMatter = false;
	throwAfterProcessFrontMatter = false;
	throwProcess = false;
	throwAfterProcess = false;
	throwRead = false;
	throwReadAfterFrontmatter = false;
	trashed = false;
	mutateBeforeProcessCallback: (() => void) | null = null;
	mutateBeforeFrontmatterCallback: (() => void) | null = null;

	constructor(content: string) {
		this.content = content;
	}

	readonly vault = {
		getAbstractFileByPath: (path: string): TFile | null => {
			if (path === this.file.path) return this.file;
			return this.createdContents.has(path) ? new FakeFile(path) : null;
		},
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
		create: async (path: string, content: string): Promise<TFile> => {
			this.createdContents.set(path, content);
			return new FakeFile(path);
		},
		modify: async (_file: TFile, content: string): Promise<void> => {
			this.content = content;
		},
	};

	readonly fileManager = {
		trashFile: async (_file: TFile): Promise<void> => {
			this.trashed = true;
		},
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
		isPathIndexable: () => true,
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

function testTaskSourceRelationshipAuthority(): void {
	const mappings = [
		...keyMappings,
		{ canonicalKey: 'operonId', visiblePropertyName: 'Task ID', type: 'text', sync: 'yes', enabled: true, isSystem: true },
		{ canonicalKey: 'parentTask', visiblePropertyName: 'Parent Task', type: 'text', sync: 'yes', enabled: true, isSystem: true },
		{ canonicalKey: 'blocking', visiblePropertyName: 'Blocks', type: 'list', sync: 'auto', enabled: true, isSystem: true },
		{ canonicalKey: 'blockedBy', visiblePropertyName: 'Blocked By', type: 'list', sync: 'auto', enabled: true, isSystem: true },
	];
	const indexed = new Set<string>();
	const duplicateIndexed = new Set<string>();
	const analyze = (content: string, pathIndexable = true) => analyzeTaskSourceRelationshipAuthority({
		content,
		filePath: 'Authority.md',
		keyMappings: mappings,
		pathIndexable,
		indexedTargetExists: operonId => indexed.has(operonId) && !duplicateIndexed.has(operonId),
	});

	ok(analyze([
		'---',
		'operonId: par0001',
		'Task ID: par0001',
		'---',
		'- [ ] Child {{operonId:: chd0001}} {{parentTask:: par0001}}',
	].join('\n')).valid, 'mirrored YAML aliases count as one same-source identity');
	ok(analyze([
		'---',
		'operonId: par0002',
		'Task ID: " "',
		'---',
		'- [ ] Child {{operonId:: chd0002}} {{parentTask:: par0002}}',
	].join('\n')).valid, 'blank YAML aliases do not make the canonical identity ambiguous');

	indexed.add('dup0001');
	ok(!analyze([
		'- [ ] First {{operonId:: dup0001}}',
		'- [ ] Duplicate {{operonId:: dup0001}}',
		'- [ ] Child {{operonId:: chd0003}} {{parentTask:: dup0001}}',
	].join('\n')).valid, 'duplicate local identities fail closed before indexed fallback');
	ok(!analyze([
		'```markdown',
		'- [ ] Example {{operonId:: par0003}}',
		'```',
		'- [ ] Child {{operonId:: chd0004}} {{parentTask:: par0003}}',
	].join('\n')).valid, 'fenced task examples never authorize relationships');
	const fencedRelationship = analyze([
		'- [ ] Parent {{operonId:: par0004}}',
		'```markdown',
		'- [ ] Example {{operonId:: exm0001}} {{parentTask:: par0004}}',
		'```',
		'- [ ] Sibling {{operonId:: sib0001}}',
	].join('\n'));
	ok(fencedRelationship.valid, 'fenced relationships do not invalidate real same-source tasks');
	equal(
		fencedRelationship.relationships.some(record => record.targetIds.includes('par0004')),
		false,
		'fenced relationships do not create recovery fences',
	);
	indexed.add('par0005');
	ok(!analyze([
		'---',
		'operonId: " par0005 "',
		'---',
		'- [ ] Child {{operonId:: chd0005}} {{parentTask:: par0005}}',
	].join('\n')).valid, 'padded YAML identities cannot authorize through a stale index fallback');
	indexed.add('par0008');
	ok(!analyze([
		'- [ ] Parent {{operonId::  par0008 }}',
		'- [ ] Child {{operonId:: chd0019}} {{parentTask:: par0008}}',
	].join('\n')).valid, 'padded inline identities cannot authorize through a stale index fallback');
	indexed.add('ali0002');
	ok(!analyze([
		'- [ ] Parent {{operonId:: ali0001}} {{Task ID:: ali0002}}',
		'- [ ] Child {{operonId:: chd0021}} {{parentTask:: ali0002}}',
	].join('\n')).valid, 'conflicting inline identity aliases cannot authorize through a stale index fallback');
	indexed.add('dup0002');
	ok(!analyze([
		'- [ ] Parent {{operonId:: dup0002}} {{Task ID:: dup0002}}',
		'- [ ] Child {{operonId:: chd0022}} {{parentTask:: dup0002}}',
	].join('\n')).valid, 'duplicate inline identity aliases remain ambiguous before indexed fallback');
	ok(analyze([
		'- [ ] Parent {{operonId:: ali0003}} {{Task ID:: }}',
		'- [ ] Child {{operonId:: chd0023}} {{parentTask:: ali0003}}',
	].join('\n')).valid, 'a trailing blank inline alias does not hide the parser-authoritative identity');
	indexed.add('ali0004');
	ok(!analyze([
		'- [ ] Parent {{operonId:: }} {{Task ID:: ali0004}}',
		'- [ ] Child {{operonId:: chd0024}} {{parentTask:: ali0004}}',
	].join('\n')).valid, 'a later identity cannot override the parser-authoritative blank alias through stale index fallback');
	ok(!analyze([
		'---',
		'operonId: aaa0001',
		'Task ID: bbb0002',
		'---',
		'- [ ] Child {{operonId:: chd0006}} {{parentTask:: aaa0001}}',
	].join('\n')).valid, 'conflicting YAML aliases make every candidate ambiguous');
	indexed.add('par0007');
	ok(analyze([
		'---',
		'operonId: chd0011',
		'parentTask: par0007',
		'Parent Task: par0007',
		'---',
	].join('\n')).valid, 'mirrored relationship aliases with the same value are accepted');
	ok(!analyze([
		'---',
		'operonId: chd0012',
		'parentTask: par0007',
		'Parent Task: other01',
		'---',
	].join('\n')).valid, 'conflicting relationship aliases fail closed');
	indexed.add('blk0001');
	indexed.add('blk0002');
	ok(analyze([
		'---',
		'operonId: chd0013',
		'blocking:',
		'  - blk0001',
		'  - blk0002',
		'---',
	].join('\n')).valid, 'flat YAML dependency arrays retain every target');
	ok(!analyze([
		'---',
		'operonId: chd0014',
		'blockedBy:',
		'  - blk0001',
		'  - missing1',
		'---',
	].join('\n')).valid, 'a missing member of a YAML dependency array fails closed');
	ok(!analyze([
		'---',
		'operonId: chd0015',
		'blocking: { nested: blk0001 }',
		'---',
	].join('\n')).valid, 'unsupported YAML relationship objects fail closed');
	ok(!analyze([
		'---',
		'operonId: chd0016',
		'blockedBy: [[blk0001]]',
		'---',
	].join('\n')).valid, 'nested YAML relationship arrays fail closed');
	ok(!analyze('- [ ] Invalid owner {{operonId:: bad id}} {{parentTask:: par0007}}').valid,
		'invalid inline owners cannot bypass relationship recovery fences');
	ok(!analyze('- [ ] Missing owner {{parentTask:: par0007}}').valid,
		'missing inline owners cannot bypass relationship recovery fences');
	indexed.add('par0006');
	ok(!analyze([
		'- [ ] Parent {{operonId:: par0006}}',
		'- [ ] Child {{operonId:: chd0007}} {{parentTask:: par0006}}',
	].join('\n'), false).valid, 'excluded local identities fail closed even when a stale index fallback exists');
	ok(!analyze('- [ ] Child {{operonId:: chd0008}} {{parentTask:: mis0001}}').valid, 'missing local and indexed targets remain rejected');

	indexed.add('LEGACY1');
	indexed.add('ext0001');
	indexed.add('ext0002');
	ok(analyze('- [ ] Child {{operonId:: chd0009}} {{parentTask:: LEGACY1}}').valid, 'indexed legacy targets remain available');
	ok(analyze('- [ ] Child {{operonId:: chd0010}} {{parentTask:: ext0001}}').valid, 'external indexed targets remain available');
	ok(analyze([
		'- [ ] Unrelated invalid identity {{operonId:: bad id}}',
		'- [ ] Child {{operonId:: chd0020}} {{parentTask:: ext0002}}',
	].join('\n')).valid, 'an unrelated invalid local identity does not block a valid indexed external target');
	duplicateIndexed.add('ext0001');
	ok(!analyze('- [ ] Child {{operonId:: chd0017}} {{parentTask:: ext0001}}').valid,
		'duplicate indexed external targets fail closed');
	duplicateIndexed.delete('ext0001');
	const excludedExternal = analyze(
		'- [ ] Child {{operonId:: chd0018}} {{parentTask:: ext0001}}',
		false,
	);
	ok(excludedExternal.valid, 'excluded sources may still reference an unambiguous indexed external target');
	equal(excludedExternal.relationships.length, 0, 'excluded sources never create permanent recovery fences');
}

async function run(): Promise<void> {
	testTaskSourceRelationshipAuthority();
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
	equal(app.processCalls, 1, 'all selected aliases use exactly one whole-source transaction');
	equal(app.processFrontMatterCalls, 0, 'detachment never splits validation from the source commit');
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
		equal(staleApp.processCalls, 1, 'stale source is rejected inside the atomic mutation callback');
		}

	const callbackRaceApp = new FakeApp(source);
	const callbackRaceWriter = new TaskWriter(callbackRaceApp as any, createIndexer(), keyMappings);
	const callbackRaceCatalog = await callbackRaceWriter.getPlainFileTaskPropertyCatalog('ABC1234');
	ok(callbackRaceCatalog.outcome === 'ready');
	if (callbackRaceCatalog.outcome === 'ready') {
		callbackRaceApp.mutateBeforeProcessCallback = () => {
			callbackRaceApp.content = callbackRaceApp.content.replace('Status: Todo', 'Status: Doing');
		};
		const callbackRace = await callbackRaceWriter.detachYamlTaskProperties(
			'ABC1234',
			callbackRaceCatalog.expectedContent,
			['operonId', 'status'],
		);
		equal(callbackRace.outcome, 'conflict', 'callback-time property changes fail closed');
		equal(callbackRaceApp.processCalls, 1);
		ok(callbackRaceApp.content.includes('Status: Doing'), 'external change remains intact');
		ok(callbackRaceApp.content.includes('operonId: ABC1234'), 'identity is not partially removed');
	}

	const blockerRaceApp = new FakeApp(source);
	const blockerRaceWriter = new TaskWriter(blockerRaceApp as any, createIndexer(), keyMappings);
	const blockerRaceCatalog = await blockerRaceWriter.getPlainFileTaskPropertyCatalog('ABC1234');
	ok(blockerRaceCatalog.outcome === 'ready');
	if (blockerRaceCatalog.outcome === 'ready') {
		blockerRaceApp.mutateBeforeProcessCallback = () => {
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

	const bodyRaceApp = new FakeApp(source);
	const bodyRaceWriter = new TaskWriter(bodyRaceApp as any, createIndexer(), keyMappings);
	bodyRaceApp.mutateBeforeProcessCallback = () => {
		bodyRaceApp.content = bodyRaceApp.content.replace('# Keep this body', '# Externally edited body');
	};
	const bodyRace = await bodyRaceWriter.detachYamlTaskProperties('ABC1234', source, ['operonId']);
	equal(bodyRace.outcome, 'conflict', 'callback-time body edits fail closed');
	ok(bodyRaceApp.content.includes('operonId: ABC1234'), 'body races never remove identity');

	const unmanagedRaceApp = new FakeApp(source);
	const unmanagedRaceWriter = new TaskWriter(unmanagedRaceApp as any, createIndexer(), keyMappings);
	unmanagedRaceApp.mutateBeforeProcessCallback = () => {
		unmanagedRaceApp.content = unmanagedRaceApp.content.replace('owner: untouched', 'owner: externally changed');
	};
	const unmanagedRace = await unmanagedRaceWriter.detachYamlTaskProperties('ABC1234', source, ['operonId']);
	equal(unmanagedRace.outcome, 'conflict', 'callback-time unselected property edits fail closed');
	ok(unmanagedRaceApp.content.includes('operonId: ABC1234'), 'unselected property races never remove identity');

	const duplicateApp = new FakeApp(source);
	const duplicateWriter = new TaskWriter(duplicateApp as any, createIndexer(true), keyMappings);
	const duplicate = await duplicateWriter.detachYamlTaskProperties('ABC1234', source, ['operonId']);
	equal(duplicate.outcome, 'conflict', 'duplicate identity conflicts fail closed');
	equal(duplicateApp.processCalls, 0);

	const failureApp = new FakeApp(source);
	failureApp.throwProcess = true;
	const failureWriter = new TaskWriter(failureApp as any, createIndexer(), keyMappings);
	const originalConsoleError = console.error;
	console.error = () => undefined;
	const failed = await failureWriter.detachYamlTaskProperties('ABC1234', source, ['operonId']);
	console.error = originalConsoleError;
	equal(failed.outcome, 'failed', 'whole-source failure is surfaced without a partial report');
	equal(failureApp.content, source, 'failed transaction leaves source unchanged');

	const acknowledgedLateApp = new FakeApp(source);
	acknowledgedLateApp.throwAfterProcess = true;
	const acknowledgedLateWriter = new TaskWriter(acknowledgedLateApp as any, createIndexer(), keyMappings);
	console.error = () => undefined;
	const acknowledgedLate = await acknowledgedLateWriter.detachYamlTaskProperties('ABC1234', source, ['operonId']);
	console.error = originalConsoleError;
	equal(acknowledgedLate.outcome, 'detached', 'committed YAML cleanup survives acknowledgement loss');
	ok(!acknowledgedLateApp.content.includes('operonId:'), 'readback recognizes the committed cleanup');

	const guardedApp = new FakeApp(source);
	const guardedWriter = new TaskWriter(guardedApp as any, createIndexer(), keyMappings);
	const guarded = await guardedWriter.detachYamlTaskProperties('ABC1234', source, ['operonId'], () => false);
	equal(guarded.outcome, 'conflict', 'transaction-time blocker guard fails closed');
	ok(guardedApp.content.includes('operonId: ABC1234'), 'guard rejection keeps identity intact');

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
	const guardedInlineSource = '# Tasks\n- [ ] Task {{operonId:: ABC1234}} {{Status:: Todo}}\n';
	const guardedExpectedMatch = exactWriter.renderGuardedTaskSourceContent(
		exactApp.file.path,
		guardedInlineSource,
		[{
			operonId: 'ABC1234',
			format: 'inline',
			lineNumber: 1,
			fieldValues: { status: 'Doing' },
			expectedFieldValues: { status: 'Todo' },
		}],
	);
	ok(guardedExpectedMatch.ok, 'guarded source rendering accepts matching sealed field preconditions');
	const guardedExpectedMismatch = exactWriter.renderGuardedTaskSourceContent(
		exactApp.file.path,
		guardedInlineSource,
		[{
			operonId: 'ABC1234',
			format: 'inline',
			lineNumber: 1,
			fieldValues: { status: 'Doing' },
			expectedFieldValues: { status: 'Blocked' },
		}],
	);
	equal(guardedExpectedMismatch.reason, 'expected-fields-mismatch', 'stale sealed task fields fail closed before rendering');
	const guardedCheckboxMismatch = exactWriter.renderGuardedTaskSourceContent(
		exactApp.file.path,
		guardedInlineSource,
		[{
			operonId: 'ABC1234',
			format: 'inline',
			lineNumber: 1,
			fieldValues: { status: 'Doing' },
			expectedFieldValues: { status: 'Todo' },
			expectedCheckbox: 'done',
		}],
	);
	equal(guardedCheckboxMismatch.reason, 'expected-fields-mismatch', 'terminal-state drift fails closed before rendering');
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

	const exclusiveApp = new FakeApp(inlineSource);
	const exclusiveWriter = new TaskWriter(exclusiveApp as any, createIndexer(), keyMappings);
	let queuedMutation: ReturnType<TaskWriter['applyExactMarkdownSourceMutation']> | undefined;
	await exclusiveWriter.runExclusiveTaskMutation(async permit => {
		const inside = await exclusiveWriter.applyExactMarkdownSourceMutation(
			exclusiveApp.file.path,
			inlineSource,
			'# Tasks\n- [ ] First\n',
			undefined,
			permit,
		);
		equal(inside.outcome, 'committed', 'exclusive permit commits without deadlocking itself');
		queuedMutation = exclusiveWriter.applyExactMarkdownSourceMutation(
			exclusiveApp.file.path,
			'# Tasks\n- [ ] First\n',
			'# Tasks\n- [ ] Second\n',
		);
		await Promise.resolve();
		equal(exclusiveApp.processCalls, 1, 'ordinary writers wait while conversion holds the exclusive lease');
	});
	ok(queuedMutation, 'queued mutation is captured');
	const afterExclusive = await queuedMutation;
	equal(afterExclusive.outcome, 'committed', 'queued writer resumes after the exclusive lease');
	equal(exclusiveApp.processCalls, 2);

	const relationshipSource = [
		'---',
		'operonId: CHILD1',
		'Status: Todo',
		'---',
		'# Child',
		'',
	].join('\n');
	const relationshipApp = new FakeApp(relationshipSource);
	const relationshipTasks = new Map<string, any>([
		['ABC1234', { operonId: 'ABC1234', primary: { format: 'yaml', filePath: 'Tasks/Parent.md', lineNumber: 0 }, fieldValues: {} }],
		['BLOCK2', { operonId: 'BLOCK2', primary: { format: 'yaml', filePath: 'Tasks/Blocker.md', lineNumber: 0 }, fieldValues: {} }],
		['CHILD1', { operonId: 'CHILD1', primary: { format: 'yaml', filePath: relationshipApp.file.path, lineNumber: 0 }, fieldValues: {} }],
	]);
	const relationshipIndexer: TaskWriterIndexerPort = {
		getTask: (operonId: string) => relationshipTasks.get(operonId),
		hasDuplicateOperonIdConflict: () => false,
		isPathIndexable: () => true,
		scheduleReindex: () => undefined,
		reindexFilePath: async () => undefined,
		reindexFilesBatch: async () => undefined,
	};
	const relationshipWriter = new TaskWriter(relationshipApp as any, relationshipIndexer, keyMappings);
	let queuedRelationship: Promise<boolean> | undefined;
	await relationshipWriter.runExclusiveTaskMutation(async () => {
		queuedRelationship = relationshipWriter.writeTaskFields(
			'CHILD1',
			{ parentTask: 'ABC1234' },
			{ touchAncestors: false },
		);
		await Promise.resolve();
		relationshipTasks.delete('ABC1234');
	});
	ok(queuedRelationship, 'relationship write is queued behind conversion');
	const relationshipWritten = await queuedRelationship;
	equal(relationshipWritten, false, 'queued relationship fails when conversion removed its target');
	ok(!relationshipApp.content.includes('parentTask:'), 'stale parent reference is never committed');

	relationshipTasks.set('ABC1234', {
		operonId: 'ABC1234',
		primary: { format: 'yaml', filePath: 'Tasks/Parent.md', lineNumber: 0 },
		fieldValues: {},
	});
	let queuedSourceMutation: ReturnType<TaskWriter['applyTaskSourceMutation']> | undefined;
	await relationshipWriter.runExclusiveTaskMutation(async () => {
		queuedSourceMutation = relationshipWriter.applyTaskSourceMutation({
			kind: 'modify',
			filePath: relationshipApp.file.path,
			expectedContent: relationshipSource,
			nextContent: relationshipSource.replace('Status: Todo', 'Status: Todo\nparentTask: ABC1234'),
		});
		await Promise.resolve();
		relationshipTasks.delete('ABC1234');
	});
	ok(queuedSourceMutation, 'planned source mutation is queued behind conversion');
	const sourceMutation = await queuedSourceMutation;
	equal(sourceMutation.outcome, 'conflict', 'queued source plan rechecks relationship targets after conversion');
	ok(!relationshipApp.content.includes('parentTask:'), 'stale source plan never commits a removed parent');

	const duplicateTargetApp = new FakeApp(relationshipSource);
	const duplicateTargetWriter = new TaskWriter(duplicateTargetApp as any, {
		...relationshipIndexer,
		getTask: operonId => relationshipTasks.get(operonId),
		hasDuplicateOperonIdConflict: operonId => operonId === 'ABC1234',
	}, keyMappings);
	const duplicateTargetMutation = await duplicateTargetWriter.applyTaskSourceMutation({
		kind: 'modify',
		filePath: duplicateTargetApp.file.path,
		expectedContent: relationshipSource,
		nextContent: relationshipSource.replace('Status: Todo', 'Status: Todo\nparentTask: ABC1234'),
	});
	equal(duplicateTargetMutation.outcome, 'conflict', 'duplicate indexed targets fail closed in TaskWriter');
	ok(!duplicateTargetApp.content.includes('parentTask:'), 'duplicate targets are never committed');

	const sameSourceContent = [
		'---',
		'operonId: par0001',
		'---',
		'- [ ] Child {{operonId:: chd0001}} {{parentTask:: par0001}}',
		'',
	].join('\n');
	const sameSourceApp = new FakeApp('');
	const sameSourceIndexer: TaskWriterIndexerPort = {
		...relationshipIndexer,
		getTask: () => undefined,
	};
	const sameSourceWriter = new TaskWriter(sameSourceApp as any, sameSourceIndexer, keyMappings);
	const sameSourceCreated = await sameSourceWriter.applyTaskSourceMutation({
		kind: 'create',
		filePath: 'Same source.md',
		nextContent: sameSourceContent,
	});
	equal(sameSourceCreated.outcome, 'committed', 'one exact local identity may authorize a same-source relationship');
	equal(sameSourceApp.createdContents.get('Same source.md'), sameSourceContent);
	const sameSourceModifyApp = new FakeApp(sameSourceContent);
	const sameSourceModifyWriter = new TaskWriter(
		sameSourceModifyApp as any,
		sameSourceIndexer,
		keyMappings,
	);
	const modifiedSameSourceContent = sameSourceContent.replace('Child', 'Updated child');
	const sameSourceModified = await sameSourceModifyWriter.applyTaskSourceMutation({
		kind: 'modify',
		filePath: sameSourceModifyApp.file.path,
		expectedContent: sameSourceContent,
		nextContent: modifiedSameSourceContent,
	});
	equal(sameSourceModified.outcome, 'committed', 'same-source authority also applies to exact modify writes');
	equal(sameSourceModifyApp.content, modifiedSameSourceContent);
	const trashedSource = await sameSourceModifyWriter.applyTaskSourceMutation({
		kind: 'trash',
		filePath: sameSourceModifyApp.file.path,
		expectedContent: modifiedSameSourceContent,
	});
	equal(trashedSource.outcome, 'committed');
	equal(trashedSource.deleted, true, 'committed trash writes carry exact index-removal semantics');
	equal(sameSourceModifyApp.trashed, true);

	relationshipApp.content = relationshipSource;
	relationshipTasks.set('ABC1234', {
		operonId: 'ABC1234',
		primary: { format: 'yaml', filePath: 'Tasks/Parent.md', lineNumber: 0 },
		fieldValues: {},
	});
	let releaseRelationshipReindex: (() => void) | undefined;
	let markRelationshipReindexStarted: (() => void) | undefined;
	const relationshipReindexStarted = new Promise<void>(resolve => {
		markRelationshipReindexStarted = resolve;
	});
	const relationshipReindexRelease = new Promise<void>(resolve => {
		releaseRelationshipReindex = resolve;
	});
	relationshipIndexer.reindexFilePath = async () => {
		markRelationshipReindexStarted?.();
		await relationshipReindexRelease;
		relationshipTasks.get('CHILD1').fieldValues.parentTask = 'ABC1234';
	};
	const writerFirst = relationshipWriter.writeTaskFields(
		'CHILD1',
		{ parentTask: 'ABC1234' },
		{ touchAncestors: false },
	);
	await relationshipReindexStarted;
	let conversionEntered = false;
	const conversionAfterWriter = relationshipWriter.runExclusiveTaskMutation(async () => {
		conversionEntered = true;
	});
	await Promise.resolve();
	equal(conversionEntered, false, 'conversion waits while a committed relationship is still reindexing');
	ok(releaseRelationshipReindex, 'relationship reindex release is captured');
	releaseRelationshipReindex();
	equal(await writerFirst, true, 'relationship write completes after secondary-index refresh');
	await conversionAfterWriter;
	equal(conversionEntered, true, 'conversion starts only after relationship visibility settles');
	equal(relationshipWriter.hasUnsettledRelationshipReference('ABC1234'), false, 'visible relationship clears the fail-closed fence');

	relationshipApp.content = relationshipSource;
	relationshipTasks.get('CHILD1').fieldValues = {};
	relationshipIndexer.reindexFilePath = async () => undefined;
	const unresolvedRelationship = await relationshipWriter.writeTaskFields(
		'CHILD1',
		{ parentTask: 'ABC1234' },
		{ touchAncestors: false },
	);
	equal(unresolvedRelationship, true, 'source write may complete when indexer suppresses its scan failure');
	equal(
		relationshipWriter.hasUnsettledRelationshipReference('ABC1234'),
		true,
		'failed relationship visibility keeps conversion fenced',
	);
	const secondUnresolvedRelationship = await relationshipWriter.writeTaskFields(
		'CHILD1',
		{ blocking: 'BLOCK2' },
		{ touchAncestors: false },
	);
	equal(secondUnresolvedRelationship, true, 'a second partial relationship patch can commit');
	equal(
		relationshipWriter.hasUnsettledRelationshipReference('ABC1234'),
		true,
		'a later partial patch cannot drop the first unresolved target fence',
	);
	equal(
		relationshipWriter.hasUnsettledRelationshipReference('BLOCK2'),
		true,
		'the later unresolved target is fenced as well',
	);

	console.log(`Task writer plain-file cleanup: ${assertions}/${assertions} passed`);
}

globalThis.__operonTaskWriterDeoperonCleanupTestRun = run();

declare global {
	var __operonTaskWriterDeoperonCleanupTestRun: Promise<void> | undefined;
}

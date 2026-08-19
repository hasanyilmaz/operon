import assert from 'node:assert/strict';
import { App, TFile } from 'obsidian';
import type { PeriodicNoteEffectiveConfig } from '../src/core/periodic-note-config';
import {
	PeriodicNoteService,
	type PeriodicNoteCreateResult,
	type PeriodicNoteDeterministicRenderInput,
	type PeriodicNoteFileState,
	type PeriodicNoteGuardedDeleteResult,
	type PeriodicNoteServicePorts,
	type PeriodicNoteTemplateSnapshot,
	type PeriodicNoteTemplaterFinalPathInput,
	type PeriodicNoteTemplaterFinalPathResult,
} from '../src/core/periodic-note-service';
import {
	createPeriodicNoteCreatedFileSnapshot,
	resolvePeriodicNoteContainerRegistrationDisposition,
	rollbackPeriodicNoteCreatedFileSnapshot,
} from '../src/core/periodic-note-container-registration';
import {
	FileTaskPipelineMover,
	parseFileTaskPipelineReconciliationMarkerV1,
} from '../src/systems/file-task-pipeline-mover';
import { DEFAULT_SETTINGS, migrateSettings, type OperonSettings } from '../src/types/settings';
import type { IndexedTask } from '../src/types/fields';
import type { OperonIndexer } from '../src/indexer/indexer';

declare global {
	// eslint-disable-next-line no-var
	var __operonPeriodicNoteServiceTestRun: Promise<void> | undefined;
}

type StoredEntry = { kind: 'file'; content: string } | { kind: 'other' };

class FakePorts implements PeriodicNoteServicePorts {
	readonly files = new Map<string, StoredEntry>();
	readonly templates = new Map<string, PeriodicNoteTemplateSnapshot>();
	readonly events: string[] = [];
	inspectCalls = 0;
	ensureCalls = 0;
	createCalls = 0;
	deleteCalls = 0;
	templateCalls = 0;
	renderCalls = 0;
	templaterCalls = 0;
	nowCalls = 0;
	templaterAvailable = true;
	createOverride: ((path: string, content: string) => Promise<PeriodicNoteCreateResult>) | null = null;
	renderOverride: ((input: PeriodicNoteDeterministicRenderInput) => Promise<{ ok: true; content: string } | { ok: false; message: string }>) | null = null;
	templaterOverride: ((input: PeriodicNoteTemplaterFinalPathInput) => Promise<PeriodicNoteTemplaterFinalPathResult>) | null = null;

	now(): string {
		this.nowCalls += 1;
		return '2026-08-17T12:34:56+02:00';
	}

	async inspect(path: string): Promise<PeriodicNoteFileState> {
		this.inspectCalls += 1;
		const entry = this.files.get(path);
		if (!entry) return { kind: 'missing' };
		return entry.kind === 'file'
			? { kind: 'file', content: entry.content }
			: { kind: 'other' };
	}

	async ensureParentDirectories(path: string): Promise<void> {
		this.ensureCalls += 1;
		this.events.push(`ensure:${path}`);
	}

	async createFileIfAbsent(path: string, content: string): Promise<PeriodicNoteCreateResult> {
		this.createCalls += 1;
		this.events.push(`create:${path}`);
		if (this.createOverride) return this.createOverride(path, content);
		const current = this.files.get(path);
		if (current?.kind === 'file') return { status: 'exists' };
		if (current) return { status: 'occupied' };
		this.files.set(path, { kind: 'file', content });
		return { status: 'created' };
	}

	async deleteFileIfContentMatches(path: string, expectedContent: string): Promise<PeriodicNoteGuardedDeleteResult> {
		this.deleteCalls += 1;
		const current = this.files.get(path);
		if (!current) return 'missing';
		if (current.kind !== 'file' || current.content !== expectedContent) return 'changed';
		this.files.delete(path);
		return 'deleted';
	}

	async loadTemplate(path: string): Promise<PeriodicNoteTemplateSnapshot | null> {
		this.templateCalls += 1;
		this.events.push(`template:${path}`);
		return this.templates.get(path) ?? null;
	}

	async renderDeterministic(input: PeriodicNoteDeterministicRenderInput): Promise<{ ok: true; content: string } | { ok: false; message: string }> {
		this.renderCalls += 1;
		this.events.push(`render:${input.path}`);
		if (this.renderOverride) return this.renderOverride(input);
		return { ok: true, content: input.content.replace('{{title}}', input.path.split('/').pop()?.replace(/\.md$/u, '') ?? '') };
	}

	templaterFinalPath = async (input: PeriodicNoteTemplaterFinalPathInput): Promise<PeriodicNoteTemplaterFinalPathResult> => {
		this.templaterCalls += 1;
		this.events.push(`templater:${input.path}`);
		if (this.templaterOverride) return this.templaterOverride(input);
		return { ok: true };
	};

	isTemplaterAvailable = (): boolean => this.templaterAvailable;
}

function config(overrides: Partial<PeriodicNoteEffectiveConfig> = {}): PeriodicNoteEffectiveConfig {
	return {
		kind: 'daily',
		source: 'operon',
		enabled: true,
		format: 'YYYY-MM-DD',
		folder: 'Journal',
		template: '',
		...overrides,
	} as PeriodicNoteEffectiveConfig;
}

function fileContent(ports: FakePorts, path: string): string | null {
	const entry = ports.files.get(path);
	return entry?.kind === 'file' ? entry.content : null;
}

async function existingFileShortCircuitsEveryPreparationPort(): Promise<void> {
	const ports = new FakePorts();
	ports.files.set('Journal/2026-08-17.md', { kind: 'file', content: 'human content' });
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ template: 'Templates/Daily.md' }),
	});

	assert.deepEqual(result, {
		ok: true,
		status: 'existing',
		kind: 'daily',
		dateKey: '2026-08-17',
		path: 'Journal/2026-08-17.md',
		source: 'operon',
	});
	assert.equal(ports.templateCalls, 0);
	assert.equal(ports.renderCalls, 0);
	assert.equal(ports.ensureCalls, 0);
	assert.equal(ports.createCalls, 0);
	assert.equal(ports.nowCalls, 1);
	assert.equal(fileContent(ports, 'Journal/2026-08-17.md'), 'human content');
}

async function deterministicLanePreparesInMemoryBeforeWriting(): Promise<void> {
	const ports = new FakePorts();
	ports.templates.set('Templates/Daily.md', { content: '# {{title}}', revision: 'template-r1' });
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ template: 'Templates/Daily.md' }),
	});

	assert.equal(result.ok && result.status, 'created');
	assert.equal(result.ok && result.status === 'created' && result.operationOwnedContent, '# 2026-08-17');
	assert.equal(fileContent(ports, 'Journal/2026-08-17.md'), '# 2026-08-17');
	assert.ok(ports.events.indexOf('render:Journal/2026-08-17.md') < ports.events.indexOf('ensure:Journal/2026-08-17.md'));
	assert.ok(ports.events.indexOf('ensure:Journal/2026-08-17.md') < ports.events.indexOf('create:Journal/2026-08-17.md'));
}

async function createResultOwnsRollbackEvidenceAcrossRegistrationInterleaving(): Promise<void> {
	const ports = new FakePorts();
	ports.templates.set('Templates/Daily.md', { content: '# {{title}}' });
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ template: 'Templates/Daily.md' }),
	});
	assert.equal(result.ok && result.status, 'created');
	if (!result.ok || result.status !== 'created') return;
	const snapshot = createPeriodicNoteCreatedFileSnapshot(result.path, result.operationOwnedContent);
	assert.deepEqual(snapshot, { path: result.path, content: '# 2026-08-17' });
	// Simulates a user edit after the create service returns but before main.ts
	// starts periodic-container registration.
	ports.files.set(result.path, { kind: 'file', content: '# user changed it during registration' });
	const disposition = resolvePeriodicNoteContainerRegistrationDisposition('clean-failure', snapshot);
	assert.equal(disposition.kind, 'guarded-rollback');
	if (disposition.kind !== 'guarded-rollback') return;
	assert.equal(await rollbackPeriodicNoteCreatedFileSnapshot(
		disposition.snapshot,
		(path, expectedContent) => ports.deleteFileIfContentMatches(path, expectedContent),
	), 'changed');
	assert.equal(fileContent(ports, result.path), '# user changed it during registration');
}

async function missingTemplateFailsWithoutAnyWrite(): Promise<void> {
	const ports = new FakePorts();
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ template: 'Templates/Missing.md' }),
	});

	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, 'template-not-found');
	assert.equal(ports.renderCalls, 0);
	assert.equal(ports.ensureCalls, 0);
	assert.equal(ports.createCalls, 0);
}

async function unreadableTemplateFailsWithoutAnyWrite(): Promise<void> {
	const ports = new FakePorts();
	ports.loadTemplate = async () => {
		ports.templateCalls += 1;
		throw new Error('template read denied');
	};
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ template: 'Templates/Unreadable.md' }),
	});

	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, 'template-read-failed');
		assert.equal(result.error.message, 'template read denied');
	}
	assert.equal(ports.templateCalls, 1);
	assert.equal(ports.ensureCalls, 0);
	assert.equal(ports.createCalls, 0);
}

async function nonFileTargetFailsBeforePreparation(): Promise<void> {
	const ports = new FakePorts();
	ports.files.set('Journal/2026-08-17.md', { kind: 'other' });
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ template: 'Templates/Daily.md' }),
	});

	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, 'path-occupied');
	assert.equal(ports.templateCalls, 0);
	assert.equal(ports.renderCalls, 0);
	assert.equal(ports.ensureCalls, 0);
	assert.equal(ports.createCalls, 0);
}

async function inspectFailureStopsBeforePreparation(): Promise<void> {
	const ports = new FakePorts();
	ports.inspect = async () => {
		ports.inspectCalls += 1;
		throw new Error('target inspection failed');
	};
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config(),
	});

	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, 'inspect-failed');
		assert.equal(result.error.message, 'target inspection failed');
	}
	assert.equal(ports.inspectCalls, 1);
	assert.equal(ports.renderCalls, 0);
	assert.equal(ports.ensureCalls, 0);
	assert.equal(ports.createCalls, 0);
}

async function unsafePathFailsBeforeClockOrPorts(): Promise<void> {
	const ports = new FakePorts();
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ folder: '../Outside' }),
	});

	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, 'invalid-target');
	assert.equal(ports.nowCalls, 0);
	assert.equal(ports.inspectCalls, 0);
	assert.equal(ports.ensureCalls, 0);
	assert.equal(ports.createCalls, 0);
}

async function deterministicRenderFailureLeavesNoTarget(): Promise<void> {
	const ports = new FakePorts();
	ports.templates.set('Templates/Daily.md', { content: '# deterministic' });
	ports.renderOverride = async () => ({ ok: false, message: 'render failed' });
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ template: 'Templates/Daily.md' }),
	});

	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, 'deterministic-render-failed');
	assert.equal(ports.ensureCalls, 0);
	assert.equal(ports.createCalls, 0);
}

async function parentFolderFailureLeavesNoTarget(): Promise<void> {
	const ports = new FakePorts();
	ports.ensureParentDirectories = async path => {
		ports.ensureCalls += 1;
		ports.events.push(`ensure:${path}`);
		throw new Error('folder creation denied');
	};
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config(),
	});

	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, 'parent-folder-failed');
		assert.equal(result.error.message, 'folder creation denied');
	}
	assert.equal(ports.ensureCalls, 1);
	assert.equal(ports.createCalls, 0);
	assert.equal(ports.files.has('Journal/2026-08-17.md'), false);
}

async function samePathCallsShareOneCreate(): Promise<void> {
	const ports = new FakePorts();
	let releaseCreate!: () => void;
	const createGate = new Promise<void>(resolve => {
		releaseCreate = resolve;
	});
	ports.createOverride = async (path, content) => {
		await createGate;
		ports.files.set(path, { kind: 'file', content });
		return { status: 'created' };
	};
	const service = new PeriodicNoteService(ports);
	const calls = Array.from({ length: 20 }, () => service.getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config(),
	}));
	releaseCreate();
	const results = await Promise.all(calls);

	assert.equal(ports.createCalls, 1);
	assert.equal(ports.nowCalls, 1);
	assert.ok(results.every(result => result.ok && result.status === 'created'));
}

async function weeklyRequestUsesIsoMondayAndOneClockSample(): Promise<void> {
	const ports = new FakePorts();
	let renderedDateKey = '';
	let renderedNow = '';
	ports.renderOverride = async input => {
		renderedDateKey = input.dateKey;
		renderedNow = input.now;
		return { ok: true, content: '# weekly' };
	};
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'weekly',
		dateKey: '2026-08-20',
		config: config({ kind: 'weekly', format: 'GGGG-[W]WW', folder: 'Weekly' }),
	});

	assert.equal(result.ok && result.dateKey, '2026-08-17');
	assert.equal(result.ok && result.path, 'Weekly/2026-W34.md');
	assert.equal(renderedDateKey, '2026-08-17');
	assert.equal(renderedNow, '2026-08-17T12:34:56+02:00');
	assert.equal(ports.nowCalls, 1);
}

async function externalCreateRaceReturnsExistingWithoutOverwrite(): Promise<void> {
	const ports = new FakePorts();
	ports.createOverride = async path => {
		ports.files.set(path, { kind: 'file', content: 'external content' });
		return { status: 'exists' };
	};
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config(),
	});

	assert.equal(result.ok && result.status, 'existing');
	assert.equal(fileContent(ports, 'Journal/2026-08-17.md'), 'external content');
}

async function createRaceWithNonFileEntryReturnsPathOccupied(): Promise<void> {
	const ports = new FakePorts();
	ports.createOverride = async path => {
		ports.files.set(path, { kind: 'other' });
		return { status: 'occupied' };
	};
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config(),
	});

	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, 'path-occupied');
	assert.deepEqual(ports.files.get('Journal/2026-08-17.md'), { kind: 'other' });
}

async function missingCreateAcknowledgementReturnsCreateFailed(): Promise<void> {
	const ports = new FakePorts();
	ports.createOverride = async () => ({ status: 'exists' });
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config(),
	});

	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, 'create-failed');
		assert.equal(result.error.recoveryRequired, false);
	}
	assert.equal(ports.ensureCalls, 1);
	assert.equal(ports.createCalls, 1);
	assert.equal(ports.files.has('Journal/2026-08-17.md'), false);
}

async function createAcknowledgementLossRequiresRecovery(): Promise<void> {
	const ports = new FakePorts();
	ports.createOverride = async (path, content) => {
		ports.files.set(path, { kind: 'file', content });
		throw new Error('create acknowledgement lost');
	};
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config(),
	});

	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, 'create-failed');
		assert.equal(result.error.recoveryRequired, true);
	}
	assert.equal(fileContent(ports, 'Journal/2026-08-17.md'), '');
}

async function publicPrepareIsZeroWriteAndCommitRevalidatesTemplate(): Promise<void> {
	const ports = new FakePorts();
	ports.templates.set('Templates/Daily.md', { content: '# first', revision: 'r1' });
	const service = new PeriodicNoteService(ports);
	const prepared = await service.prepare({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ template: 'Templates/Daily.md' }),
	});

	assert.equal(prepared.status, 'prepared');
	assert.equal(ports.ensureCalls, 0);
	assert.equal(ports.createCalls, 0);
	if (prepared.status !== 'prepared') return;
	ports.templates.set('Templates/Daily.md', { content: '# changed', revision: 'r2' });
	const committed = await service.commit(prepared.plan);
	assert.equal(committed.ok, false);
	if (!committed.ok) assert.equal(committed.error.code, 'template-read-failed');
	assert.equal(ports.ensureCalls, 0);
	assert.equal(ports.createCalls, 0);
}

async function publicCommitRejectsForgedAndMutatedPlans(): Promise<void> {
	const ports = new FakePorts();
	const service = new PeriodicNoteService(ports);
	const prepared = await service.prepare({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config(),
	});
	assert.equal(prepared.status, 'prepared');
	if (prepared.status !== 'prepared') return;

	const forged = { ...prepared.plan, content: 'forged content' };
	const forgedResult = await service.commit(forged);
	assert.equal(forgedResult.ok, false);
	if (!forgedResult.ok) assert.equal(forgedResult.error.code, 'invalid-target');
	assert.equal(ports.createCalls, 0);

	assert.throws(() => {
		(prepared.plan as { content: string }).content = 'mutated content';
	}, TypeError);
	const committed = await service.commit(prepared.plan);
	assert.equal(committed.ok && committed.status, 'created');
	assert.equal(fileContent(ports, 'Journal/2026-08-17.md'), '');
}

async function literalTemplaterClosingTextStaysDeterministic(): Promise<void> {
	const ports = new FakePorts();
	ports.templates.set('Templates/Daily.md', { content: 'Literal %> text' });
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ template: 'Templates/Daily.md' }),
	});

	assert.equal(result.ok && result.status, 'created');
	assert.equal(ports.templaterCalls, 0);
	assert.equal(fileContent(ports, 'Journal/2026-08-17.md'), 'Literal %> text');
}

async function templaterUsesFinalPathAndSucceeds(): Promise<void> {
	const ports = new FakePorts();
	ports.templates.set('Templates/Daily.md', { content: '# <% tp.file.title %>', revision: 'template-r2' });
	ports.templaterOverride = async input => {
		assert.equal(input.path, 'Journal/2026-08-17.md');
		assert.equal(input.now, '2026-08-17T12:34:56+02:00');
		ports.files.set(input.path, { kind: 'file', content: '# 2026-08-17' });
		return { ok: true, operationOwnedContent: '# 2026-08-17' };
	};
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ template: 'Templates/Daily.md' }),
	});

	assert.equal(result.ok && result.status, 'created');
	assert.equal(result.ok && result.status === 'created' && result.operationOwnedContent, '# 2026-08-17');
	assert.equal(ports.templaterCalls, 1);
	assert.equal(ports.deleteCalls, 0);
}

async function templaterWithoutOwnedFinalContentPreservesFileOnCleanRegistrationFailure(): Promise<void> {
	const ports = new FakePorts();
	ports.templates.set('Templates/Daily.md', { content: '<% tp.file.title %>' });
	ports.templaterOverride = async input => {
		ports.files.set(input.path, { kind: 'file', content: '# final but unproven' });
		return { ok: true };
	};
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ template: 'Templates/Daily.md' }),
	});
	assert.equal(result.ok && result.status, 'created');
	if (!result.ok || result.status !== 'created') return;
	assert.equal(result.operationOwnedContent, undefined);
	const disposition = resolvePeriodicNoteContainerRegistrationDisposition(
		'clean-failure',
		createPeriodicNoteCreatedFileSnapshot(result.path, result.operationOwnedContent),
	);
	assert.deepEqual(disposition, { kind: 'recovery-required' });
	assert.equal(fileContent(ports, result.path), '# final but unproven');
}

async function templaterSuccessWithoutFinalFileFailsExplicitly(): Promise<void> {
	const ports = new FakePorts();
	ports.templates.set('Templates/Daily.md', { content: '<% tp.file.title %>' });
	ports.templaterOverride = async input => {
		ports.files.delete(input.path);
		return { ok: true };
	};
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ template: 'Templates/Daily.md' }),
	});

	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, 'templater-processing-failed');
		assert.equal(result.error.recoveryRequired, false);
	}
	assert.equal(ports.files.has('Journal/2026-08-17.md'), false);
}

async function templaterSuccessWithNonFileTargetRequiresRecovery(): Promise<void> {
	const ports = new FakePorts();
	ports.templates.set('Templates/Daily.md', { content: '<% tp.file.title %>' });
	ports.templaterOverride = async input => {
		ports.files.set(input.path, { kind: 'other' });
		return { ok: true };
	};
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ template: 'Templates/Daily.md' }),
	});

	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, 'templater-processing-failed');
		assert.equal(result.error.recoveryRequired, true);
	}
	assert.deepEqual(ports.files.get('Journal/2026-08-17.md'), { kind: 'other' });
}

async function unavailableTemplaterFailsBeforeFoldersOrCreate(): Promise<void> {
	const ports = new FakePorts();
	ports.templaterAvailable = false;
	ports.templates.set('Templates/Daily.md', { content: '<% tp.file.title %>' });
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ template: 'Templates/Daily.md' }),
	});

	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, 'templater-unavailable');
	assert.equal(ports.ensureCalls, 0);
	assert.equal(ports.createCalls, 0);
	assert.equal(ports.templaterCalls, 0);
}

async function templaterFailureRollsBackUnchangedOwnedTarget(): Promise<void> {
	const ports = new FakePorts();
	ports.templates.set('Templates/Daily.md', { content: '<% throw new Error() %>' });
	ports.templaterOverride = async () => ({ ok: false, message: 'templater failed' });
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ template: 'Templates/Daily.md' }),
	});

	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, 'templater-processing-failed');
		assert.equal(result.error.recoveryRequired, false);
	}
	assert.equal(ports.files.has('Journal/2026-08-17.md'), false);
}

async function templaterFailureCanGuardedlyRollBackItsLastOwnedContent(): Promise<void> {
	const ports = new FakePorts();
	ports.templates.set('Templates/Daily.md', { content: '<% partial() %>' });
	ports.templaterOverride = async input => {
		ports.files.set(input.path, { kind: 'file', content: 'known partial content' });
		return {
			ok: false,
			message: 'templater failed after owned write',
			rollbackExpectedContent: 'known partial content',
		};
	};
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ template: 'Templates/Daily.md' }),
	});

	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, 'templater-processing-failed');
		assert.equal(result.error.recoveryRequired, false);
	}
	assert.equal(ports.files.has('Journal/2026-08-17.md'), false);
}

async function templaterFailurePreservesChangedTargetAndRequiresRecovery(): Promise<void> {
	const ports = new FakePorts();
	ports.templates.set('Templates/Daily.md', { content: '<% partial() %>' });
	ports.templaterOverride = async input => {
		ports.files.set(input.path, { kind: 'file', content: 'partial but changed' });
		return { ok: false, message: 'templater failed after write' };
	};
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ template: 'Templates/Daily.md' }),
	});

	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, 'rollback-failed');
		assert.equal(result.error.recoveryRequired, true);
	}
	assert.equal(fileContent(ports, 'Journal/2026-08-17.md'), 'partial but changed');
}

async function templaterRollbackTransportFailureRequiresRecovery(): Promise<void> {
	const ports = new FakePorts();
	ports.templates.set('Templates/Daily.md', { content: '<% throw new Error() %>' });
	ports.templaterOverride = async () => ({ ok: false, message: 'templater failed' });
	ports.deleteFileIfContentMatches = async () => {
		ports.deleteCalls += 1;
		throw new Error('trash failed');
	};
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ template: 'Templates/Daily.md' }),
	});

	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, 'rollback-failed');
		assert.equal(result.error.message, 'templater failed');
		assert.equal(result.error.recoveryRequired, true);
	}
	assert.equal(ports.templaterCalls, 1);
	assert.equal(ports.deleteCalls, 1);
	assert.equal(fileContent(ports, 'Journal/2026-08-17.md'), '<% throw new Error() %>');
}

async function templaterRollbackFailedResultRequiresRecovery(): Promise<void> {
	const ports = new FakePorts();
	ports.templates.set('Templates/Daily.md', { content: '<% throw new Error() %>' });
	ports.templaterOverride = async () => ({ ok: false, message: 'templater failed' });
	ports.deleteFileIfContentMatches = async () => {
		ports.deleteCalls += 1;
		return 'failed';
	};
	const result = await new PeriodicNoteService(ports).getOrCreate({
		kind: 'daily',
		dateKey: '2026-08-17',
		config: config({ template: 'Templates/Daily.md' }),
	});

	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, 'rollback-failed');
		assert.equal(result.error.message, 'templater failed');
		assert.equal(result.error.recoveryRequired, true);
	}
	assert.equal(ports.templaterCalls, 1);
	assert.equal(ports.deleteCalls, 1);
	assert.equal(fileContent(ports, 'Journal/2026-08-17.md'), '<% throw new Error() %>');
}

async function pipelineMoverRejectsEveryUnsafeDestinationSource(): Promise<void> {
	const previousActiveWindow = Reflect.get(globalThis, 'activeWindow');
	let timerId = 0;
	const timers = new Map<number, () => void>();
	Reflect.set(globalThis, 'activeWindow', {
		setTimeout: (callback: () => void) => {
			timerId += 1;
			timers.set(timerId, callback);
			return timerId;
		},
		clearTimeout: (id: number) => { timers.delete(id); },
	});
	const flush = async (): Promise<void> => {
		const callbacks = [...timers.values()];
		timers.clear();
		for (const callback of callbacks) callback();
		for (let index = 0; index < 10; index += 1) await Promise.resolve();
	};
	const task: IndexedTask = {
		operonId: 'unsafe-destination-task',
		description: 'Unsafe destination',
		checkbox: 'open',
		fieldValues: { status: 'Project.Planned' },
		tags: [],
		primary: { format: 'yaml', filePath: 'Operon/Tasks/Unsafe.md', lineNumber: 0 },
		datetimeModified: '2026-08-19T12:00:00',
		tier: 'warm',
	};
	try {
		for (const source of ['pipeline', 'recurrence', 'fallback'] as const) {
			const file = new (TFile as unknown as { new(path: string): TFile })(task.primary.filePath);
			let createFolderCalls = 0;
			let renameCalls = 0;
			const settings = migrateSettings({ ...DEFAULT_SETTINGS });
			settings.moveConvertedNotesToPipelineLocation = true;
			if (source === 'pipeline') {
				settings.fileTaskPipelineLocations = [{ pipelineId: 'pl_project', folder: '../outside' }];
			}
			if (source === 'fallback') settings.fileTasksFolder = '../outside';
			const app = {
				vault: {
					getAbstractFileByPath: (path: string) => path === file.path ? file : null,
					createFolder: async () => { createFolderCalls += 1; },
					adapter: {},
				},
				fileManager: {
					renameFile: async () => { renameCalls += 1; },
				},
			} as unknown as App;
			const indexer = {
				getTask: () => task,
				hasDuplicateOperonIdConflict: () => false,
			} as unknown as OperonIndexer;
			const mover = new FileTaskPipelineMover(app, indexer, () => settings as OperonSettings, {
				isPeriodicContainer: () => false,
				getRecurrenceFolder: () => source === 'recurrence' ? '../outside' : null,
			});
			const warnings: unknown[][] = [];
			const previousWarn = console.warn;
			console.warn = (...args: unknown[]): void => { warnings.push(args); };
			try {
				mover.scheduleConvertedNote(task.operonId);
				await flush();
			} finally {
				console.warn = previousWarn;
				mover.destroy();
			}
			assert.equal(createFolderCalls, 0, `${source} unsafe destination must not create folders`);
			assert.equal(renameCalls, 0, `${source} unsafe destination must not rename the task`);
			assert.equal(warnings.length, 1, `${source} unsafe destination must be reported`);
		}
	} finally {
		if (previousActiveWindow === undefined) Reflect.deleteProperty(globalThis, 'activeWindow');
		else Reflect.set(globalThis, 'activeWindow', previousActiveWindow);
	}
}

async function pipelineMoverResumeRequiresAValidVersionOneMarker(): Promise<void> {
	assert.deepEqual(parseFileTaskPipelineReconciliationMarkerV1(
		'{"version":1,"requestedAt":"2026-08-19T12:00:00.000Z"}',
	), { version: 1, requestedAt: '2026-08-19T12:00:00.000Z' });
	for (const raw of [
		'{',
		'{"version":2,"requestedAt":"2026-08-19T12:00:00.000Z"}',
		'{"version":1,"requestedAt":"not-a-date"}',
		'{"version":1,"requestedAt":"2026-08-19T12:00:00.000Z","extra":true}',
	]) assert.equal(parseFileTaskPipelineReconciliationMarkerV1(raw), null);

	const previousActiveWindow = Reflect.get(globalThis, 'activeWindow');
	const timers = new Map<number, () => void>();
	let timerId = 0;
	Reflect.set(globalThis, 'activeWindow', {
		setTimeout: (callback: () => void) => {
			timerId += 1;
			timers.set(timerId, callback);
			return timerId;
		},
		clearTimeout: (id: number) => { timers.delete(id); },
	});
	try {
		for (const [label, marker, expectedStarts] of [
			['valid restart', '{"version":1,"requestedAt":"2026-08-19T12:00:00.000Z"}', 1],
			['malformed marker', '{', 0],
			['future marker', '{"version":2,"requestedAt":"2026-08-19T12:00:00.000Z"}', 0],
		] as const) {
			let listCalls = 0;
			let writeCalls = 0;
			let removeCalls = 0;
			const task: IndexedTask = {
				operonId: `resume-${label}`,
				description: label,
				checkbox: 'open',
				fieldValues: { status: 'Project.Planned' },
				tags: [],
				primary: { format: 'yaml', filePath: `Scratch/${label}.md`, lineNumber: 0 },
				datetimeModified: '2026-08-19T12:00:00',
				tier: 'warm',
			};
			const app = {
				vault: {
					configDir: '.obsidian',
					adapter: {
						exists: async () => true,
						read: async () => marker,
						write: async () => { writeCalls += 1; },
						remove: async () => { removeCalls += 1; },
					},
				},
			} as unknown as App;
			const indexer = {
				getAllTasks: () => { listCalls += 1; return [task]; },
			} as unknown as OperonIndexer;
			const settings = migrateSettings({ ...DEFAULT_SETTINGS });
			const mover = new FileTaskPipelineMover(app, indexer, () => settings, {
				isPeriodicContainer: () => false,
			});
			const previousWarn = console.warn;
			console.warn = () => {};
			try {
				await mover.resumePendingReconciliation();
			} finally {
				console.warn = previousWarn;
				mover.destroy();
			}
			assert.equal(listCalls, expectedStarts, `${label} reconciliation start count`);
			assert.equal(writeCalls, 0, `${label} must not write during marker admission`);
			assert.equal(removeCalls, 0, `${label} must not remove during marker admission`);
		}
	} finally {
		if (previousActiveWindow === undefined) Reflect.deleteProperty(globalThis, 'activeWindow');
		else Reflect.set(globalThis, 'activeWindow', previousActiveWindow);
	}
}

async function pipelineMoverSuspendsEveryEntrypointWhenPeriodicIdentityIsUnhealthy(): Promise<void> {
	const previousActiveWindow = Reflect.get(globalThis, 'activeWindow');
	const timers = new Map<number, () => void>();
	let timerId = 0;
	Reflect.set(globalThis, 'activeWindow', {
		setTimeout: (callback: () => void) => {
			timerId += 1;
			timers.set(timerId, callback);
			return timerId;
		},
		clearTimeout: (id: number) => { timers.delete(id); },
	});
	const flush = async (): Promise<void> => {
		const callbacks = [...timers.values()];
		timers.clear();
		for (const callback of callbacks) callback();
		for (let index = 0; index < 10; index += 1) await Promise.resolve();
	};
	const task: IndexedTask = {
		operonId: 'registry-suspended-task',
		description: 'Registry suspended',
		checkbox: 'open',
		fieldValues: { status: 'Project.Planned' },
		tags: [],
		primary: { format: 'yaml', filePath: 'Tasks/Registry suspended.md', lineNumber: 0 },
		datetimeModified: '2026-08-19T12:00:00',
		tier: 'warm',
	};
	let healthy = false;
	let listCalls = 0;
	let removeCalls = 0;
	let unavailableCalls = 0;
	const markerPath = '.obsidian/plugins/operon/state/file-task-pipeline-location-reconcile.json';
	const files = new Map<string, string>([[markerPath, '{"version":1,"requestedAt":"2026-08-19T12:00:00.000Z"}']]);
	try {
		const app = {
			vault: {
				configDir: '.obsidian',
				getAbstractFileByPath: () => null,
				adapter: {
					exists: async (path: string) => files.has(path),
					read: async (path: string) => files.get(path) ?? '',
					write: async (path: string, value: string) => { files.set(path, value); },
					mkdir: async () => {},
					remove: async (path: string) => { removeCalls += 1; files.delete(path); },
				},
			},
			fileManager: { renameFile: async () => {} },
		} as unknown as App;
		const indexer = {
			getAllTasks: () => { listCalls += 1; return [task]; },
			getTask: () => task,
			hasDuplicateOperonIdConflict: () => false,
		} as unknown as OperonIndexer;
		const settings = migrateSettings({ ...DEFAULT_SETTINGS });
		const mover = new FileTaskPipelineMover(app, indexer, () => settings, {
			isPeriodicContainer: () => false,
			canReconcile: () => healthy,
			onReconcileUnavailable: () => { unavailableCalls += 1; },
		});
		try {
			await mover.resumePendingReconciliation();
			assert.equal(listCalls, 0, 'unhealthy registry blocks restart marker reconciliation before index traversal');
			assert.equal(removeCalls, 0, 'unhealthy registry preserves pending marker');
			healthy = true;
			await mover.requestSettingsReconcileAll();
			assert.equal(listCalls, 1, 'healthy registry starts requested bulk reconciliation');
			healthy = false;
			await flush();
			assert.equal(files.has(markerPath), true, 'health loss while queued preserves durable marker for manual recovery');
			assert.equal(removeCalls, 0, 'health loss never clears a pending reconciliation marker');
			assert.ok(unavailableCalls >= 2, 'every blocked entrypoint reports unavailable registry state');
		} finally {
			mover.destroy();
		}
	} finally {
		if (previousActiveWindow === undefined) Reflect.deleteProperty(globalThis, 'activeWindow');
		else Reflect.set(globalThis, 'activeWindow', previousActiveWindow);
	}
}

async function run(): Promise<void> {
	await existingFileShortCircuitsEveryPreparationPort();
	await deterministicLanePreparesInMemoryBeforeWriting();
	await createResultOwnsRollbackEvidenceAcrossRegistrationInterleaving();
	await missingTemplateFailsWithoutAnyWrite();
	await unreadableTemplateFailsWithoutAnyWrite();
	await nonFileTargetFailsBeforePreparation();
	await inspectFailureStopsBeforePreparation();
	await unsafePathFailsBeforeClockOrPorts();
	await deterministicRenderFailureLeavesNoTarget();
	await parentFolderFailureLeavesNoTarget();
	await samePathCallsShareOneCreate();
	await weeklyRequestUsesIsoMondayAndOneClockSample();
	await externalCreateRaceReturnsExistingWithoutOverwrite();
	await createRaceWithNonFileEntryReturnsPathOccupied();
	await missingCreateAcknowledgementReturnsCreateFailed();
	await createAcknowledgementLossRequiresRecovery();
	await publicPrepareIsZeroWriteAndCommitRevalidatesTemplate();
	await publicCommitRejectsForgedAndMutatedPlans();
	await literalTemplaterClosingTextStaysDeterministic();
	await templaterUsesFinalPathAndSucceeds();
	await templaterWithoutOwnedFinalContentPreservesFileOnCleanRegistrationFailure();
	await templaterSuccessWithoutFinalFileFailsExplicitly();
	await templaterSuccessWithNonFileTargetRequiresRecovery();
	await unavailableTemplaterFailsBeforeFoldersOrCreate();
	await templaterFailureRollsBackUnchangedOwnedTarget();
	await templaterFailureCanGuardedlyRollBackItsLastOwnedContent();
	await templaterFailurePreservesChangedTargetAndRequiresRecovery();
	await templaterRollbackTransportFailureRequiresRecovery();
	await templaterRollbackFailedResultRequiresRecovery();
	await pipelineMoverRejectsEveryUnsafeDestinationSource();
	await pipelineMoverResumeRequiresAValidVersionOneMarker();
	await pipelineMoverSuspendsEveryEntrypointWhenPeriodicIdentityIsUnhealthy();
}

globalThis.__operonPeriodicNoteServiceTestRun = run();

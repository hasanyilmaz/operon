import assert from 'node:assert/strict';
import { App, TFile, TFolder } from 'obsidian';
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
	FILE_TASK_PIPELINE_MOVE_DELAY_MS,
	FileTaskPipelineMover,
	parseFileTaskPipelineReconciliationMarkerV1,
} from '../src/systems/file-task-pipeline-mover';
import {
	FILE_TASK_ARCHIVE_DELAY_MS,
	FileTaskArchiver,
	parseFileTaskArchiveReconciliationMarkerV1,
} from '../src/systems/file-task-archiver';
import {
	buildFileTaskArchiveReconciliationSignature,
	buildFileTaskPipelineLocationRuleSnapshot,
	diffFileTaskPipelineLocationRuleSnapshot,
	resolveFileTaskArchiveLocation,
	resolveFileTaskPipelineLocation,
	resolveRecurringFileTaskFolder,
} from '../src/core/file-task-pipeline-location';
import { writeTextSafely } from '../src/storage/storage-file-ops';
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

async function pipelineMoverPreservesManualFileTaskLocations(): Promise<void> {
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
	try {
		const settings = migrateSettings({ ...DEFAULT_SETTINGS });
		const sourcePipeline = settings.pipelines[0];
		assert.ok(sourcePipeline);
		const targetPipeline = {
			...sourcePipeline,
			id: 'pl_manual_location_target',
			name: 'TargetPipeline',
			statuses: sourcePipeline.statuses.map((status, index) => ({
				...status,
				id: `st_manual_location_target_${index}`,
			})),
		};
		settings.pipelines = [sourcePipeline, targetPipeline];
		const sourceStatusLabel = sourcePipeline.statuses[0]?.label;
		const targetStatusLabel = targetPipeline.statuses[0]?.label;
		const sourceStatus = sourceStatusLabel ? `${sourcePipeline.name}.${sourceStatusLabel}` : '';
		const targetStatus = targetStatusLabel ? `${targetPipeline.name}.${targetStatusLabel}` : '';
		assert.ok(sourceStatus && targetStatus);
		settings.fileTaskPipelineLocations = [
			{ pipelineId: sourcePipeline.id, folder: 'Source' },
			{ pipelineId: targetPipeline.id, folder: 'Target' },
		];

		const task = (status: string, filePath: string): IndexedTask => ({
			operonId: 'manual-location-task',
			description: 'Manual location',
			checkbox: 'open',
			fieldValues: { status },
			tags: [],
			primary: { format: 'yaml', filePath, lineNumber: 0 },
			datetimeModified: '2026-08-23T12:00:00',
			tier: 'warm',
		});
		let currentTask = task(sourceStatus, 'Source/Manual location.md');
		let sourceFile = new (TFile as unknown as { new(path: string): TFile })(currentTask.primary.filePath);
		let destinationExists = false;
		const renameTargets: string[] = [];
		const app = {
			vault: {
				getAbstractFileByPath: (path: string) => {
					if (path === sourceFile.path) return sourceFile;
					if (path === 'Source' || path === 'Target') {
						return new (TFolder as unknown as { new(path: string): TFolder })(path);
					}
					if (destinationExists && path === 'Target/Manual location.md') {
						return new (TFile as unknown as { new(path: string): TFile })(path);
					}
					return null;
				},
				createFolder: async () => {},
				adapter: {},
			},
			fileManager: {
				renameFile: async (_file: TFile, path: string) => { renameTargets.push(path); },
			},
		} as unknown as App;
		const indexer = {
			getTask: () => currentTask,
			hasDuplicateOperonIdConflict: () => false,
		} as unknown as OperonIndexer;
		const mover = new FileTaskPipelineMover(app, indexer, () => settings, {
			isPeriodicContainer: () => false,
		});
		try {
			const statusChanged = task(targetStatus, 'Source/Manual location.md');
			currentTask = statusChanged;
			mover.scheduleForIndexedChange(task(sourceStatus, 'Source/Manual location.md'), statusChanged);
			assert.equal(timers.size, 1, 'a real pipeline change schedules relocation');
			mover.preserveManualLocation(statusChanged.operonId);
			assert.equal(timers.size, 0, 'a vault rename immediately cancels stale relocation');
			mover.scheduleForIndexedChange(task(sourceStatus, 'Source/Manual location.md'), statusChanged);
			assert.equal(timers.size, 1, 'routing remains available after a cancelled relocation');

			const manuallyMoved = task(targetStatus, 'Manual/Manual location.md');
			currentTask = manuallyMoved;
			sourceFile = new (TFile as unknown as { new(path: string): TFile })(manuallyMoved.primary.filePath);
			mover.scheduleForIndexedChange(statusChanged, manuallyMoved);
			assert.equal(timers.size, 0, 'a path-only manual move cancels pending relocation');
			await flush();
			assert.deepEqual(renameTargets, []);

			const routedAgain = task(sourceStatus, manuallyMoved.primary.filePath);
			currentTask = routedAgain;
			mover.scheduleForIndexedChange(manuallyMoved, routedAgain);
			await flush();
			assert.deepEqual(renameTargets, ['Source/Manual location.md'], 'a real pipeline change still moves the task');

			renameTargets.length = 0;
			currentTask = task(targetStatus, 'Manual/Manual location.md');
			sourceFile = new (TFile as unknown as { new(path: string): TFile })(currentTask.primary.filePath);
			destinationExists = true;
			const previousWarn = console.warn;
			console.warn = () => {};
			try {
				mover.scheduleForIndexedChange(routedAgain, currentTask);
				await flush();
			} finally {
				console.warn = previousWarn;
			}
			assert.deepEqual(renameTargets, [], 'an occupied exact destination must not create a suffixed duplicate');
		} finally {
			mover.destroy();
		}
	} finally {
		if (previousActiveWindow === undefined) Reflect.deleteProperty(globalThis, 'activeWindow');
		else Reflect.set(globalThis, 'activeWindow', previousActiveWindow);
	}
}

function pipelineLocationRulesRemainScopedAndExplicit(): void {
	const settings = migrateSettings({ ...DEFAULT_SETTINGS });
	const project = settings.pipelines.find(pipeline => pipeline.id === 'pl_project');
	assert.ok(project);
	const projectStatus = `${project.name}.${project.statuses[0]?.label ?? ''}`;
	settings.fileTaskPipelineLocations = [{ pipelineId: project.id, folder: '' }];
	assert.deepEqual(resolveFileTaskPipelineLocation(settings, { status: projectStatus }), {
		pipelineId: project.id,
		folder: '',
		kind: 'pipeline-rule',
	}, 'an explicit empty folder remains a vault-root rule');

	settings.fileTaskPipelineLocations = [];
	assert.deepEqual(resolveFileTaskPipelineLocation(settings, { status: projectStatus }), {
		pipelineId: project.id,
		folder: null,
		kind: 'unconfigured',
	});
	assert.deepEqual(resolveFileTaskPipelineLocation(settings, { status: 'Missing.Status' }), {
		pipelineId: null,
		folder: null,
		kind: 'unresolved-status',
	});
	const ambiguousPipeline = {
		...project,
		id: 'pl_ambiguous_project',
		statuses: project.statuses.map((status, index) => ({ ...status, id: `st_ambiguous_${index}` })),
	};
	settings.pipelines = [project, ambiguousPipeline];
	assert.deepEqual(resolveFileTaskPipelineLocation(settings, { status: projectStatus }), {
		pipelineId: null,
		folder: null,
		kind: 'unresolved-status',
	}, 'ambiguous status identity must not select a pipeline target');
	settings.pipelines = [project];
	settings.fileTaskPipelineLocations = [{ pipelineId: project.id, folder: '../outside' }];
	assert.deepEqual(resolveFileTaskPipelineLocation(settings, { status: projectStatus }), {
		pipelineId: project.id,
		folder: null,
		kind: 'unsafe-rule',
	});

	const prior = buildFileTaskPipelineLocationRuleSnapshot({
		fileTaskPipelineLocations: [
			{ pipelineId: 'pipeline-a', folder: 'Tasks/A' },
			{ pipelineId: 'pipeline-b', folder: 'Tasks/B' },
		],
	});
	const reordered = buildFileTaskPipelineLocationRuleSnapshot({
		fileTaskPipelineLocations: [
			{ pipelineId: 'pipeline-b', folder: 'Tasks/B/' },
			{ pipelineId: 'pipeline-a', folder: 'Tasks/A' },
		],
	});
	assert.deepEqual(diffFileTaskPipelineLocationRuleSnapshot(prior, reordered), [], 'rule reorder is inert');
	assert.deepEqual(diffFileTaskPipelineLocationRuleSnapshot(prior, [
		{ pipelineId: 'pipeline-b', folder: 'Tasks/B' },
	]), [], 'rule removal does not reconcile existing files');
	assert.deepEqual(diffFileTaskPipelineLocationRuleSnapshot(prior, [
		{ pipelineId: 'pipeline-a', folder: 'Tasks/A2' },
		{ pipelineId: 'pipeline-b', folder: 'Tasks/B' },
	]), ['pipeline-a'], 'only a changed target is reconciled');
	assert.deepEqual(diffFileTaskPipelineLocationRuleSnapshot([], [
		{ pipelineId: 'pipeline-a', folder: '' },
	]), ['pipeline-a'], 'a newly added root rule is reconciled');

	settings.fileTaskPipelineLocations = [];
	settings.fileTasksFolder = 'Tasks/New';
	settings.fileRepeatDestination = 'custom-folder';
	settings.fileRepeatCustomFolder = 'Tasks/Recurring';
	assert.equal(
		resolveRecurringFileTaskFolder(settings, { status: projectStatus }, 'Tasks/Existing'),
		'Tasks/Recurring',
		'recurrence destination remains available for newly created occurrences',
	);
}

async function pipelineMoverScopesSettingsAndConvertedFallback(): Promise<void> {
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
		for (let index = 0; index < 20; index += 1) await Promise.resolve();
	};
	try {
		const settings = migrateSettings({ ...DEFAULT_SETTINGS });
		const pipelineA = settings.pipelines[0];
		assert.ok(pipelineA);
		const pipelineB = {
			...pipelineA,
			id: 'pl_scoped_b',
			name: 'ScopedB',
			statuses: pipelineA.statuses.map((status, index) => ({ ...status, id: `st_scoped_b_${index}` })),
		};
		settings.pipelines = [pipelineA, pipelineB];
		settings.fileTaskPipelineLocations = [
			{ pipelineId: pipelineA.id, folder: 'Routed/A' },
			{ pipelineId: pipelineB.id, folder: 'Routed/B' },
		];
		settings.fileTasksFolder = 'Converted';
		settings.moveConvertedNotesToPipelineLocation = true;
		const statusFor = (pipeline: typeof pipelineA): string => `${pipeline.name}.${pipeline.statuses[0]?.label ?? ''}`;
		const task = (operonId: string, status: string, filePath: string): IndexedTask => ({
			operonId,
			description: operonId,
			checkbox: 'open',
			fieldValues: { status },
			tags: [],
			primary: { format: 'yaml', filePath, lineNumber: 0 },
			datetimeModified: '2026-09-03T12:00:00',
			tier: 'warm',
		});
		const tasks = new Map<string, IndexedTask>([
			['scope-a', task('scope-a', statusFor(pipelineA), 'Manual/A.md')],
			['scope-b', task('scope-b', statusFor(pipelineB), 'Manual/B.md')],
			['converted', task('converted', 'Unknown.Status', 'Notes/Converted.md')],
		]);
		const renameTargets: string[] = [];
		const markerFiles = new Map<string, string>();
		const app = {
			vault: {
				configDir: '.obsidian',
				getAbstractFileByPath: (path: string) => {
					const indexed = [...tasks.values()].find(candidate => candidate.primary.filePath === path);
					if (indexed) return new (TFile as unknown as { new(path: string): TFile })(path);
					if (['Routed', 'Routed/A', 'Routed/B', 'Converted'].includes(path)) {
						return new (TFolder as unknown as { new(path: string): TFolder })(path);
					}
					return null;
				},
				createFolder: async () => {},
				adapter: {
					exists: async (path: string) => markerFiles.has(path),
					mkdir: async () => {},
					write: async (path: string, value: string) => { markerFiles.set(path, value); },
					remove: async (path: string) => { markerFiles.delete(path); },
				},
			},
			fileManager: {
				renameFile: async (_file: TFile, path: string) => { renameTargets.push(path); },
			},
		} as unknown as App;
		const indexer = {
			getAllTasks: () => [...tasks.values()].filter(candidate => candidate.operonId !== 'converted'),
			getTask: (operonId: string) => tasks.get(operonId) ?? null,
			hasDuplicateOperonIdConflict: () => false,
		} as unknown as OperonIndexer;
		const mover = new FileTaskPipelineMover(app, indexer, () => settings, {
			isPeriodicContainer: () => false,
		});
		try {
			await mover.requestSettingsReconcilePipelineIds([pipelineA.id]);
			await flush();
			assert.deepEqual(renameTargets, ['Routed/A/A.md'], 'A scope must not move pipeline B');

			renameTargets.length = 0;
			mover.scheduleConvertedNote('converted');
			await flush();
			assert.deepEqual(renameTargets, ['Converted/Converted.md'], 'converted notes retain default fallback');

			renameTargets.length = 0;
			settings.fileTaskPipelineLocations = [{ pipelineId: pipelineA.id, folder: '' }];
			const before = task('scope-a', statusFor(pipelineB), 'Manual/A.md');
			const after = task('scope-a', statusFor(pipelineA), 'Manual/A.md');
			tasks.set('scope-a', after);
			mover.scheduleForIndexedChange(before, after);
			await flush();
			assert.deepEqual(renameTargets, ['A.md'], 'an explicit root rule moves to vault root');

			renameTargets.length = 0;
			settings.fileTaskPipelineLocations = [{ pipelineId: pipelineA.id, folder: '../outside' }];
			const unsafe = task('scope-a', statusFor(pipelineA), 'Manual/A.md');
			tasks.set('scope-a', unsafe);
			mover.scheduleForIndexedChange(before, unsafe);
			await flush();
			assert.deepEqual(renameTargets, [], 'unsafe rules never move existing files');
		} finally {
			mover.destroy();
		}
	} finally {
		if (previousActiveWindow === undefined) Reflect.deleteProperty(globalThis, 'activeWindow');
		else Reflect.set(globalThis, 'activeWindow', previousActiveWindow);
	}
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
		for (const source of ['pipeline', 'fallback'] as const) {
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
		settings.fileTaskPipelineLocations = [{ pipelineId: 'pl_project', folder: 'Tasks/Project' }];
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

async function fileTaskArchiverUsesPipelineTargetsAndDurableBulkReconciliation(): Promise<void> {
	assert.equal(FILE_TASK_PIPELINE_MOVE_DELAY_MS, 5_000);
	assert.equal(FILE_TASK_ARCHIVE_DELAY_MS, 5_000);
	const configuredSettings = migrateSettings({
		...DEFAULT_SETTINGS,
		fileTaskArchiveFolder: 'Archive/Fallback',
		fileTaskArchivePipelineLocations: [{ pipelineId: 'pl_project', folder: 'Archive/Project' }],
	});
	const archiveSignature = buildFileTaskArchiveReconciliationSignature(configuredSettings);
	const presentationOnly = {
		...configuredSettings,
		pipelines: configuredSettings.pipelines.map(pipeline => ({
			...pipeline,
			statuses: pipeline.statuses.map(status => ({ ...status, color: '#ffffff' })),
		})),
	};
	assert.equal(
		buildFileTaskArchiveReconciliationSignature(presentationOnly),
		archiveSignature,
		'presentation-only pipeline edits must not schedule archive reconciliation',
	);
	const reroutedPipeline = {
		...configuredSettings,
		pipelines: configuredSettings.pipelines.map(pipeline => ({
			...pipeline,
			name: pipeline.id === 'pl_project' ? 'Renamed Project' : pipeline.name,
			statuses: pipeline.statuses.map(status => ({ ...status })),
		})),
	};
	assert.notEqual(
		buildFileTaskArchiveReconciliationSignature(reroutedPipeline),
		archiveSignature,
		'pipeline/status resolution changes must request archive reconciliation for existing terminal tasks',
	);
	const terminalSemanticsChanged = {
		...configuredSettings,
		pipelines: configuredSettings.pipelines.map(pipeline => ({
			...pipeline,
			statuses: pipeline.statuses.map(status => (
				status.label === 'Finished' ? { ...status, isFinished: false } : { ...status }
			)),
		})),
	};
	assert.notEqual(
		buildFileTaskArchiveReconciliationSignature(terminalSemanticsChanged),
		archiveSignature,
		'terminal status semantics must request archive reconciliation for existing tasks',
	);
	assert.deepEqual(resolveFileTaskArchiveLocation(configuredSettings, { status: 'Project.Finished' }), {
		pipelineId: 'pl_project', folder: 'Archive/Project', kind: 'pipeline-rule',
	});
	assert.deepEqual(resolveFileTaskArchiveLocation(configuredSettings, { status: 'Unknown.Finished' }), {
		pipelineId: null, folder: 'Archive/Fallback', kind: 'general-fallback',
	});
	assert.deepEqual(resolveFileTaskArchiveLocation(migrateSettings({ ...DEFAULT_SETTINGS }), { status: 'Project.Finished' }), {
		pipelineId: 'pl_project', folder: null, kind: 'unconfigured',
	});
	configuredSettings.fileTaskArchivePipelineLocations = [{ pipelineId: 'pl_project', folder: '../unsafe' }];
	assert.deepEqual(resolveFileTaskArchiveLocation(configuredSettings, { status: 'Project.Finished' }), {
		pipelineId: 'pl_project', folder: null, kind: 'unsafe-rule',
	});
	configuredSettings.fileTaskArchivePipelineLocations = [{ pipelineId: 'pl_project', folder: 'Archive/Project' }];

	const previousActiveWindow = Reflect.get(globalThis, 'activeWindow');
	const timers = new Map<number, () => void>();
	let timerId = 0;
	Reflect.set(globalThis, 'activeWindow', {
		setTimeout: (callback: () => void, delayMs: number) => {
			assert.equal(delayMs, FILE_TASK_ARCHIVE_DELAY_MS, 'archiver must always use the fixed 5-second delay');
			timerId += 1;
			timers.set(timerId, callback);
			return timerId;
		},
		clearTimeout: (id: number) => { timers.delete(id); },
	});
	const flush = async (): Promise<void> => {
		while (timers.size > 0) {
			const callbacks = [...timers.values()];
			timers.clear();
			for (const callback of callbacks) callback();
			for (let index = 0; index < 20; index += 1) await Promise.resolve();
		}
	};
	const markerFolder = '.obsidian/plugins/operon/state';
	const markerPath = `${markerFolder}/file-task-archive-reconcile.json`;
	const entries = new Map<string, TFile | TFolder>();
	const markerFiles = new Map<string, string>();
	const storageFolders = new Set<string>();
	const movedPaths: string[] = [];
	const tasks: IndexedTask[] = [];
	let markerWriteMode: 'normal' | 'throw-before' | 'resolve-without-write' | 'partial' = 'normal';
	let markerRemoveMode: 'normal' | 'resolve-without-remove' = 'normal';
	let markerReadMode: 'normal' | 'corrupt-final-replacement' = 'normal';
	const makeTask = (operonId: string, path: string, fieldValues: Record<string, string> = { status: 'Project.Finished' }): IndexedTask => ({
		operonId,
		description: operonId,
		checkbox: 'done',
		fieldValues,
		tags: [],
		primary: { format: 'yaml', filePath: path, lineNumber: 0 },
		datetimeModified: '2026-08-19T12:00:00.000Z',
		tier: 'warm',
	});
	const addFile = (path: string): TFile => {
		const file = new (TFile as unknown as { new(path: string): TFile })(path);
		entries.set(path, file);
		return file;
	};
	const renameFile = async (file: TFile, targetPath: string): Promise<void> => {
		movedPaths.push(targetPath);
		const indexedTask = tasks.find(task => task.primary.filePath === file.path);
		if (indexedTask) indexedTask.primary.filePath = targetPath;
		entries.delete(file.path);
		file.path = targetPath;
		file.name = targetPath.split('/').pop() ?? targetPath;
		file.basename = file.name.replace(/\.[^.]+$/u, '');
		file.extension = 'md';
		entries.set(targetPath, file);
	};
	const app = {
		vault: {
			configDir: '.obsidian',
			getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
			createFolder: async (path: string) => { entries.set(path, new (TFolder as unknown as { new(path: string): TFolder })(path)); },
			adapter: {
				exists: async (path: string) => entries.has(path) || markerFiles.has(path) || storageFolders.has(path),
				read: async (path: string) => {
					if (markerReadMode === 'corrupt-final-replacement' && path === markerPath) return '{';
					return markerFiles.get(path) ?? '';
				},
				write: async (path: string, value: string) => {
					if (path.includes('file-task-archive-reconcile.json')) {
						if (markerWriteMode === 'throw-before') throw new Error('INJECTED_MARKER_WRITE_FAILURE');
						if (markerWriteMode === 'resolve-without-write') return;
						if (markerWriteMode === 'partial') {
							markerFiles.set(path, '{');
							return;
						}
					}
					markerFiles.set(path, value);
				},
				mkdir: async (path: string) => { storageFolders.add(path); },
				remove: async (path: string) => {
					if (path === markerPath && markerRemoveMode === 'resolve-without-remove') return;
					markerFiles.delete(path);
				},
				rename: async (from: string, to: string) => {
					const value = markerFiles.get(from);
					if (value === undefined) throw new Error('MISSING_MARKER_RENAME_SOURCE');
					markerFiles.set(to, value);
					markerFiles.delete(from);
				},
			},
		},
		fileManager: { renameFile },
	} as unknown as App;
	const activeTaskIds = new Set<string>();
	const duplicateTaskIds = new Set<string>();
	const indexer = {
		getAllTasks: () => [...tasks],
		getTask: (operonId: string) => tasks.find(task => task.operonId === operonId) ?? null,
		hasDuplicateOperonIdConflict: (operonId: string) => duplicateTaskIds.has(operonId),
	} as unknown as OperonIndexer;
	const archiver = new FileTaskArchiver(app, indexer, () => configuredSettings, {
		isTaskActive: operonId => activeTaskIds.has(operonId),
	});
	const previousWarn = console.warn;
	console.warn = () => {};
	try {
		const pipelineTask = makeTask('pipeline', 'Operon/Tasks/Finished.md');
		const fallbackTask = makeTask('fallback', 'Operon/Tasks/Unknown.md', { status: 'Unknown.Finished' });
		const alreadyArchived = makeTask('already-archived', 'Archive/Project/In place.md');
		const nestedAlreadyArchived = makeTask('nested-already-archived', 'archive/project/Subtask/In place.md');
		const completedByDate = makeTask('completed-date', 'Operon/Tasks/Completed by date.md', {
			status: 'Project.Finished', dateCompleted: '2026-08-19',
		});
		completedByDate.checkbox = 'open';
		const activeTask = makeTask('active', 'Operon/Tasks/Active.md');
		const duplicateTask = makeTask('duplicate', 'Operon/Tasks/Duplicate.md');
		tasks.push(pipelineTask, fallbackTask, alreadyArchived, nestedAlreadyArchived, completedByDate);
		addFile(pipelineTask.primary.filePath);
		addFile(fallbackTask.primary.filePath);
		addFile(alreadyArchived.primary.filePath);
		addFile(nestedAlreadyArchived.primary.filePath);
		addFile(completedByDate.primary.filePath);
		addFile(activeTask.primary.filePath);
		addFile(duplicateTask.primary.filePath);
		addFile('Archive/Project/Finished.md');
		activeTaskIds.add(activeTask.operonId);
		duplicateTaskIds.add(duplicateTask.operonId);

		await archiver.requestSettingsReconcileAll();
		assert.ok(markerFiles.has(markerPath), 'bulk reconciliation must persist its restart marker before scheduling moves');
		assert.deepEqual(parseFileTaskArchiveReconciliationMarkerV1(markerFiles.get(markerPath) ?? ''), {
			version: 1,
			requestedAt: JSON.parse(markerFiles.get(markerPath) ?? '{}').requestedAt,
		});
		await flush();
		assert.deepEqual([...movedPaths].sort(), [
			'Archive/Project/Finished (1).md',
			'Archive/Fallback/Unknown.md',
			'Archive/Project/Completed by date.md',
		].sort(), 'pipeline rules win over fallback, collisions are unique, and terminal date fields are eligible');
		assert.equal(markerFiles.has(markerPath), false, 'a fully reconciled generation removes its marker');
		assert.ok(entries.has('Archive/Project/In place.md'), 'tasks already at their target stay in place');
		assert.ok(entries.has('archive/project/Subtask/In place.md'), 'nested target paths stay in place case-insensitively');
		assert.ok(entries.has('Operon/Tasks/Active.md'), 'active timers block archive moves');
		archiver.scheduleForIndexedChange(null, activeTask);
		await flush();
		assert.ok(entries.has('Operon/Tasks/Active.md'), 'active timers block archive moves');
		tasks.splice(0, tasks.length, duplicateTask);
		archiver.scheduleForIndexedChange(null, duplicateTask);
		await flush();
		assert.ok(entries.has('Operon/Tasks/Duplicate.md'), 'duplicate IDs block archive moves');

		const failingTask = makeTask('failing', 'Operon/Tasks/Retry.md');
		tasks.splice(0, tasks.length, failingTask);
		addFile(failingTask.primary.filePath);
		const originalRename = app.fileManager.renameFile;
		app.fileManager.renameFile = async () => { throw new Error('simulated move failure'); };
		await archiver.requestSettingsReconcileAll();
		await flush();
		assert.ok(markerFiles.has(markerPath), 'failed moves retain recovery evidence for restart');
		archiver.destroy();
		app.fileManager.renameFile = originalRename;
		const resumed = new FileTaskArchiver(app, indexer, () => configuredSettings);
		try {
			await resumed.resumePendingReconciliation();
			await flush();
			assert.equal(markerFiles.has(markerPath), false, 'restart resumes a valid marker and removes it only after success');
			assert.ok(entries.has('Archive/Project/Retry.md'));
		} finally {
			resumed.destroy();
		}

		const latestTask = makeTask('latest-generation', 'Operon/Tasks/Latest generation.md');
		tasks.splice(0, tasks.length, latestTask);
		addFile(latestTask.primary.filePath);
		const latest = new FileTaskArchiver(app, indexer, () => configuredSettings);
		try {
			await latest.requestSettingsReconcileAll();
			const staleCallback = [...timers.values()][0];
			assert.ok(staleCallback, 'the first reconciliation generation must schedule work');
			timers.clear();
			staleCallback();
			await latest.requestSettingsReconcileAll();
			await flush();
			assert.equal(
				movedPaths.filter(path => path === 'Archive/Project/Latest generation.md').length,
				1,
				'a newer settings generation suppresses queued stale work instead of moving twice',
			);
			assert.equal(markerFiles.has(markerPath), false, 'only the newest completed generation may clear its marker');
		} finally {
			latest.destroy();
		}

		for (const markerFailure of ['throw-before', 'resolve-without-write', 'partial'] as const) {
			const markerFailureTask = makeTask(`marker-${markerFailure}`, `Operon/Tasks/Marker ${markerFailure}.md`);
			tasks.splice(0, tasks.length, markerFailureTask);
			addFile(markerFailureTask.primary.filePath);
			markerFiles.clear();
			markerWriteMode = markerFailure;
			const moveCount = movedPaths.length;
			const markerFailureArchiver = new FileTaskArchiver(app, indexer, () => configuredSettings);
			try {
				await markerFailureArchiver.requestSettingsReconcileAll();
				assert.equal(timers.size, 0, `${markerFailure} marker write must not schedule a move`);
				assert.equal(movedPaths.length, moveCount, `${markerFailure} marker write must not move a task`);
				if (markerFailure === 'partial') {
					assert.equal(markerFiles.has(markerPath), false, 'partial marker temp data is never promoted as recovery evidence');
					await markerFailureArchiver.resumePendingReconciliation();
					assert.equal(timers.size, 0, 'partial marker write never claims restart-safe reconciliation');
				}
			} finally {
				markerFailureArchiver.destroy();
				markerWriteMode = 'normal';
			}
		}

		const priorMarker = JSON.stringify({ version: 1, requestedAt: '2026-08-19T12:00:00.000Z' });
		const priorMarkerTask = makeTask('prior-marker', 'Operon/Tasks/Prior marker.md');
		tasks.splice(0, tasks.length, priorMarkerTask);
		addFile(priorMarkerTask.primary.filePath);
		markerFiles.clear();
		markerFiles.set(markerPath, priorMarker);
		markerReadMode = 'corrupt-final-replacement';
		const priorMarkerMoveCount = movedPaths.length;
		const replacementFailureArchiver = new FileTaskArchiver(app, indexer, () => configuredSettings);
		try {
			await replacementFailureArchiver.requestSettingsReconcileAll();
			assert.equal(timers.size, 0, 'a corrupt replacement must not schedule moves');
			assert.equal(movedPaths.length, priorMarkerMoveCount, 'a corrupt replacement must not move a task');
		} finally {
			replacementFailureArchiver.destroy();
			markerReadMode = 'normal';
		}
		assert.equal(markerFiles.get(markerPath), priorMarker, 'a corrupt replacement restores the prior valid marker exactly');
		const restoredMarkerArchiver = new FileTaskArchiver(app, indexer, () => configuredSettings);
		try {
			await restoredMarkerArchiver.resumePendingReconciliation();
			assert.equal(timers.size, 1, 'the restored valid marker remains safely resumable after restart');
		} finally {
			restoredMarkerArchiver.destroy();
		}

		const clearFailureTask = makeTask('marker-clear-failure', 'Operon/Tasks/Marker clear failure.md');
		tasks.splice(0, tasks.length, clearFailureTask);
		addFile(clearFailureTask.primary.filePath);
		markerFiles.clear();
		markerRemoveMode = 'resolve-without-remove';
		const clearFailureArchiver = new FileTaskArchiver(app, indexer, () => configuredSettings);
		try {
			await clearFailureArchiver.requestSettingsReconcileAll();
			await flush();
			assert.ok(markerFiles.has(markerPath), 'unobserved marker removal retains recovery evidence after completed moves');
			assert.ok(entries.has('Archive/Project/Marker clear failure.md'));
		} finally {
			clearFailureArchiver.destroy();
			markerRemoveMode = 'normal';
		}
		const clearFailureResumed = new FileTaskArchiver(app, indexer, () => configuredSettings);
		try {
			await clearFailureResumed.resumePendingReconciliation();
			await flush();
			assert.equal(markerFiles.has(markerPath), false, 'restart clears only a successfully observed reconciliation marker removal');
			assert.equal(
				movedPaths.filter(path => path === 'Archive/Project/Marker clear failure.md').length,
				1,
				'recovered marker reconciliation is idempotent for an already archived file',
			);
		} finally {
			clearFailureResumed.destroy();
		}

		markerFiles.set(markerPath, '{');
		const corrupted = new FileTaskArchiver(app, indexer, () => configuredSettings);
		try {
			await corrupted.resumePendingReconciliation();
			assert.equal(timers.size, 0, 'invalid recovery evidence must not schedule a best-effort move');
			assert.equal(markerFiles.get(markerPath), '{', 'invalid recovery evidence is retained for diagnosis');
		} finally {
			corrupted.destroy();
		}
	} finally {
		console.warn = previousWarn;
		archiver.destroy();
		if (previousActiveWindow === undefined) Reflect.deleteProperty(globalThis, 'activeWindow');
		else Reflect.set(globalThis, 'activeWindow', previousActiveWindow);
	}
}

async function writeTextSafelyRecoversAcknowledgementLossWithoutDiscardingVerifiedData(): Promise<void> {
	type Mode = 'verified-exact' | 'verified-read-failure' | 'unverified-exact' | 'missing-target' | 'verified-corrupt' | 'restore-failure' | 'backup-remove-failure';
	const priorBytes = 'old-marker\nlegacy-byte=✓';
	const replacementBytes = 'new-marker\ncurrent-byte=✓';
	const createAdapter = (mode: Mode) => {
		const targetPath = 'state/marker.json';
		const files = new Map<string, string>([[targetPath, priorBytes]]);
		const adapter = {
			exists: async (path: string) => files.has(path),
			read: async (path: string) => {
				if (mode === 'verified-read-failure' && path === targetPath) {
					throw new Error('TARGET_READ_UNAVAILABLE');
				}
				const value = files.get(path);
				if (value === undefined) throw new Error(`Missing storage path: ${path}`);
				return value;
			},
			write: async (path: string, value: string) => { files.set(path, value); },
			remove: async (path: string) => {
				if (mode === 'backup-remove-failure' && path.startsWith(`${targetPath}.replace-backup.tmp-`)) {
					throw new Error('BACKUP_REMOVE_FAILED');
				}
				files.delete(path);
			},
			rename: async (from: string, to: string) => {
				const value = files.get(from);
				if (value === undefined) throw new Error(`Missing rename source: ${from}`);
				const isReplacement = from.startsWith(`${targetPath}.tmp-`) && to === targetPath;
				const isBackupRestore = from.startsWith(`${targetPath}.replace-backup.tmp-`) && to === targetPath;
				if (mode === 'restore-failure' && isBackupRestore) {
					throw new Error('RESTORE_FAILED');
				}
				if (mode === 'missing-target' && isReplacement) {
					files.delete(from);
					throw new Error('RENAME_ACK_LOST');
				}
				files.set(to, (mode === 'verified-corrupt' || mode === 'restore-failure') && isReplacement ? '{' : value);
				files.delete(from);
				if (isReplacement && (
					mode === 'verified-exact'
					|| mode === 'verified-read-failure'
					|| mode === 'unverified-exact'
					|| mode === 'backup-remove-failure'
				)) {
					throw new Error('RENAME_ACK_LOST');
				}
			},
		};
		return { adapter, files, targetPath };
	};
	const backupEntries = (files: Map<string, string>, targetPath: string): [string, string][] => (
		[...files.entries()].filter(([path]) => path.startsWith(`${targetPath}.replace-backup.tmp-`))
	);

	const verifiedExact = createAdapter('verified-exact');
	await writeTextSafely(verifiedExact.adapter, verifiedExact.targetPath, replacementBytes, {
		forceAtomicReplacement: true,
		verifyAtomicReplacement: true,
	});
	assert.equal(verifiedExact.files.get(verifiedExact.targetPath), replacementBytes);
	assert.deepEqual(backupEntries(verifiedExact.files, verifiedExact.targetPath), []);

	const verifiedReadFailure = createAdapter('verified-read-failure');
	await assert.rejects(
		writeTextSafely(verifiedReadFailure.adapter, verifiedReadFailure.targetPath, replacementBytes, {
			forceAtomicReplacement: true,
			verifyAtomicReplacement: true,
		}),
		/RENAME_ACK_LOST/u,
	);
	assert.equal(verifiedReadFailure.files.get(verifiedReadFailure.targetPath), replacementBytes, 'an unavailable verification read must retain the exact new target');
	assert.deepEqual(backupEntries(verifiedReadFailure.files, verifiedReadFailure.targetPath).map(([, bytes]) => bytes), [priorBytes], 'an unavailable verification read must retain exact prior backup evidence');

	const unverifiedExact = createAdapter('unverified-exact');
	await assert.rejects(
		writeTextSafely(unverifiedExact.adapter, unverifiedExact.targetPath, replacementBytes, {
			forceAtomicReplacement: true,
		}),
		/RENAME_ACK_LOST/u,
	);
	assert.equal(unverifiedExact.files.get(unverifiedExact.targetPath), replacementBytes, 'an unverified acknowledgement loss must retain the exact new target');
	assert.deepEqual(backupEntries(unverifiedExact.files, unverifiedExact.targetPath).map(([, bytes]) => bytes), [priorBytes], 'an unverified acknowledgement loss must retain exact prior backup evidence');

	const missingTarget = createAdapter('missing-target');
	await assert.rejects(
		writeTextSafely(missingTarget.adapter, missingTarget.targetPath, replacementBytes, {
			forceAtomicReplacement: true,
			verifyAtomicReplacement: true,
		}),
		/RENAME_ACK_LOST/u,
	);
	assert.equal(missingTarget.files.get(missingTarget.targetPath), priorBytes, 'a missing replacement target must restore exact prior bytes');
	assert.deepEqual(backupEntries(missingTarget.files, missingTarget.targetPath), []);

	const verifiedCorrupt = createAdapter('verified-corrupt');
	await assert.rejects(
		writeTextSafely(verifiedCorrupt.adapter, verifiedCorrupt.targetPath, replacementBytes, {
			forceAtomicReplacement: true,
			verifyAtomicReplacement: true,
		}),
		/Atomic replacement target write was not observed exactly/u,
	);
	assert.equal(verifiedCorrupt.files.get(verifiedCorrupt.targetPath), priorBytes, 'a corrupted replacement target must restore exact prior bytes');
	assert.deepEqual(backupEntries(verifiedCorrupt.files, verifiedCorrupt.targetPath), []);

	const backupRemoveFailure = createAdapter('backup-remove-failure');
	await writeTextSafely(backupRemoveFailure.adapter, backupRemoveFailure.targetPath, replacementBytes, {
		forceAtomicReplacement: true,
		verifyAtomicReplacement: true,
	});
	assert.equal(backupRemoveFailure.files.get(backupRemoveFailure.targetPath), replacementBytes, 'a verified replacement remains successful when only cleanup fails');
	assert.deepEqual(backupEntries(backupRemoveFailure.files, backupRemoveFailure.targetPath).map(([, bytes]) => bytes), [priorBytes], 'a cleanup orphan must retain exact prior bytes');

	const restoreFailure = createAdapter('restore-failure');
	await assert.rejects(
		writeTextSafely(restoreFailure.adapter, restoreFailure.targetPath, replacementBytes, {
			forceAtomicReplacement: true,
			verifyAtomicReplacement: true,
		}),
		/Atomic replacement target write was not observed exactly/u,
	);
	assert.ok(
		restoreFailure.files.get(restoreFailure.targetPath) === priorBytes
			|| backupEntries(restoreFailure.files, restoreFailure.targetPath).some(([, bytes]) => bytes === priorBytes),
		'a failed restoration must retain exact prior bytes at the target or its backup',
	);
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
	pipelineLocationRulesRemainScopedAndExplicit();
	await pipelineMoverPreservesManualFileTaskLocations();
	await pipelineMoverScopesSettingsAndConvertedFallback();
	await pipelineMoverRejectsEveryUnsafeDestinationSource();
	await pipelineMoverResumeRequiresAValidVersionOneMarker();
	await pipelineMoverSuspendsEveryEntrypointWhenPeriodicIdentityIsUnhealthy();
	await fileTaskArchiverUsesPipelineTargetsAndDurableBulkReconciliation();
	await writeTextSafelyRecoversAcknowledgementLossWithoutDiscardingVerifiedData();
}

globalThis.__operonPeriodicNoteServiceTestRun = run();

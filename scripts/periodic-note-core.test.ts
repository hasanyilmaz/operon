import assert from 'node:assert/strict';
import {
	DEFAULT_DAILY_NOTE_FORMAT,
	dailyNotePathsMatch,
	formatDailyNoteTitleFromDateKey,
	isDailyNoteDateKey,
	resolveDailyNoteDateKeyFromPath,
	resolveDailyNotePathFromDateKey,
} from '../src/core/daily-note-path';
import {
	resolveEffectivePeriodicNoteConfig,
	resolveHistoricalPeriodicNoteConfig,
} from '../src/core/periodic-note-config';
import { resolvePeriodicNoteContainerTask } from '../src/core/periodic-note-container';
import {
	parsePeriodicNoteContainerRegistryV1,
	PeriodicNoteContainerRegistry,
} from '../src/storage/periodic-note-container-registry';
import { WriteQueue } from '../src/storage/write-queue';
import { backfillPeriodicNoteContainersBeforePipelineResume } from '../src/core/periodic-note-container-backfill';
import {
	createPeriodicNoteCreatedFileSnapshot,
	resolvePeriodicNoteContainerRegistrationDisposition,
	rollbackPeriodicNoteCreatedFileSnapshot,
} from '../src/core/periodic-note-container-registration';
import type { IndexedTask } from '../src/types/fields';
import {
	classifyPeriodicFileTask,
	resolvePeriodicParentRealignment,
} from '../src/core/periodic-note-parent-realignment';
import {
	buildOperonPeriodicNoteConfig,
	isPeriodicNoteKindAvailable,
	resolvePeriodicNoteConfigFromSettings,
	type PeriodicNoteSettingsSource,
} from '../src/core/periodic-note-settings';
import {
	DEFAULT_WEEKLY_NOTE_FORMAT,
	formatPeriodicNoteTitleFromDateKey,
	isSafeVaultRelativePath,
	isValidPeriodicNoteFormat,
	normalizePeriodicNoteFolder,
	resolvePeriodicNoteAnchorDateKey,
	resolvePeriodicNoteDateKeyFromPath,
	resolvePeriodicNotePathFromDateKey,
} from '../src/core/periodic-note-path';

let assertions = 0;

function equal(actual: unknown, expected: unknown, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
	assertions += 1;
}

class FakePeriodicContainerRegistryAdapter {
	readonly files = new Map<string, string>();
	writeCalls = 0;
	failWrite = false;
	failReadCount = 0;
	failRenameTo: string | null = null;
	failRenameToCount = 0;
	foreignOnReadFailure = false;
	private foreignValue = '{"version":1,"containers":[]}';

	async exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}

	async read(path: string): Promise<string> {
		if (this.failReadCount > 0) {
			this.failReadCount -= 1;
			if (this.foreignOnReadFailure) this.files.set(path, this.foreignValue);
			throw new Error('read denied');
		}
		const value = this.files.get(path);
		if (value === undefined) throw new Error(`Missing ${path}`);
		return value;
	}

	async write(path: string, value: string): Promise<void> {
		this.writeCalls += 1;
		if (this.failWrite) throw new Error('write denied');
		this.files.set(path, value);
	}

	async rename(from: string, to: string): Promise<void> {
		if (this.failRenameTo === to && this.failRenameToCount > 0) {
			this.failRenameToCount -= 1;
			throw new Error('rename denied');
		}
		const value = this.files.get(from);
		if (value === undefined) throw new Error(`Missing ${from}`);
		this.files.delete(from);
		this.files.set(to, value);
	}

	async remove(path: string): Promise<void> {
		this.files.delete(path);
	}
}

async function exercisePeriodicContainerRegistry(): Promise<void> {
	const path = '.obsidian/plugins/operon/state/periodic-note-containers.json';
	const adapter = new FakePeriodicContainerRegistryAdapter();
	const registry = new PeriodicNoteContainerRegistry(adapter, new WriteQueue(), path);
	deepEqual(await registry.load(), { status: 'missing' });
	equal(registry.isHealthy(), true);
	deepEqual(await registry.register({
		operonId: 'op-weekly',
		kind: 'weekly',
		lastKnownPath: 'Periodic/Weekly/2026-W34.md',
		anchorDateKey: '2026-08-17',
		source: 'operon',
	}), { status: 'committed', acknowledgement: 'direct' });
	deepEqual(registry.lookup({
		operonId: 'op-weekly',
		primary: { format: 'yaml', filePath: 'Periodic/Weekly/2026-W34.md' },
	}), {
		kind: 'periodic',
		periodicKind: 'weekly',
		anchorDateKey: '2026-08-17',
		source: 'operon',
	});
	deepEqual(registry.lookup({
		operonId: 'op-weekly',
		primary: { format: 'yaml', filePath: 'Elsewhere/2026-W34.md' },
	}), { kind: 'mismatch' }, 'out-of-band paths cannot become a new periodic identity');
	deepEqual(await registry.recordVerifiedRename(
		'op-weekly',
		'Periodic/Weekly/2026-W34.md',
		'Periodic/Archive/2026-W34.md',
	), { status: 'committed', acknowledgement: 'direct' });
	deepEqual(registry.lookup({
		operonId: 'op-weekly',
		primary: { format: 'yaml', filePath: 'Periodic/Archive/2026-W34.md' },
	}), {
		kind: 'periodic',
		periodicKind: 'weekly',
		anchorDateKey: '2026-08-17',
		source: 'operon',
	});
	deepEqual(await registry.backfill([
		{
			operonId: 'op-daily',
			kind: 'daily',
			lastKnownPath: 'Periodic/Daily/2026-08-19.md',
			anchorDateKey: '2026-08-19',
		},
		{
			operonId: 'op-ambiguous',
			kind: 'ambiguous',
			lastKnownPath: 'Periodic/Shared/2026-08-19.md',
		},
	]), {
		added: 2,
		conflicted: 0,
		persistence: { status: 'committed', acknowledgement: 'direct' },
	});
	deepEqual(registry.lookup({
		operonId: 'op-ambiguous',
		primary: { format: 'yaml', filePath: 'Periodic/Shared/2026-08-19.md' },
	}), { kind: 'ambiguous' });
	const writesBeforeDuplicateBackfill = adapter.writeCalls;
	deepEqual(await registry.backfill([
		{
			operonId: 'duplicate-backfill',
			kind: 'daily',
			lastKnownPath: 'Periodic/Daily/2026-08-20.md',
			anchorDateKey: '2026-08-20',
		},
		{
			operonId: 'duplicate-backfill',
			kind: 'weekly',
			lastKnownPath: 'Periodic/Weekly/2026-W34.md',
			anchorDateKey: '2026-08-17',
		},
	]), {
		added: 0,
		conflicted: 1,
		persistence: { status: 'committed', acknowledgement: 'direct' },
	}, 'conflicting input cannot adopt either duplicate identity');
	equal(adapter.writeCalls, writesBeforeDuplicateBackfill, 'conflicting backfill remains zero-write');
	deepEqual(registry.lookup({
		operonId: 'duplicate-backfill',
		primary: { format: 'yaml', filePath: 'Periodic/Daily/2026-08-20.md' },
	}), { kind: 'none' });
	const serialized = adapter.files.get(path) ?? '';
	const dailyIndex = serialized.indexOf('op-daily');
	const ambiguousIndex = serialized.indexOf('op-ambiguous');
	const weeklyIndex = serialized.indexOf('op-weekly');
	equal(ambiguousIndex < dailyIndex && dailyIndex < weeklyIndex, true, 'registry serialization is deterministic by stable id');
	const writesAfterBackfill = adapter.writeCalls;
	deepEqual(await registry.backfill([
		{
			operonId: 'op-daily',
			kind: 'daily',
			lastKnownPath: 'Periodic/Daily/2026-08-19.md',
			anchorDateKey: '2026-08-19',
		},
	]), {
		added: 0,
		conflicted: 0,
		persistence: { status: 'committed', acknowledgement: 'direct' },
	});
	equal(adapter.writeCalls, writesAfterBackfill, 'unchanged second startup backfill must be zero-write');
	deepEqual(await registry.recordVerifiedDelete('op-weekly', 'Periodic/Archive/2026-W34.md'), {
		status: 'committed',
		acknowledgement: 'direct',
	});
	deepEqual(registry.lookup({
		operonId: 'op-weekly',
		primary: { format: 'yaml', filePath: 'Periodic/Archive/2026-W34.md' },
	}), { kind: 'none' });

	deepEqual(parsePeriodicNoteContainerRegistryV1(JSON.stringify({
		version: 1,
		containers: [{
			operonId: 'op-daily',
			kind: 'daily',
			lastKnownPath: 'Periodic/Daily/2026-08-19.md',
			anchorDateKey: '2026-08-19',
		}],
	})), {
		version: 1,
		containers: [{
			operonId: 'op-daily',
			kind: 'daily',
			lastKnownPath: 'Periodic/Daily/2026-08-19.md',
			anchorDateKey: '2026-08-19',
		}],
	});
	equal(parsePeriodicNoteContainerRegistryV1('{'), null);
	equal(parsePeriodicNoteContainerRegistryV1(JSON.stringify({
		version: 1,
		containers: [
			{ operonId: 'duplicate', kind: 'daily', lastKnownPath: 'Daily/2026-08-19.md', anchorDateKey: '2026-08-19' },
			{ operonId: 'duplicate', kind: 'weekly', lastKnownPath: 'Weekly/2026-W34.md', anchorDateKey: '2026-08-17' },
		],
	})), null);

	const futureAdapter = new FakePeriodicContainerRegistryAdapter();
	const futureRaw = JSON.stringify({ version: 2, containers: [] });
	futureAdapter.files.set(path, futureRaw);
	const futureRegistry = new PeriodicNoteContainerRegistry(futureAdapter, new WriteQueue(), path);
	deepEqual(await futureRegistry.load(), { status: 'future-version' });
	equal(futureRegistry.isHealthy(), false);
	equal(futureAdapter.files.get(path), futureRaw, 'future state must be preserved without rewrite');

	const failureAdapter = new FakePeriodicContainerRegistryAdapter();
	failureAdapter.failWrite = true;
	const failureRegistry = new PeriodicNoteContainerRegistry(failureAdapter, new WriteQueue(), path);
	await failureRegistry.load();
	deepEqual(await failureRegistry.register({
		operonId: 'op-failure',
		kind: 'daily',
		lastKnownPath: 'Daily/2026-08-19.md',
		anchorDateKey: '2026-08-19',
	}), {
		status: 'clean-failure',
		message: 'write denied',
	});
	equal(failureRegistry.isHealthy(), true, 'known pre-write failure stays healthy and does not suspend the mover');
}

function makePeriodicYamlTask(operonId: string, filePath: string): IndexedTask {
	return {
		operonId,
		description: 'Periodic container',
		checkbox: 'open',
		fieldValues: {},
		tags: [],
		primary: { format: 'yaml', filePath, lineNumber: 0 },
		datetimeModified: '2026-08-19T12:00:00.000Z',
		tier: 'hot',
	};
}

async function exercisePeriodicContainerRegistryFailureOutcomes(): Promise<void> {
	const path = '.obsidian/plugins/operon/state/periodic-note-containers.json';

	const acknowledgedAdapter = new FakePeriodicContainerRegistryAdapter();
	const acknowledgedRegistry = new PeriodicNoteContainerRegistry(acknowledgedAdapter, new WriteQueue(), path);
	await acknowledgedRegistry.load();
	acknowledgedAdapter.failReadCount = 1;
	deepEqual(await acknowledgedRegistry.register({
		operonId: 'acknowledged-after-error',
		kind: 'daily',
		lastKnownPath: 'Daily/2026-08-19.md',
		anchorDateKey: '2026-08-19',
	}), {
		status: 'committed',
		acknowledgement: 'candidate-after-error',
	});
	equal(acknowledgedRegistry.isHealthy(), true, 'candidate readback after a failed acknowledgement remains committed');

	const cleanAdapter = new FakePeriodicContainerRegistryAdapter();
	const cleanRegistry = new PeriodicNoteContainerRegistry(cleanAdapter, new WriteQueue(), path);
	await cleanRegistry.load();
	await cleanRegistry.register({
		operonId: 'known-previous-state',
		kind: 'daily',
		lastKnownPath: 'Daily/2026-08-19.md',
		anchorDateKey: '2026-08-19',
	});
	cleanAdapter.failRenameTo = path;
	cleanAdapter.failRenameToCount = 1;
	deepEqual(await cleanRegistry.register({
		operonId: 'clean-failure-entry',
		kind: 'weekly',
		lastKnownPath: 'Weekly/2026-W34.md',
		anchorDateKey: '2026-08-17',
	}), {
		status: 'clean-failure',
		message: 'rename denied',
	});
	equal(cleanRegistry.isHealthy(), true, 'exact restored previous state is not a mover-suspending outcome');
	deepEqual(cleanRegistry.lookup({
		operonId: 'clean-failure-entry',
		primary: { format: 'yaml', filePath: 'Weekly/2026-W34.md' },
	}), { kind: 'none' });

	const uncertainAdapter = new FakePeriodicContainerRegistryAdapter();
	const uncertainRegistry = new PeriodicNoteContainerRegistry(uncertainAdapter, new WriteQueue(), path);
	await uncertainRegistry.load();
	uncertainAdapter.failReadCount = 2;
	deepEqual(await uncertainRegistry.register({
		operonId: 'uncertain-state',
		kind: 'daily',
		lastKnownPath: 'Daily/2026-08-19.md',
		anchorDateKey: '2026-08-19',
	}), {
		status: 'uncertain',
		message: 'read denied',
		recoveryRequired: true,
	});
	equal(uncertainRegistry.isHealthy(), false, 'unreadable acknowledgement suspends automatic reconciliation');

	const foreignAdapter = new FakePeriodicContainerRegistryAdapter();
	const foreignRegistry = new PeriodicNoteContainerRegistry(foreignAdapter, new WriteQueue(), path);
	await foreignRegistry.load();
	foreignAdapter.failReadCount = 1;
	foreignAdapter.foreignOnReadFailure = true;
	deepEqual(await foreignRegistry.register({
		operonId: 'foreign-state',
		kind: 'daily',
		lastKnownPath: 'Daily/2026-08-19.md',
		anchorDateKey: '2026-08-19',
	}), {
		status: 'uncertain',
		message: 'read denied',
		recoveryRequired: true,
	});
	equal(foreignRegistry.isHealthy(), false, 'foreign registry contents after a failed write acknowledgement suspend the mover');

	const missingToForeignAdapter = new FakePeriodicContainerRegistryAdapter();
	const missingToForeignRegistry = new PeriodicNoteContainerRegistry(missingToForeignAdapter, new WriteQueue(), path);
	await missingToForeignRegistry.load();
	const foreignRaw = '{"version":1,"containers":[]}';
	missingToForeignAdapter.files.set(path, foreignRaw);
	const writesBeforeMissingToForeign = missingToForeignAdapter.writeCalls;
	deepEqual(await missingToForeignRegistry.register({
		operonId: 'missing-to-foreign',
		kind: 'daily',
		lastKnownPath: 'Daily/2026-08-19.md',
		anchorDateKey: '2026-08-19',
	}), {
		status: 'uncertain',
		message: 'Periodic container registry changed outside the current session before write.',
		recoveryRequired: true,
	});
	equal(missingToForeignRegistry.isHealthy(), false, 'missing-to-foreign drift suspends before any registry write');
	equal(missingToForeignAdapter.writeCalls, writesBeforeMissingToForeign, 'missing-to-foreign drift never overwrites the foreign file');
	equal(missingToForeignAdapter.files.get(path), foreignRaw);

	const driftAdapter = new FakePeriodicContainerRegistryAdapter();
	const driftRegistry = new PeriodicNoteContainerRegistry(driftAdapter, new WriteQueue(), path);
	await driftRegistry.load();
	await driftRegistry.register({
		operonId: 'drift-initial',
		kind: 'daily',
		lastKnownPath: 'Daily/2026-08-19.md',
		anchorDateKey: '2026-08-19',
	});
	driftAdapter.files.set(path, foreignRaw);
	const writesBeforeDrift = driftAdapter.writeCalls;
	deepEqual(await driftRegistry.register({
		operonId: 'drift-next',
		kind: 'weekly',
		lastKnownPath: 'Weekly/2026-W34.md',
		anchorDateKey: '2026-08-17',
	}), {
		status: 'uncertain',
		message: 'Periodic container registry changed outside the current session before write.',
		recoveryRequired: true,
	});
	equal(driftRegistry.isHealthy(), false, 'raw external drift suspends before the write queue runs');
	equal(driftAdapter.writeCalls, writesBeforeDrift, 'raw external drift never overwrites the foreign state');
	equal(driftAdapter.files.get(path), foreignRaw);

	const preReadAdapter = new FakePeriodicContainerRegistryAdapter();
	const preReadRegistry = new PeriodicNoteContainerRegistry(preReadAdapter, new WriteQueue(), path);
	await preReadRegistry.load();
	await preReadRegistry.register({
		operonId: 'pre-read-initial',
		kind: 'daily',
		lastKnownPath: 'Daily/2026-08-19.md',
		anchorDateKey: '2026-08-19',
	});
	preReadAdapter.failReadCount = 1;
	const writesBeforePreReadFailure = preReadAdapter.writeCalls;
	deepEqual(await preReadRegistry.register({
		operonId: 'pre-read-next',
		kind: 'weekly',
		lastKnownPath: 'Weekly/2026-W34.md',
		anchorDateKey: '2026-08-17',
	}), {
		status: 'uncertain',
		message: 'read denied',
		recoveryRequired: true,
	});
	equal(preReadRegistry.isHealthy(), false, 'pre-write read failure suspends before attempting an overwrite');
	equal(preReadAdapter.writeCalls, writesBeforePreReadFailure, 'pre-write read failure is zero-write');

	const raceAdapter = new FakePeriodicContainerRegistryAdapter();
	const raceRegistry = new PeriodicNoteContainerRegistry(raceAdapter, new WriteQueue(), path);
	await raceRegistry.load();
	await raceRegistry.register({
		operonId: 'rename-delete-race',
		kind: 'weekly',
		lastKnownPath: 'Weekly/2026-W34.md',
		anchorDateKey: '2026-08-17',
	});
	const renamed = raceRegistry.recordVerifiedRename('rename-delete-race', 'Weekly/2026-W34.md', 'Moved/2026-W34.md');
	const deleted = raceRegistry.recordVerifiedDeleteByPath('Moved/2026-W34.md');
	deepEqual(await renamed, { status: 'committed', acknowledgement: 'direct' });
	deepEqual(await deleted, { status: 'committed', acknowledgement: 'direct' });
	deepEqual(raceRegistry.lookup({
		operonId: 'rename-delete-race',
		primary: { format: 'yaml', filePath: 'Moved/2026-W34.md' },
	}), { kind: 'none' }, 'serialized rename then delete cannot leave a stale path record');
}

async function exercisePeriodicContainerStartupBackfill(): Promise<void> {
	const path = '.obsidian/plugins/operon/state/periodic-note-containers.json';
	const adapter = new FakePeriodicContainerRegistryAdapter();
	const registry = new PeriodicNoteContainerRegistry(adapter, new WriteQueue(), path);
	await registry.load();
	const task = makePeriodicYamlTask('startup-weekly', 'Periodic/Weekly/2026-W34.md');
	const events: string[] = [];
	let moverReady = false;
	const ports = {
		isRegistryHealthy: () => registry.isHealthy(),
		resolveConfigs: async () => [{
			kind: 'weekly' as const,
			folder: 'Periodic/Weekly',
			format: 'GGGG-[W]WW',
			createAsOperonTask: true,
			source: 'operon' as const,
		}],
		getAllTasks: () => [task],
		hasDuplicateOperonIdConflict: () => false,
		getFileTaskByPath: (filePath: string) => filePath === task.primary.filePath ? task : null,
		backfillRegistry: async (entries: Parameters<PeriodicNoteContainerRegistry['backfill']>[0]) => {
			events.push('backfill');
			const result = await registry.backfill(entries);
			events.push('backfill-complete');
			return result;
		},
		markPipelineReconciliationReady: () => {
			moverReady = true;
			events.push('ready');
		},
		resumePipelineReconciliation: () => { events.push(`resume:${moverReady}`); },
	};
	deepEqual(await backfillPeriodicNoteContainersBeforePipelineResume(ports), {
		status: 'completed',
		added: 1,
		conflicted: 0,
	});
	deepEqual(events, ['backfill', 'backfill-complete', 'ready', 'resume:true'], 'first startup marks mover ready before resume');
	deepEqual(registry.lookup({
		operonId: task.operonId,
		primary: { format: 'yaml', filePath: task.primary.filePath },
	}), {
		kind: 'periodic',
		periodicKind: 'weekly',
		anchorDateKey: '2026-08-17',
		source: 'operon',
	});
	const writesAfterFirstStartup = adapter.writeCalls;
	events.length = 0;
	moverReady = false;
	deepEqual(await backfillPeriodicNoteContainersBeforePipelineResume(ports), {
		status: 'completed',
		added: 0,
		conflicted: 0,
	});
	equal(adapter.writeCalls, writesAfterFirstStartup, 'second startup is semantically idempotent and zero-write');
	deepEqual(events, ['backfill', 'backfill-complete', 'ready', 'resume:true']);
	const blockedResumeEvents: string[] = [];
	deepEqual(await backfillPeriodicNoteContainersBeforePipelineResume({
		...ports,
		backfillRegistry: async () => ({
			added: 0,
			conflicted: 0,
			persistence: { status: 'clean-failure' as const, message: 'write denied' },
		}),
		markPipelineReconciliationReady: () => { blockedResumeEvents.push('ready'); },
		resumePipelineReconciliation: () => { blockedResumeEvents.push('resume'); },
	}), {
		status: 'clean-failure',
		added: 0,
		conflicted: 0,
	});
	deepEqual(blockedResumeEvents, [], 'a clean backfill failure does not resume the mover without suspending the registry');
}

async function exerciseOperationOwnedPeriodicRollback(): Promise<void> {
	let content = 'operation-owned final template';
	const snapshot = createPeriodicNoteCreatedFileSnapshot('Periodic/Daily/2026-08-19.md', content);
	deepEqual(snapshot, { path: 'Periodic/Daily/2026-08-19.md', content: 'operation-owned final template' });
	content = 'user edited during registration';
	const cleanDisposition = resolvePeriodicNoteContainerRegistrationDisposition('clean-failure', snapshot);
	equal(cleanDisposition.kind, 'guarded-rollback');
	if (cleanDisposition.kind === 'guarded-rollback') {
		deepEqual(await rollbackPeriodicNoteCreatedFileSnapshot(cleanDisposition.snapshot, async (_path, expectedContent) => (
			content === expectedContent ? 'deleted' : 'changed'
		)), 'changed', 'registration rollback cannot delete content modified after the immutable create snapshot');
	}
	const uncertainDisposition = resolvePeriodicNoteContainerRegistrationDisposition('uncertain', snapshot);
	deepEqual(uncertainDisposition, { kind: 'recovery-required' }, 'uncertain acknowledgement preserves the created file for recovery');
}

async function run(): Promise<void> {
	await exercisePeriodicContainerRegistry();
	await exercisePeriodicContainerRegistryFailureOutcomes();
	await exercisePeriodicContainerStartupBackfill();
	await exerciseOperationOwnedPeriodicRollback();
	const periodicSettings: PeriodicNoteSettingsSource = {
		manageDailyNotesWithOperon: true,
		dailyNoteFormat: 'YYYY/MM/DD',
		dailyNoteFolder: 'Operon/Daily',
		dailyNoteTemplate: 'Templates/Daily.md',
		createDailyNotesAsOperonTask: true,
		manageWeeklyNotesWithOperon: false,
		weeklyNoteFormat: DEFAULT_WEEKLY_NOTE_FORMAT,
		weeklyNoteFolder: 'Operon/Weekly',
		weeklyNoteTemplate: 'Templates/Weekly.md',
		createWeeklyNotesAsOperonTask: true,
	};
	deepEqual(buildOperonPeriodicNoteConfig('daily', periodicSettings), {
		enabled: true,
		format: 'YYYY/MM/DD',
		folder: 'Operon/Daily',
		template: 'Templates/Daily.md',
		createAsOperonTask: true,
	});
	deepEqual(buildOperonPeriodicNoteConfig('weekly', periodicSettings), {
		enabled: false,
		format: DEFAULT_WEEKLY_NOTE_FORMAT,
		folder: 'Operon/Weekly',
		template: 'Templates/Weekly.md',
		createAsOperonTask: true,
	});
	equal(isPeriodicNoteKindAvailable('daily', periodicSettings, false), true);
	equal(isPeriodicNoteKindAvailable('weekly', periodicSettings, true), false);
	equal(isPeriodicNoteKindAvailable('daily', {
		...periodicSettings,
		manageDailyNotesWithOperon: false,
	}, true), true);
	equal(isPeriodicNoteKindAvailable('daily', {
		...periodicSettings,
		manageDailyNotesWithOperon: false,
	}, false), false);
	let coreLoadCount = 0;
	deepEqual(await resolvePeriodicNoteConfigFromSettings({
		kind: 'daily',
		settings: periodicSettings,
		coreDailyNotesAvailable: true,
		loadCoreDailyNotes: async () => {
			coreLoadCount += 1;
			return { enabled: true, folder: 'Core/Daily', format: 'DD-MM-YYYY' };
		},
	}), {
		available: true,
		config: {
			kind: 'daily',
			source: 'operon',
			format: 'YYYY/MM/DD',
			folder: 'Operon/Daily',
			template: 'Templates/Daily.md',
			createAsOperonTask: true,
		},
	});
	equal(coreLoadCount, 0, 'Operon-owned Daily config must not read Core');
	deepEqual(await resolvePeriodicNoteConfigFromSettings({
		kind: 'daily',
		settings: { ...periodicSettings, manageDailyNotesWithOperon: false },
		coreDailyNotesAvailable: true,
		loadCoreDailyNotes: async () => {
			coreLoadCount += 1;
			return {
				enabled: true,
				folder: 'Core/Daily',
				format: 'DD-MM-YYYY',
				template: 'Templates/Core Daily.md',
			};
		},
	}), {
		available: true,
		config: {
			kind: 'daily',
			source: 'core-daily-notes',
			format: 'DD-MM-YYYY',
			folder: 'Core/Daily',
			template: 'Templates/Core Daily.md',
			createAsOperonTask: false,
		},
	});
	equal(coreLoadCount, 1, 'Core should load exactly once when it is the Daily fallback');

	// Daily compatibility wrappers preserve valid Core Daily Notes behavior.
	equal(DEFAULT_DAILY_NOTE_FORMAT, 'YYYY-MM-DD');
	equal(isDailyNoteDateKey('2026-02-29'), false);
	equal(isDailyNoteDateKey('2024-02-29'), true);
	equal(formatDailyNoteTitleFromDateKey('2026-08-17', ''), '2026-08-17');
	equal(formatDailyNoteTitleFromDateKey('2026-08-17', 'YYYY/MM/DD'), '2026/08/17');
	equal(resolveDailyNotePathFromDateKey('2026-08-17', {
		folder: 'Periodic/Daily',
		format: 'YYYY/MM/DD',
	}), 'Periodic/Daily/2026/08/17.md');
	equal(resolveDailyNoteDateKeyFromPath('Periodic/Daily/2026/08/17.md', {
		folder: 'Periodic/Daily',
		format: 'YYYY/MM/DD',
	}), '2026-08-17');
	equal(dailyNotePathsMatch('Daily/2026-08-17.md', 'Daily/2026-08-17.md'), true);
	equal(dailyNotePathsMatch('/Daily/2026-08-17.md/', 'Daily/2026-08-17.md'), true);

	// Weekly notes are ISO-week based and always anchored to Monday.
	equal(DEFAULT_WEEKLY_NOTE_FORMAT, 'GGGG-[W]WW');
	const weekDays = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'];
	for (const day of weekDays) {
		equal(resolvePeriodicNoteAnchorDateKey('weekly', day), '2026-08-17');
		equal(resolvePeriodicNotePathFromDateKey('weekly', day, {
			folder: 'Periodic/Weekly',
			format: DEFAULT_WEEKLY_NOTE_FORMAT,
		}), 'Periodic/Weekly/2026-W34.md');
	}
	equal(formatPeriodicNoteTitleFromDateKey('weekly', '2026-08-23', null), '2026-W34');
	equal(formatPeriodicNoteTitleFromDateKey('weekly', '2026-08-23', 'YYYY-MM-DD'), '2026-08-17');
	equal(resolvePeriodicNotePathFromDateKey('weekly', '2026-01-01', {
		folder: 'Periodic/Weekly',
		format: DEFAULT_WEEKLY_NOTE_FORMAT,
	}), 'Periodic/Weekly/2026-W01.md');
	equal(resolvePeriodicNoteAnchorDateKey('weekly', '2026-01-01'), '2025-12-29');
	equal(resolvePeriodicNoteDateKeyFromPath('weekly', 'Periodic/Weekly/2026-W01.md', {
		folder: 'Periodic/Weekly',
		format: DEFAULT_WEEKLY_NOTE_FORMAT,
	}), '2025-12-29');
	equal(isValidPeriodicNoteFormat('weekly', 'GGGG-[W]WW'), true);
	equal(isValidPeriodicNoteFormat('weekly', 'gggg-[W]ww'), true);
	equal(isValidPeriodicNoteFormat('weekly', 'YYYY-MM-DD'), true);
	equal(isValidPeriodicNoteFormat('weekly', 'GGGG-[W]ww'), false);
	equal(isValidPeriodicNoteFormat('weekly', 'gggg-[W]WW'), false);
	equal(isValidPeriodicNoteFormat('weekly', 'GGGG'), false);
	equal(isValidPeriodicNoteFormat('weekly', '[W]WW'), false);
	equal(formatPeriodicNoteTitleFromDateKey('weekly', '2026-08-17', 'GGGG-[W]ww'), null);
	equal(formatPeriodicNoteTitleFromDateKey('daily', '2026-08-17', 'YYYY-MM-DD[.md]'), null);

	// Unsafe paths are rejected instead of repaired into a different target.
	equal(normalizePeriodicNoteFolder(''), '');
	equal(normalizePeriodicNoteFolder(' Periodic Notes '), 'Periodic Notes');
	for (const unsafe of ['/Daily', '../Daily', 'Daily//Notes', 'C:/Daily', 'Daily\\Notes', 'CON', 'Aux.notes']) {
		equal(normalizePeriodicNoteFolder(unsafe), null, `unsafe folder should be rejected: ${unsafe}`);
	}
	equal(normalizePeriodicNoteFolder('.hidden'), '.hidden');
	for (const unsafe of ['../Daily', 'Daily/../Escape', 'Daily/Bad:Name', 'Daily/Bad\u0000Name']) {
		equal(isSafeVaultRelativePath(unsafe), false, `unsafe path should be rejected: ${unsafe}`);
	}
	equal(resolvePeriodicNotePathFromDateKey('daily', '2026-08-17', {
		folder: '../Escape',
		format: 'YYYY-MM-DD',
	}), null);
	equal(resolvePeriodicNotePathFromDateKey('daily', '2026-08-17', {
		folder: '',
		format: '[../Escape]/YYYY-MM-DD',
	}), null);
	equal(resolvePeriodicNotePathFromDateKey('daily', 'not-a-date', {
		folder: '',
		format: 'YYYY-MM-DD',
	}), null);

	// Effective policy never merges providers: enabled Operon wins.
	deepEqual(resolveEffectivePeriodicNoteConfig({
		kind: 'daily',
		operon: {
			enabled: true,
			folder: 'Operon/Daily',
			format: 'YYYY-MM-DD',
			template: 'Templates/Operon Daily.md',
			createAsOperonTask: true,
		},
		coreDailyNotes: {
			enabled: true,
			folder: 'Core/Daily',
			format: 'DD-MM-YYYY',
			template: 'Templates/Core Daily.md',
		},
	}), {
		available: true,
		config: {
			kind: 'daily',
			source: 'operon',
			format: 'YYYY-MM-DD',
			folder: 'Operon/Daily',
			template: 'Templates/Operon Daily.md',
			createAsOperonTask: true,
		},
	});

	deepEqual(resolveEffectivePeriodicNoteConfig({
		kind: 'daily',
		operon: { enabled: false },
		coreDailyNotes: {
			enabled: true,
			folder: 'Core/Daily',
			format: '',
			template: 'Templates/Core Daily.md',
		},
	}), {
		available: true,
		config: {
			kind: 'daily',
			source: 'core-daily-notes',
			format: DEFAULT_DAILY_NOTE_FORMAT,
			folder: 'Core/Daily',
			template: 'Templates/Core Daily.md',
			createAsOperonTask: false,
		},
	});

	deepEqual(resolveEffectivePeriodicNoteConfig({
		kind: 'daily',
		operon: { enabled: false },
		coreDailyNotes: { enabled: false },
	}), { available: false, reason: 'core-daily-notes-unavailable' });

	deepEqual(resolveEffectivePeriodicNoteConfig({
		kind: 'weekly',
		operon: { enabled: false },
		coreDailyNotes: { enabled: true, folder: 'Core', format: 'YYYY-MM-DD' },
	}), { available: false, reason: 'operon-disabled' });

	// Existing containers stay protected after the management or task toggle is
	// switched off; this is classification only, never permission to create.
	deepEqual(resolveHistoricalPeriodicNoteConfig('weekly', 'operon', {
		enabled: false,
		folder: 'Operon/Weekly',
		format: DEFAULT_WEEKLY_NOTE_FORMAT,
		createAsOperonTask: false,
	}), {
		available: true,
		config: {
			kind: 'weekly',
			source: 'operon',
			folder: 'Operon/Weekly',
			format: DEFAULT_WEEKLY_NOTE_FORMAT,
			template: '',
			createAsOperonTask: true,
		},
	});
	deepEqual(resolveHistoricalPeriodicNoteConfig('daily', 'core-daily-notes', {
		enabled: false,
		folder: 'Core/Daily',
		format: 'YYYY-MM-DD',
		createAsOperonTask: false,
	}), {
		available: true,
		config: {
			kind: 'daily',
			source: 'core-daily-notes',
			folder: 'Core/Daily',
			format: 'YYYY-MM-DD',
			template: '',
			createAsOperonTask: true,
		},
	});

	deepEqual(resolveHistoricalPeriodicNoteConfig('daily', 'operon', {
		enabled: false,
		folder: 'Operon/Daily',
		format: 'YYYY-MM-DD',
		template: '../missing-or-retired-template.md',
	}), {
		available: true,
		config: {
			kind: 'daily',
			source: 'operon',
			folder: 'Operon/Daily',
			format: 'YYYY-MM-DD',
			template: '../missing-or-retired-template.md',
			createAsOperonTask: true,
		},
	}, 'historical classification must ignore template validity');
	deepEqual(resolveHistoricalPeriodicNoteConfig('daily', 'operon', {
		enabled: false,
		folder: '../outside',
		format: 'YYYY-MM-DD',
		template: '',
	}), { available: false, reason: 'invalid-config', source: 'operon' });
	deepEqual(resolveHistoricalPeriodicNoteConfig('daily', 'operon', {
		enabled: false,
		folder: 'Operon/Daily',
		format: 'GGGG-MM-DD',
		template: '',
	}), { available: false, reason: 'invalid-config', source: 'operon' });
	deepEqual(resolveEffectivePeriodicNoteConfig({
		kind: 'daily',
		operon: {
			enabled: true,
			folder: 'Operon/Daily',
			format: 'YYYY-MM-DD',
			template: '../unsafe.md',
		},
	}), { available: false, reason: 'invalid-config', source: 'operon' },
	'creation policy must continue to reject an unsafe template');

	deepEqual(resolveEffectivePeriodicNoteConfig({
		kind: 'weekly',
		operon: { enabled: true, folder: 'Weekly', format: '' },
	}), {
		available: true,
		config: {
			kind: 'weekly',
			source: 'operon',
			format: DEFAULT_WEEKLY_NOTE_FORMAT,
			folder: 'Weekly',
			template: '',
			createAsOperonTask: false,
		},
	});

	deepEqual(resolveEffectivePeriodicNoteConfig({
		kind: 'weekly',
		operon: { enabled: true, folder: '../Weekly', format: DEFAULT_WEEKLY_NOTE_FORMAT },
	}), { available: false, reason: 'invalid-config', source: 'operon' });
	for (const template of [
		'../Templates/Weekly.md',
		'/Templates/Weekly.md',
		'C:/Templates/Weekly.md',
		'Templates\\Weekly.md',
		'Templates//Weekly.md',
		'Templates/Weekly.txt',
	]) {
		deepEqual(resolveEffectivePeriodicNoteConfig({
			kind: 'weekly',
			operon: {
				enabled: true,
				folder: 'Weekly',
				format: DEFAULT_WEEKLY_NOTE_FORMAT,
				template,
			},
		}), { available: false, reason: 'invalid-config', source: 'operon' });
	}

	const parsedContainer = {
		operonId: 'op-periodic-container',
		filePath: 'Periodic/Weekly/2026-W34.md',
		fieldValues: { operonId: 'op-periodic-container', pipeline: 'Project' },
		tags: ['weekly'],
	};
	// Existing Daily/Weekly notes become containers only through an exact,
	// unambiguous indexed File Task match.
	deepEqual(resolvePeriodicNoteContainerTask({
		createAsOperonTask: true,
		wasCreated: false,
		filePath: parsedContainer.filePath,
		parsedOperonId: parsedContainer.operonId,
		parsedFieldValues: parsedContainer.fieldValues,
		parsedTags: parsedContainer.tags,
		indexedFileTask: parsedContainer,
		hasDuplicateOperonIdConflict: false,
	}), parsedContainer);
	for (const rejected of [
		{
			label: 'unindexed existing note',
			parsedOperonId: parsedContainer.operonId,
			indexedFileTask: null,
			hasDuplicateOperonIdConflict: false,
		},
		{
			label: 'invalid existing note',
			parsedOperonId: null,
			indexedFileTask: null,
			hasDuplicateOperonIdConflict: false,
		},
		{
			label: 'mismatched existing File Task',
			parsedOperonId: parsedContainer.operonId,
			indexedFileTask: { ...parsedContainer, operonId: 'op-other' },
			hasDuplicateOperonIdConflict: false,
		},
		{
			label: 'duplicate existing File Task',
			parsedOperonId: parsedContainer.operonId,
			indexedFileTask: parsedContainer,
			hasDuplicateOperonIdConflict: true,
		},
	] as const) {
		deepEqual(resolvePeriodicNoteContainerTask({
			createAsOperonTask: true,
			wasCreated: false,
			filePath: parsedContainer.filePath,
			parsedOperonId: rejected.parsedOperonId,
			parsedFieldValues: parsedContainer.fieldValues,
			parsedTags: parsedContainer.tags,
			indexedFileTask: rejected.indexedFileTask,
			hasDuplicateOperonIdConflict: rejected.hasDuplicateOperonIdConflict,
		}), null, `${rejected.label} must not become an inline parent`);
	}
	deepEqual(resolvePeriodicNoteContainerTask({
		createAsOperonTask: true,
		wasCreated: true,
		filePath: parsedContainer.filePath,
		parsedOperonId: parsedContainer.operonId,
		parsedFieldValues: parsedContainer.fieldValues,
		parsedTags: parsedContainer.tags,
		indexedFileTask: null,
		hasDuplicateOperonIdConflict: false,
	}), null, 'newly created notes require exact indexed authority before becoming a parent');

	// Daily and Weekly parent planning share one decision chain. It changes only
	// the relation; task source files remain outside this pure resolver.
	const parentConfigs = [
		{ kind: 'daily' as const, folder: 'Periodic/Daily', format: 'YYYY-MM-DD', createAsOperonTask: true },
		{ kind: 'weekly' as const, folder: 'Periodic/Weekly', format: 'GGGG-[W]WW', createAsOperonTask: true },
	];
	const parentRealignmentTask = {
		operonId: 'child',
		primary: { format: 'inline' as const, filePath: 'Inbox.md', lineNumber: 0 },
		fieldValues: { parentTask: 'daily-parent', dateScheduled: '2026-08-20' },
	};
	deepEqual(
		classifyPeriodicFileTask({
			primary: { format: 'yaml', filePath: 'Periodic/Daily/2026-08-20.md', lineNumber: 0 },
		}, parentConfigs),
		{ kind: 'periodic', periodicKind: 'daily', anchorDateKey: '2026-08-20' },
	);
	deepEqual(
		classifyPeriodicFileTask({
			primary: { format: 'yaml', filePath: 'Periodic/Weekly/2026-W34.md', lineNumber: 0 },
		}, parentConfigs),
		{ kind: 'periodic', periodicKind: 'weekly', anchorDateKey: '2026-08-17' },
	);
	deepEqual(resolvePeriodicParentRealignment({
		currentTask: parentRealignmentTask,
		patch: { dateScheduled: '2026-09-03' },
		currentParent: { kind: 'periodic', periodicKind: 'daily', anchorDateKey: '2026-08-20' },
		currentTaskClassification: { kind: 'none' },
	}), {
		kind: 'resolve-container',
		periodicKind: 'daily',
		targetDateKey: '2026-09-03',
		reason: 'existing-parent',
	});
	deepEqual(resolvePeriodicParentRealignment({
		currentTask: {
			...parentRealignmentTask,
			fieldValues: { parentTask: 'weekly-parent', dateScheduled: '2026-08-20' },
		},
		patch: { dateScheduled: '2026-09-03' },
		currentParent: { kind: 'periodic', periodicKind: 'weekly', anchorDateKey: '2026-08-17' },
		currentTaskClassification: { kind: 'none' },
	}), {
		kind: 'resolve-container',
		periodicKind: 'weekly',
		targetDateKey: '2026-09-03',
		reason: 'existing-parent',
	});
	deepEqual(resolvePeriodicParentRealignment({
		currentTask: parentRealignmentTask,
		patch: { dateScheduled: '' },
		currentParent: { kind: 'periodic', periodicKind: 'daily', anchorDateKey: '2026-08-20' },
		currentTaskClassification: { kind: 'none' },
	}), { kind: 'clear', periodicKind: 'daily' });
	deepEqual(resolvePeriodicParentRealignment({
		currentTask: {
			...parentRealignmentTask,
			fieldValues: { dateScheduled: '' },
		},
		patch: { dateScheduled: '2026-09-03' },
		currentParent: { kind: 'none' },
		currentTaskClassification: { kind: 'none' },
		bootstrapKind: 'weekly',
	}), {
		kind: 'resolve-container',
		periodicKind: 'weekly',
		targetDateKey: '2026-09-03',
		reason: 'parentless-inline-bootstrap',
	});
	deepEqual(resolvePeriodicParentRealignment({
		currentTask: {
			...parentRealignmentTask,
			primary: { format: 'yaml', filePath: 'Tasks/Standalone.md', lineNumber: 0 },
			fieldValues: { dateScheduled: '' },
		},
		patch: { dateScheduled: '2026-09-03' },
		currentParent: { kind: 'none' },
		currentTaskClassification: { kind: 'none' },
		bootstrapKind: 'weekly',
	}), { kind: 'none' }, 'parentless File Tasks stay outside periodic bootstrap');
	deepEqual(resolvePeriodicParentRealignment({
		currentTask: parentRealignmentTask,
		patch: { dateScheduled: '2026-09-03', parentTask: '' },
		parentIntent: 'explicitly-cleared',
		currentParent: { kind: 'periodic', periodicKind: 'daily', anchorDateKey: '2026-08-20' },
		currentTaskClassification: { kind: 'none' },
	}), { kind: 'none' }, 'explicit parent clear wins');
	deepEqual(resolvePeriodicParentRealignment({
		currentTask: parentRealignmentTask,
		patch: { dateScheduled: '2026-09-03' },
		currentParent: { kind: 'periodic', periodicKind: 'daily', anchorDateKey: '2026-08-20' },
		currentTaskClassification: { kind: 'periodic', periodicKind: 'daily', anchorDateKey: '2026-08-20' },
	}), { kind: 'none' }, 'periodic containers cannot become periodic children');

	console.log(`Periodic note core tests passed: ${assertions} assertions`);
}

declare global {
	var __operonPeriodicNoteCoreTestRun: Promise<void> | undefined;
}

globalThis.__operonPeriodicNoteCoreTestRun = run();

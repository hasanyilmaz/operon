import assert from 'node:assert/strict';
import test from 'node:test';
import { coordinateOperonSettingsBackupProductionRecoveryV1 } from '../src/core/settings-backup-production-recovery';
import {
	buildOperonSettingsBackupRecoveryCapabilitiesV1,
	settleOperonSettingsBackupRecoveryRetryV1,
} from '../src/core/settings-backup-recovery-state';

test('production recovery orders canonical reload before registry and runtime settlement', async () => {
	const events: string[] = [];
	const result = await coordinateOperonSettingsBackupProductionRecoveryV1(true, {
		async reloadCanonical() { events.push('reload'); return true; },
		async refreshTableRegistry() { events.push('registry'); },
		async settleRuntime() { events.push('runtime'); return true; },
	});
	assert.deepEqual(result, { status: 'settled' });
	assert.deepEqual(events, ['reload', 'registry', 'runtime']);
});

test('reload and registry failures fail closed before later phases', async () => {
	for (const failure of ['reload', 'registry'] as const) {
		const events: string[] = [];
		const result = await coordinateOperonSettingsBackupProductionRecoveryV1(true, {
			async reloadCanonical() { events.push('reload'); return failure !== 'reload'; },
			async refreshTableRegistry() { events.push('registry'); if (failure === 'registry') throw new Error('failed'); },
			async settleRuntime() { events.push('runtime'); return true; },
		});
		assert.equal(result.status, 'degraded');
		assert.equal(result.status === 'degraded' ? result.phase : null, failure === 'reload' ? 'canonical-reload' : 'table-registry');
		assert.equal(events.includes('runtime'), false);
	}
});

test('successful retry becomes conditional undo-only recovery', () => {
	const current = buildOperonSettingsBackupRecoveryCapabilitiesV1({
		receiptId: 'receipt', undoTokenId: 'token', message: 'retry',
		runtimeRetryRequired: true, undoAvailable: true,
	});
	assert.deepEqual(current, {
		receiptId: 'receipt', undoTokenId: 'token', message: 'retry',
		canKeep: true, canRetryRuntimeRefresh: true, canUndo: true,
	});
	assert.deepEqual(settleOperonSettingsBackupRecoveryRetryV1(current, 'undo only'), {
		receiptId: 'receipt', undoTokenId: 'token', message: 'undo only',
		canKeep: true, canRetryRuntimeRefresh: false, canUndo: true,
	});
});

test('post-undo degraded recovery exposes retry only', () => {
	assert.deepEqual(buildOperonSettingsBackupRecoveryCapabilitiesV1({
		receiptId: 'receipt', undoTokenId: null, message: 'degraded',
		runtimeRetryRequired: true, undoAvailable: false,
	}), {
		receiptId: 'receipt', undoTokenId: null, message: 'degraded',
		canKeep: false, canRetryRuntimeRefresh: true, canUndo: false,
	});
});

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	checkHistoricalPublicV1Freeze,
	HISTORICAL_PUBLIC_V1_FREEZE_IDENTITY,
} from './check-historical-public-v1-freeze.mjs';

test('historical Public V1 freeze remains the exact 3.0.1 and CLI 1.0.7 evidence', async () => {
	const result = await checkHistoricalPublicV1Freeze();
	assert.deepEqual(result, {
		freezeVersion: 1,
		pluginVersion: '3.0.1',
		cliVersion: '1.0.7',
		sha256: HISTORICAL_PUBLIC_V1_FREEZE_IDENTITY.sha256,
	});
});

test('historical Public V1 freeze rejects byte drift before semantic reuse', async () => {
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'operon-historical-freeze-'));
	try {
		const source = await readFile(new URL('../../../contracts/agent-runtime/public-v1-freeze.json', import.meta.url));
		const target = path.join(temporaryRoot, 'public-v1-freeze.json');
		const changed = Buffer.from(source);
		changed[changed.length - 2] = changed[changed.length - 2] === 0x20 ? 0x09 : 0x20;
		await writeFile(target, changed);
		await assert.rejects(
			checkHistoricalPublicV1Freeze({ freezePath: target }),
			/OPERON_HISTORICAL_PUBLIC_V1_FREEZE_HASH_MISMATCH/u,
		);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});

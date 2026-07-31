import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256HexV1 } from '../../../src/agent-runtime/contracts/v1/canonical';
import {
	analyzeRuntimeFileToInlineLossV1,
	guardRuntimeExactDeleteV1,
	guardRuntimeInlineRelocationV1,
	guardRuntimeTimerControlV1,
	verifyRuntimeConversionAncestorSourceRevisionsV1,
	verifyRuntimeSourceTransitionPostflightV1,
} from '../../../src/agent-runtime/runtime/source-transition-guards';

test('timer guard seals active-start CAS and treats canonical no-op states deterministically', () => {
	const active = {
		operonId: 'abc1234',
		start: '2026-07-24T10:00:00',
		isUnassigned: false,
	};
	const sameTask = guardRuntimeTimerControlV1({
		spec: { operation: 'start', expectedActiveStart: active.start },
		requestedOperonId: active.operonId,
		active,
		targetExists: true,
		targetDuplicate: false,
	});
	assert.equal(sameTask.ok, true);
	if (sameTask.ok) {
		assert.equal(sameTask.value.noChange, true);
		assert.deepEqual(sameTask.value.expectedActive, active);
	}

	const staleStop = guardRuntimeTimerControlV1({
		spec: { operation: 'stop', expectedActiveStart: '2026-07-24T09:59:59' },
		requestedOperonId: active.operonId,
		active,
		targetExists: true,
		targetDuplicate: false,
	});
	assert.equal(staleStop.ok, false);
	if (!staleStop.ok) assert.equal(staleStop.code, 'stale-source');

	const idleStop = guardRuntimeTimerControlV1({
		spec: { operation: 'stop' },
		requestedOperonId: null,
		active: null,
		targetExists: false,
		targetDuplicate: false,
	});
	assert.equal(idleStop.ok, true);
	if (idleStop.ok) assert.equal(idleStop.value.noChange, true);

	const unassignedStart = guardRuntimeTimerControlV1({
		spec: { operation: 'start' },
		requestedOperonId: null,
		active: {
			operonId: null,
			start: '2026-07-24T10:00:00',
			isUnassigned: true,
		},
		targetExists: false,
		targetDuplicate: false,
	});
	assert.equal(unassignedStart.ok, true);
	if (unassignedStart.ok) assert.equal(unassignedStart.value.noChange, true);
});

test('timer guard blocks missing, duplicate, and non-active exact targets', () => {
	const missing = guardRuntimeTimerControlV1({
		spec: { operation: 'start' },
		requestedOperonId: 'abc1234',
		active: null,
		targetExists: false,
		targetDuplicate: false,
	});
	assert.equal(missing.ok, false);
	if (!missing.ok) assert.equal(missing.code, 'entity-not-found');

	const duplicate = guardRuntimeTimerControlV1({
		spec: { operation: 'start' },
		requestedOperonId: 'abc1234',
		active: null,
		targetExists: true,
		targetDuplicate: true,
	});
	assert.equal(duplicate.ok, false);
	if (!duplicate.ok) assert.equal(duplicate.code, 'duplicate-operon-id');

	const wrongStopTarget = guardRuntimeTimerControlV1({
		spec: { operation: 'stop' },
		requestedOperonId: 'abc1234',
		active: {
			operonId: 'def5678',
			start: '2026-07-24T10:00:00',
			isUnassigned: false,
		},
		targetExists: true,
		targetDuplicate: false,
	});
	assert.equal(wrongStopTarget.ok, false);
	if (!wrongStopTarget.ok) assert.equal(wrongStopTarget.code, 'stale-source');
});

test('same-file relocation seals exact line and source revisions', () => {
	const sourceContent = [
		'# Tasks',
		'- [ ] Move me {{operonId:: abc1234}}',
		'',
		'after',
	].join('\n');
	const sourceLine = sourceContent.split('\n')[1];
	const result = guardRuntimeInlineRelocationV1({
		operonId: 'abc1234',
		currentLocator: {
			representation: 'inline',
			filePath: 'Tasks.md',
			lineNumber: 1,
		},
		sourceContent,
		destinationContent: sourceContent,
		spec: {
			operation: 'relocate-inline',
			source: {
				locator: {
					representation: 'inline',
					filePath: 'Tasks.md',
					lineNumber: 1,
				},
				lineDigest: sha256HexV1(sourceLine),
				sourceRevision: {
					algorithm: 'sha256',
					contentDigest: sha256HexV1(sourceContent),
				},
			},
			destination: {
				locator: {
					representation: 'inline',
					filePath: 'Tasks.md',
					lineNumber: 2,
				},
				lineDigest: sha256HexV1(''),
				sourceRevision: {
					algorithm: 'sha256',
					contentDigest: sha256HexV1(sourceContent),
				},
				mustBeBlank: true,
			},
		},
		parseOperonId: line => line.includes('abc1234') ? 'abc1234' : null,
	});
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.value.groups.length, 1);
	assert.equal(result.value.groups[0].nextContent?.split('\n')[1], '');
	assert.equal(result.value.groups[0].nextContent?.split('\n')[2], sourceLine);
	assert.deepEqual(result.value.requiredAcknowledgements, []);
});

test('cross-file relocation commits destination first and binds attached-checkbox acknowledgement', () => {
	const sourceContent = [
		'# Tasks',
		'- [ ] Move me {{operonId:: abc1234}}',
		'  - [ ] attached',
	].join('\n');
	const destinationContent = '# Target\n\n';
	const sourceLine = sourceContent.split('\n')[1];
	const result = guardRuntimeInlineRelocationV1({
		operonId: 'abc1234',
		currentLocator: {
			representation: 'inline',
			filePath: 'Source.md',
			lineNumber: 1,
		},
		sourceContent,
		destinationContent,
		spec: {
			operation: 'relocate-inline',
			source: {
				locator: {
					representation: 'inline',
					filePath: 'Source.md',
					lineNumber: 1,
				},
				lineDigest: sha256HexV1(sourceLine),
				sourceRevision: {
					algorithm: 'sha256',
					contentDigest: sha256HexV1(sourceContent),
				},
			},
			destination: {
				locator: {
					representation: 'inline',
					filePath: 'Target.md',
					lineNumber: 1,
				},
				lineDigest: sha256HexV1(''),
				sourceRevision: {
					algorithm: 'sha256',
					contentDigest: sha256HexV1(destinationContent),
				},
				mustBeBlank: true,
			},
		},
		parseOperonId: line => line.includes('abc1234') ? 'abc1234' : null,
		attachedCheckboxLineNumbers: [2],
	});
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.value.groups.length, 2);
	assert.equal(result.value.groups[0].filePath, 'Target.md');
	assert.equal(result.value.groups[1].filePath, 'Source.md');
	assert.equal(result.value.warnings[0].code, 'attached-checkbox-scope-changes');
	assert.match(result.value.requiredAcknowledgements[0], /^confirm:relocate-attached-checkboxes:/u);
});

test('relocation fails closed on drift and ambiguous attached-checkbox scope', () => {
	const sourceContent = '- [ ] Move me {{operonId:: abc1234}}\n';
	const base = {
		operonId: 'abc1234',
		currentLocator: {
			representation: 'inline' as const,
			filePath: 'Source.md',
			lineNumber: 0,
		},
		sourceContent,
		destinationContent: sourceContent,
		spec: {
			operation: 'relocate-inline' as const,
			source: {
				locator: {
					representation: 'inline' as const,
					filePath: 'Source.md',
					lineNumber: 0,
				},
				lineDigest: sha256HexV1(sourceContent.split('\n')[0]),
				sourceRevision: {
					algorithm: 'sha256' as const,
					contentDigest: sha256HexV1(sourceContent),
				},
			},
			destination: {
				locator: {
					representation: 'inline' as const,
					filePath: 'Source.md',
					lineNumber: 1,
				},
				lineDigest: sha256HexV1(''),
				sourceRevision: {
					algorithm: 'sha256' as const,
					contentDigest: sha256HexV1(sourceContent),
				},
				mustBeBlank: true as const,
			},
		},
		parseOperonId: () => 'abc1234',
	};
	const stale = guardRuntimeInlineRelocationV1({
		...base,
		sourceContent: `${sourceContent}drift`,
	});
	assert.equal(stale.ok, false);
	if (!stale.ok) assert.equal(stale.code, 'stale-source');

	const ambiguous = guardRuntimeInlineRelocationV1({
		...base,
		attachedCheckboxScopeAmbiguous: true,
	});
	assert.equal(ambiguous.ok, false);
	if (!ambiguous.ok) assert.match(ambiguous.reason, /ambiguous/u);
});

test('file-to-inline loss manifest is deterministic and itemized', () => {
	const loss = analyzeRuntimeFileToInlineLossV1({
		sourceContent: [
			'---',
			'operonId: abc1234',
			'custom: retained nowhere',
			'---',
			'Body content',
			'<!-- note -->',
		].join('\n'),
		unmanagedFrontmatterKeys: ['custom', 'zeta', 'custom'],
	});
	assert.deepEqual(loss.items.map(item => item.key ? `${item.kind}:${item.key}` : item.kind), [
		'body-content',
		'html-comments',
		'unmanaged-frontmatter:custom',
		'unmanaged-frontmatter:zeta',
	]);
	assert.match(loss.digest, /^[a-f0-9]{64}$/u);
	assert.match(loss.warning.message, /body-content/u);
	assert.match(loss.warning.message, /unmanaged-frontmatter:custom/u);
});

test('exact deletion reports every blocker and allows an isolated task', () => {
	const blocked = guardRuntimeExactDeleteV1({
		activeTimer: true,
		activeTracker: true,
		childCount: 1,
		inboundReferences: ['parent'],
		outboundReferences: ['related'],
		recurrenceMember: true,
		repeatSeriesOwner: true,
	});
	assert.equal(blocked.ok, false);
	if (!blocked.ok) {
		assert.match(blocked.reason, /active-timer/u);
		assert.match(blocked.reason, /incoming-references/u);
		assert.match(blocked.reason, /repeat-series-owner/u);
	}

	const isolated = guardRuntimeExactDeleteV1({
		activeTimer: false,
		activeTracker: false,
		childCount: 0,
		inboundReferences: [],
		outboundReferences: [],
		recurrenceMember: false,
		repeatSeriesOwner: false,
	});
	assert.deepEqual(isolated, { ok: true, value: { blockerCodes: [] } });
});

test('source-transition postflight requires exact representation and pinned cleanup', () => {
	assert.equal(verifyRuntimeSourceTransitionPostflightV1({
		operation: 'convert',
		operonId: 'abc1234',
		expectedLocator: { representation: 'file', filePath: 'Tasks/Converted.md' },
		indexedLocator: { representation: 'file', filePath: 'Tasks/Converted.md' },
		duplicate: false,
		pinned: false,
		pinnedCleanupExpected: false,
	}), true);
	assert.equal(verifyRuntimeSourceTransitionPostflightV1({
		operation: 'delete',
		operonId: 'abc1234',
		indexedLocator: null,
		duplicate: false,
		pinned: true,
		pinnedCleanupExpected: true,
	}), false);
	assert.equal(verifyRuntimeSourceTransitionPostflightV1({
		operation: 'delete',
		operonId: 'abc1234',
		indexedLocator: null,
		duplicate: false,
		pinned: false,
		pinnedCleanupExpected: true,
	}), true);
});

test('conversion ancestor postflight requires every exact committed source digest', () => {
	const parent = '- [ ] Parent {{operonId:: par0001}}\n';
	const grandparent = '- [ ] Grandparent {{operonId:: gra0001}}\n';
	const committed = [
		{ resourceKind: 'task-source', resourceKey: 'Parent.md', revision: sha256HexV1(parent) },
		{ resourceKind: 'task-source', resourceKey: 'Grandparent.md', revision: sha256HexV1(grandparent) },
	];
	assert.equal(verifyRuntimeConversionAncestorSourceRevisionsV1(
		['Parent.md', 'Grandparent.md', 'Parent.md'],
		committed,
		{ 'Parent.md': parent, 'Grandparent.md': grandparent },
	), true);
	assert.equal(verifyRuntimeConversionAncestorSourceRevisionsV1(
		['Parent.md', 'Grandparent.md'],
		committed,
		{ 'Parent.md': `${parent}drift`, 'Grandparent.md': grandparent },
	), false);
	assert.equal(verifyRuntimeConversionAncestorSourceRevisionsV1(
		['Parent.md', 'Grandparent.md'],
		committed.slice(0, 1),
		{ 'Parent.md': parent, 'Grandparent.md': grandparent },
	), false);
});

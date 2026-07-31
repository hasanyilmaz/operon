import assert from 'node:assert/strict';

import {
	compileDirectReminderIntentV1,
	parseDirectReminderArgvV1,
} from '../../../packages/operon-cli/src/direct-reminder';
import type { TaskContextV1 } from '../../../src/agent-runtime/contracts/v1';

declare global {
	var __operonDirectReminderTestRun: Promise<void> | undefined;
}

globalThis.__operonDirectReminderTestRun = Promise.resolve().then(run);

function run(): void {
	testParser();
	testCompiler();
	testRefusals();
	console.log('Direct reminder parser/compiler tests passed');
}

function testParser(): void {
	assert.deepEqual(
		parseDirectReminderArgvV1('add', ['reminderRules::dateDue.030m']),
		{
			operation: 'add',
			collection: 'reminderRules',
			value: 'dateDue.30m',
		},
	);
	assert.deepEqual(
		parseDirectReminderArgvV1(
			'replace',
			['reminderDatetimes::2026-08-01T10:15:00'],
			'2026-08-01T09:00',
		),
		{
			operation: 'replace',
			collection: 'reminderDatetimes',
			currentValue: '2026-08-01T09:00:00',
			value: '2026-08-01T10:15:00',
		},
	);
	assert.deepEqual(
		parseDirectReminderArgvV1('remove', ['reminderRules::dateDue.1h']),
		{
			operation: 'remove',
			collection: 'reminderRules',
			currentValue: 'dateDue.1h',
		},
	);
}

function testCompiler(): void {
	const task = hydratedTask();
	assert.deepEqual(
		compileDirectReminderIntentV1({
			ast: parseDirectReminderArgvV1('add', ['reminderRules::dateDue.30m']),
			task,
		}),
		{
			contractVersion: 1,
			kind: 'mutation-intent',
			reason: 'The user requested a direct human-readable Operon reminder add.',
			target: {
				operonId: 'abc1234',
				locator: task.locator,
			},
			spec: {
				operation: 'add',
				collection: 'reminderRules',
				value: 'dateDue.30m',
			},
		},
	);
	assert.deepEqual(
		compileDirectReminderIntentV1({
			ast: parseDirectReminderArgvV1(
				'replace',
				['reminderRules::dateDue.1h'],
				'dateDue.030m',
			),
			task,
		}),
		{
			contractVersion: 1,
			kind: 'mutation-intent',
			reason: 'The user requested a direct human-readable Operon reminder replace.',
			target: {
				operonId: 'abc1234',
				locator: task.locator,
			},
			spec: {
				operation: 'replace',
				collection: 'reminderRules',
				itemId: 'rule-1',
				expectedValue: ' dateDue.30m',
				value: 'dateDue.1h',
			},
		},
	);
	assert.deepEqual(
		compileDirectReminderIntentV1({
			ast: parseDirectReminderArgvV1(
				'remove',
				['reminderDatetimes::2026-08-01T09:00:00'],
			),
			task,
		}),
		{
			contractVersion: 1,
			kind: 'mutation-intent',
			reason: 'The user requested a direct human-readable Operon reminder remove.',
			target: {
				operonId: 'abc1234',
				locator: task.locator,
			},
			spec: {
				operation: 'remove',
				collection: 'reminderDatetimes',
				itemId: 'absolute-1',
				expectedValue: '2026-08-01T09:00',
			},
		},
	);
}

function testRefusals(): void {
	expectCode(
		() => parseDirectReminderArgvV1('add', []),
		'DIRECT_REMINDER_ASSIGNMENT_REQUIRED',
	);
	expectCode(
		() => parseDirectReminderArgvV1('add', [
			'reminderRules::dateDue.30m',
			'reminderDatetimes::2026-08-01T09:00',
		]),
		'DIRECT_REMINDER_ASSIGNMENT_REQUIRED',
	);
	expectCode(
		() => parseDirectReminderArgvV1('add', ['dateDue::2026-08-01']),
		'DIRECT_REMINDER_INVALID_KEY',
	);
	expectCode(
		() => parseDirectReminderArgvV1('add', ['reminderRules']),
		'DIRECT_REMINDER_SYNTAX_INVALID',
	);
	expectCode(
		() => parseDirectReminderArgvV1('add', ['reminderRules::dateDue:30m']),
		'DIRECT_REMINDER_INVALID_VALUE',
	);
	expectCode(
		() => parseDirectReminderArgvV1(
			'add',
			['reminderRules::dateDue.30m; dateDue.1h'],
		),
		'DIRECT_REMINDER_MULTI_ITEM_UNAVAILABLE',
	);
	expectCode(
		() => parseDirectReminderArgvV1(
			'replace',
			['reminderRules::dateDue.1h'],
		),
		'DIRECT_REMINDER_CURRENT_REQUIRED',
	);
	expectCode(
		() => parseDirectReminderArgvV1(
			'remove',
			['reminderRules::dateDue.30m'],
			'dateDue.30m',
		),
		'DIRECT_REMINDER_CURRENT_CONFLICT',
	);
	const task = hydratedTask();
	expectCode(
		() => compileDirectReminderIntentV1({
			ast: parseDirectReminderArgvV1(
				'remove',
				['reminderRules::dateScheduled.30m'],
			),
			task,
		}),
		'DIRECT_REMINDER_ITEM_NOT_FOUND',
	);
	expectCode(
		() => compileDirectReminderIntentV1({
			ast: parseDirectReminderArgvV1(
				'replace',
				['reminderRules::dateDue.1h'],
				'dateDue.30m',
			),
			task: {
				...task,
				reminderItems: [
					...task.reminderItems!,
					{
						collection: 'reminderRules',
						itemId: 'rule-duplicate',
						expectedValue: 'dateDue.030m',
					},
				],
			},
		}),
		'DIRECT_REMINDER_ITEM_AMBIGUOUS',
	);
	expectCode(
		() => compileDirectReminderIntentV1({
			ast: parseDirectReminderArgvV1(
				'replace',
				['reminderRules::dateDue.30m'],
				'dateDue.30m',
			),
			task,
		}),
		'DIRECT_REMINDER_NO_CHANGE',
	);
	expectCode(
		() => compileDirectReminderIntentV1({
			ast: parseDirectReminderArgvV1(
				'remove',
				['reminderRules::dateDue.30m'],
			),
			task: { ...task, reminderItems: undefined },
		}),
		'DIRECT_REMINDER_ITEMS_INCOMPLETE',
	);
}

function hydratedTask(): TaskContextV1 {
	return {
		identity: {
			operonId: 'abc1234',
			validity: 'canonical',
			mutationAllowed: true,
		},
		description: 'Reminder test',
		representation: 'inline',
		locator: {
			representation: 'inline',
			filePath: 'Test.md',
			lineNumber: 2,
		},
		checkbox: 'open',
		dates: { due: '2026-08-01' },
		datetimes: {},
		relationships: {
			parentOperonId: undefined,
			childOperonIds: [],
			blockingOperonIds: [],
			blockedByOperonIds: [],
			relatedOperonIds: [],
		},
		recurrence: { repeating: false },
		tracker: { active: false, sessionCount: 0 },
		pinned: false,
		sourceRevision: {
			algorithm: 'sha256',
			contentDigest: 'a'.repeat(64),
		},
		contextRevision: {
			index: {
				sessionId: 'direct-reminder',
				ramGeneration: 1,
				durable: { status: 'missing' },
			},
			settingsFingerprint: 'b'.repeat(64),
			pinnedGeneration: 0,
			activeTrackerGeneration: 0,
			repeatSeriesRevision: 0,
			projectSerialGeneration: 0,
			projectSerialSignature: 'c'.repeat(64),
		},
		reminderItems: [
			{
				collection: 'reminderRules',
				itemId: 'rule-1',
				expectedValue: ' dateDue.30m',
			},
			{
				collection: 'reminderDatetimes',
				itemId: 'absolute-1',
				expectedValue: '2026-08-01T09:00',
			},
		],
	};
}

function expectCode(runCase: () => unknown, code: string): void {
	assert.throws(runCase, error => (
		typeof error === 'object'
		&& error !== null
		&& 'code' in error
		&& error.code === code
	));
}

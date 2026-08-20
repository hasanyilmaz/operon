import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	DEFAULT_SETTINGS,
	INLINE_TASK_COMPACT_FALLBACK_ICONS,
	migrateSettings,
	TASK_CREATOR_FALLBACK_FIELD_ICONS,
	type InlineTaskCompactChipItem,
} from '../src/types/settings';
import { buildInlineTaskCompactChipEntries } from '../src/ui/compact-task-layout';
import {
	buildTaskCreatorSnapshot,
	buildTaskCreatorSnapshotForCreateType,
	buildTaskCreatorSubmitFieldSeed,
	createEmptyTaskCreatorDraft,
	isTaskCreatorControlVisible,
	shouldReclaimTaskCreatorDescriptionFocus,
} from '../src/ui/task-creator-modal';

const TASK_DATA_KEYS = ['taskType', 'taskImage', 'taskGallery'] as const;
let assertions = 0;

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
	assertions += 1;
}

function equal<T>(actual: T, expected: T, message?: string): void {
	if (message === undefined) {
		assert.equal(actual, expected);
	} else {
		assert.equal(actual, expected, message);
	}
	assertions += 1;
}

function assertVisibleFullTaskDataItems(items: readonly { key: string; visible: boolean; iconOnly?: boolean }[]): void {
	const taskDataItems = items.filter(item => TASK_DATA_KEYS.includes(item.key as typeof TASK_DATA_KEYS[number]));
	deepEqual(taskDataItems.map(item => item.key), TASK_DATA_KEYS);
	for (const item of taskDataItems) {
		equal(item.visible, true);
		if ('iconOnly' in item) {
			equal(item.iconOnly, false);
		}
	}
	equal(items.some(item => item.key === '__taskDataType' || item.key === '__taskType'), false);
}

function assertPassiveCreatorTaskDataItems(items: readonly { key: string; visible: boolean; iconOnly?: boolean }[]): void {
	const taskDataItems = items.filter(item => TASK_DATA_KEYS.includes(item.key as typeof TASK_DATA_KEYS[number]));
	deepEqual(taskDataItems.map(item => item.key), TASK_DATA_KEYS);
	for (const item of taskDataItems) {
		equal(item.visible, false, `${item.key} must remain available but passive in New Operon Creator Toolbar defaults.`);
	}
	equal(items.some(item => item.key === '__taskDataType' || item.key === '__taskType'), false);
}

function withoutTaskData<T extends { key: string; visible: boolean; iconOnly?: boolean }>(items: readonly T[]): T[] {
	return items
		.filter(item => !TASK_DATA_KEYS.includes(item.key as typeof TASK_DATA_KEYS[number]))
		.map(item => ({ ...item }));
}

function assertTaskDataInsertion(
	items: readonly { key: string; visible: boolean; iconOnly?: boolean }[],
	previousKey: string,
	nextKey: string,
	surface: string,
): void {
	const start = items.findIndex(item => item.key === 'taskType');
	equal(start > 0, true, `${surface} should insert taskType after ${previousKey}`);
	deepEqual(items.slice(start, start + TASK_DATA_KEYS.length).map(item => item.key), TASK_DATA_KEYS, `${surface} task-data ordering`);
	equal(items[start - 1]?.key, previousKey, `${surface} preceding neighbor`);
	equal(items[start + TASK_DATA_KEYS.length]?.key, nextKey, `${surface} following neighbor`);
}

function withTaskDataPreference<T extends { key: string; visible: boolean; iconOnly?: boolean }>(
	items: readonly T[],
	key: typeof TASK_DATA_KEYS[number],
	preference: { visible: boolean; iconOnly?: boolean },
): T[] {
	return items.map(item => item.key === key
		? {
			...item,
			visible: preference.visible,
			...('iconOnly' in item && typeof preference.iconOnly === 'boolean'
				? { iconOnly: preference.iconOnly }
				: {}),
		}
		: { ...item });
}

function taskDataItem(
	items: readonly { key: string; visible: boolean; iconOnly?: boolean }[],
	key: typeof TASK_DATA_KEYS[number],
): { key: string; visible: boolean; iconOnly?: boolean } {
	const item = items.find(candidate => candidate.key === key);
	assert.ok(item, `Expected ${key} in surface configuration.`);
	assertions += 1;
	return item;
}

function createMockCreatorControl(
	options: { parentElement?: HTMLElement | null; display?: string; visibility?: string; hidden?: boolean } = {},
): HTMLElement {
	const control = {
		hidden: options.hidden ?? false,
		style: {
			display: options.display ?? '',
			visibility: options.visibility ?? '',
		},
		parentElement: options.parentElement ?? null,
		getAttribute: () => null,
		ownerDocument: null as unknown as Document,
	};
	control.ownerDocument = {
		defaultView: {
			getComputedStyle: (element: HTMLElement) => ({
				display: element.style.display || 'block',
				visibility: element.style.visibility || 'visible',
			}),
		},
	} as unknown as Document;
	return control as unknown as HTMLElement;
}

function run(): void {
	const taskCreatorSource = readFileSync(resolve(process.cwd(), 'src/ui/task-creator-modal.ts'), 'utf8');
	const settingsSource = readFileSync(resolve(process.cwd(), 'src/types/settings.ts'), 'utf8');
	const stylesSource = readFileSync(resolve(process.cwd(), 'styles.css'), 'utf8');
	assert.match(taskCreatorSource, /createCompactMarkdownEditorSurface\(this\.descriptionHostEl/u);
	assert.match(taskCreatorSource, /createCompactMarkdownEditorSurface\(this\.noteHostEl/u);
	assert.match(taskCreatorSource, /textPolicy: 'task-note'/u);
	assert.match(taskCreatorSource, /replaceRange\?\./u, 'Creator suggestions must use the shared editor range replacement seam.');
	assert.match(settingsSource, /taskType: 'box'/u, 'Task Type default icon must use box.');
	equal(INLINE_TASK_COMPACT_FALLBACK_ICONS.taskType, 'box');
	equal(TASK_CREATOR_FALLBACK_FIELD_ICONS.taskType, 'box');
	equal(DEFAULT_SETTINGS.keyMappings.find(mapping => mapping.canonicalKey === 'taskType')?.icon, 'box');
	assert.match(
		stylesSource,
		/\.operon-task-creator-compact-text-host \{\n\tbox-sizing: border-box;\n\tpadding: 0;/u,
		'Creator compact host must remain the border/layout shell while its editor owns content padding.',
	);
	assert.match(
		stylesSource,
		/\.operon-task-creator-modal-mobile \.operon-task-creator-compact-text-host \{\n\tpadding: 0;\n\toverflow: hidden;/u,
		'Creator mobile compact host must not add a second scroll surface.',
	);
	assert.match(
		taskCreatorSource,
		/!candidate\.isConnected \|\| !isTaskCreatorControlVisible\(candidate\)/u,
		'Creator Tab traversal must exclude controls inside a closed note wrapper.',
	);
	assertions += 8;
	for (const locale of ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt-BR', 'ru', 'ja', 'zh-CN', 'zh-TW']) {
		const parsed = JSON.parse(readFileSync(resolve(process.cwd(), `i18n/locales/${locale}.json`), 'utf8')) as {
			settings?: Record<string, string>;
		};
		for (const key of [
			'taskCreatorToolbarTooltip_taskType',
			'taskCreatorToolbarTooltipDesc_taskType',
			'taskCreatorToolbarTooltip_taskImage',
			'taskCreatorToolbarTooltipDesc_taskImage',
			'taskCreatorToolbarTooltip_taskGallery',
			'taskCreatorToolbarTooltipDesc_taskGallery',
		]) {
			equal(!!parsed.settings?.[key]?.trim(), true, `${locale} must define ${key}`);
		}
	}
	const multilineCreatorDraft = createEmptyTaskCreatorDraft();
	multilineCreatorDraft.description = 'First\nSecond';
	multilineCreatorDraft.note = 'First\r\nSecond\u2028Third';
	const multilineCreatorSnapshot = buildTaskCreatorSnapshot(multilineCreatorDraft);
	equal(multilineCreatorSnapshot.description, 'First Second', 'Creator descriptions remain single-line.');
	equal(multilineCreatorSnapshot.note, 'First\nSecond\nThird', 'Creator notes retain normalized task-note line breaks.');
	for (const createType of ['inline', 'file'] as const) {
		const submitSnapshot = buildTaskCreatorSnapshotForCreateType(multilineCreatorDraft, createType);
		const submitSeed = buildTaskCreatorSubmitFieldSeed(submitSnapshot);
		equal(
			submitSeed.fieldValues.note,
			'First\nSecond\nThird',
			`${createType} Creator submission must preserve normalized task-note line breaks.`,
		);
	}
	const descriptionEditorChild = {} as Element;
	const descriptionHost = {
		contains: (element: Element | null) => element === descriptionEditorChild,
	} as unknown as Element;
	equal(
		shouldReclaimTaskCreatorDescriptionFocus(descriptionEditorChild, descriptionHost, false),
		false,
		'Creator must not reclaim focus while its CodeMirror child owns focus.',
	);
	equal(
		shouldReclaimTaskCreatorDescriptionFocus({} as Element, descriptionHost, false),
		true,
		'Creator should reclaim focus only after it leaves the description surface.',
	);
	const hiddenNoteWrap = createMockCreatorControl({ display: 'none' });
	const hiddenDesktopEditor = createMockCreatorControl({ parentElement: hiddenNoteWrap });
	const visibleFallbackTextarea = createMockCreatorControl();
	equal(isTaskCreatorControlVisible(hiddenDesktopEditor), false, 'Tab traversal must skip a hidden desktop note editor.');
	equal(isTaskCreatorControlVisible(visibleFallbackTextarea), true, 'Tab traversal must keep a visible textarea fallback focusable.');
	assert.match(
		taskCreatorSource,
		/closeListPickerOnSelect: canonicalKey === 'assignees' \|\| canonicalKey === 'tags' \|\| canonicalKey === 'contexts' \|\| canonicalKey === 'taskGallery'/u,
		'taskGallery must retain the Task Creator list picker after individual selections.',
	);
	assert.match(
		taskCreatorSource,
		/\|\| canonicalKey === 'links' \|\| canonicalKey === 'taskGallery'\) \{/u,
		'taskGallery commits must not close the Task Creator picker after the first item.',
	);
	assertions += 2;

	for (const items of [
		DEFAULT_SETTINGS.inlineTaskCompactChips,
		DEFAULT_SETTINGS.filterTaskCompactChips,
		DEFAULT_SETTINGS.kanbanTaskCompactChips,
		DEFAULT_SETTINGS.taskFinderCompactChips,
		DEFAULT_SETTINGS.taskWikilinkOverlayCompactChips,
	]) {
		assertVisibleFullTaskDataItems(items);
	}
	assertPassiveCreatorTaskDataItems(DEFAULT_SETTINGS.taskCreatorToolbar);
	assertVisibleFullTaskDataItems(DEFAULT_SETTINGS.taskEditorWorkflowPickers);

	const backfilled = migrateSettings({
		settingsVersion: DEFAULT_SETTINGS.settingsVersion,
		keyMappings: DEFAULT_SETTINGS.keyMappings,
		inlineTaskCompactChips: withoutTaskData(DEFAULT_SETTINGS.inlineTaskCompactChips),
		filterTaskCompactChips: withoutTaskData(DEFAULT_SETTINGS.filterTaskCompactChips),
		kanbanTaskCompactChips: withoutTaskData(DEFAULT_SETTINGS.kanbanTaskCompactChips),
		taskFinderCompactChips: withoutTaskData(DEFAULT_SETTINGS.taskFinderCompactChips),
		taskWikilinkOverlayCompactChips: withoutTaskData(DEFAULT_SETTINGS.taskWikilinkOverlayCompactChips),
		taskCreatorToolbar: withoutTaskData(DEFAULT_SETTINGS.taskCreatorToolbar),
		taskEditorWorkflowPickers: withoutTaskData(DEFAULT_SETTINGS.taskEditorWorkflowPickers),
	});
	for (const items of [
		backfilled.inlineTaskCompactChips,
		backfilled.filterTaskCompactChips,
		backfilled.kanbanTaskCompactChips,
		backfilled.taskFinderCompactChips,
		backfilled.taskWikilinkOverlayCompactChips,
		backfilled.taskEditorWorkflowPickers,
	]) {
		assertVisibleFullTaskDataItems(items);
	}
	assertPassiveCreatorTaskDataItems(backfilled.taskCreatorToolbar);
	assertTaskDataInsertion(backfilled.inlineTaskCompactChips, 'links', 'tags', 'Inline/Reading');
	assertTaskDataInsertion(backfilled.filterTaskCompactChips, 'links', 'duration', 'Filter');
	assertTaskDataInsertion(backfilled.kanbanTaskCompactChips, 'links', 'duration', 'Kanban');
	assertTaskDataInsertion(backfilled.taskFinderCompactChips, 'links', 'duration', 'Task Finder');
	assertTaskDataInsertion(backfilled.taskWikilinkOverlayCompactChips, 'links', 'duration', 'Wikilink Overlay');
	assertTaskDataInsertion(backfilled.taskCreatorToolbar, 'taskColor', 'priority', 'Task Creator');
	assertTaskDataInsertion(backfilled.taskEditorWorkflowPickers, 'links', 'reminderDatetimes', 'Task Editor');
	const normalizedAgain = migrateSettings(backfilled);
	deepEqual(normalizedAgain.inlineTaskCompactChips, backfilled.inlineTaskCompactChips);
	deepEqual(normalizedAgain.filterTaskCompactChips, backfilled.filterTaskCompactChips);
	deepEqual(normalizedAgain.kanbanTaskCompactChips, backfilled.kanbanTaskCompactChips);
	deepEqual(normalizedAgain.taskFinderCompactChips, backfilled.taskFinderCompactChips);
	deepEqual(normalizedAgain.taskWikilinkOverlayCompactChips, backfilled.taskWikilinkOverlayCompactChips);
	deepEqual(normalizedAgain.taskCreatorToolbar, backfilled.taskCreatorToolbar);
	deepEqual(normalizedAgain.taskEditorWorkflowPickers, backfilled.taskEditorWorkflowPickers);

	const userPreferences = migrateSettings({
		settingsVersion: DEFAULT_SETTINGS.settingsVersion,
		keyMappings: DEFAULT_SETTINGS.keyMappings,
		inlineTaskCompactChips: withTaskDataPreference(DEFAULT_SETTINGS.inlineTaskCompactChips, 'taskImage', { visible: false, iconOnly: true }),
		filterTaskCompactChips: withTaskDataPreference(DEFAULT_SETTINGS.filterTaskCompactChips, 'taskType', { visible: false, iconOnly: true }),
		kanbanTaskCompactChips: withTaskDataPreference(DEFAULT_SETTINGS.kanbanTaskCompactChips, 'taskGallery', { visible: false, iconOnly: true }),
		taskFinderCompactChips: withTaskDataPreference(DEFAULT_SETTINGS.taskFinderCompactChips, 'taskImage', { visible: false, iconOnly: true }),
		taskWikilinkOverlayCompactChips: withTaskDataPreference(DEFAULT_SETTINGS.taskWikilinkOverlayCompactChips, 'taskGallery', { visible: false, iconOnly: true }),
		taskCreatorToolbar: withTaskDataPreference(DEFAULT_SETTINGS.taskCreatorToolbar, 'taskType', { visible: false }),
		taskEditorWorkflowPickers: withTaskDataPreference(DEFAULT_SETTINGS.taskEditorWorkflowPickers, 'taskGallery', { visible: false }),
	});
	const userPreferencesAgain = migrateSettings(userPreferences);
	deepEqual(userPreferencesAgain.inlineTaskCompactChips, userPreferences.inlineTaskCompactChips);
	deepEqual(userPreferencesAgain.filterTaskCompactChips, userPreferences.filterTaskCompactChips);
	deepEqual(userPreferencesAgain.kanbanTaskCompactChips, userPreferences.kanbanTaskCompactChips);
	deepEqual(userPreferencesAgain.taskFinderCompactChips, userPreferences.taskFinderCompactChips);
	deepEqual(userPreferencesAgain.taskWikilinkOverlayCompactChips, userPreferences.taskWikilinkOverlayCompactChips);
	deepEqual(userPreferencesAgain.taskCreatorToolbar, userPreferences.taskCreatorToolbar);
	deepEqual(userPreferencesAgain.taskEditorWorkflowPickers, userPreferences.taskEditorWorkflowPickers);
	for (const [items, key, expected] of [
		[userPreferences.inlineTaskCompactChips, 'taskImage', { visible: false, iconOnly: true }],
		[userPreferences.filterTaskCompactChips, 'taskType', { visible: false, iconOnly: true }],
		[userPreferences.kanbanTaskCompactChips, 'taskGallery', { visible: false, iconOnly: true }],
		[userPreferences.taskFinderCompactChips, 'taskImage', { visible: false }],
		[userPreferences.taskWikilinkOverlayCompactChips, 'taskGallery', { visible: false, iconOnly: true }],
		[userPreferences.taskCreatorToolbar, 'taskType', { visible: false }],
		[userPreferences.taskEditorWorkflowPickers, 'taskGallery', { visible: false }],
	] as const) {
		const item = taskDataItem(items, key);
		equal(item.visible, expected.visible, `${key} visible preference is preserved`);
		if ('iconOnly' in expected) equal(item.iconOnly, expected.iconOnly, `${key} iconOnly preference is preserved`);
	}

	const iconPreferences = migrateSettings({
		settingsVersion: DEFAULT_SETTINGS.settingsVersion,
		keyMappings: [
			...DEFAULT_SETTINGS.keyMappings.map(mapping => mapping.canonicalKey === 'taskType'
				? { ...mapping, icon: 'badge-check' }
				: { ...mapping }),
			{
				canonicalKey: 'customVisual',
				visiblePropertyName: 'Custom visual',
				type: 'text',
				sync: 'no',
				enabled: true,
				icon: 'orbit',
				isSystem: false,
			},
		],
	});
	equal(iconPreferences.keyMappings.find(mapping => mapping.canonicalKey === 'taskType')?.icon, 'badge-check');
	equal(iconPreferences.keyMappings.find(mapping => mapping.canonicalKey === 'customVisual')?.icon, 'orbit');

	const compactItems: InlineTaskCompactChipItem[] = TASK_DATA_KEYS.map(key => ({
		key,
		visible: true,
		iconOnly: false,
	}));
	const entries = buildInlineTaskCompactChipEntries({
		taskType: 'Reference',
		taskImage: '![[Assets/cover.png|Cover]]',
		taskGallery: 'Assets/one\\;detail.png; ![[Assets/two.png|Two]]; https://cdn.example.test/cover.png; javascript:alert(1); Assets/one\\;detail.png',
	}, [], {
		...DEFAULT_SETTINGS,
		inlineTaskCompactChips: compactItems,
	}, [], compactItems);
	deepEqual(entries.map(entry => entry.key), [
		'taskType',
		'taskImage',
		'taskGallery',
		'taskGallery',
		'taskGallery',
		'taskGallery',
	]);
	deepEqual(entries.map(entry => entry.label), [
		'Reference',
		'Cover',
		'Assets/one;detail.png',
		'Two',
		'https://cdn.example.test/cover.png',
		'javascript:alert(1)',
	]);
	equal(entries[0]?.interactive, false, 'taskType is visual-only on compact-chip surfaces.');
	equal(entries[1]?.linkTarget, 'Assets/cover.png');
	equal(entries[1]?.previewLinkTarget, 'Assets/cover.png');
	equal(entries[2]?.linkTarget, 'Assets/one;detail.png');
	equal(entries[3]?.linkTarget, 'Assets/two.png');
	equal(entries[4]?.externalUrl, 'https://cdn.example.test/cover.png');
	equal(entries[5]?.interactive, false, 'Unsupported schemes remain visible text without an open action.');
	equal(entries[5]?.linkTarget, null);
	equal(entries[5]?.externalUrl, null);

	console.log(`Task data chip surfaces: ${assertions} assertions passed`);
}

run();

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { computeContextSettingsFingerprintV1 } from '../src/agent-runtime/runtime/settings-fingerprint';
import {
	SETTINGS_BACKUP_COMPATIBILITY_BY_KEY,
	SETTINGS_BACKUP_GROUPS,
} from '../src/core/settings-backup-compatibility';
import { exportOperonSettingsBackupJsonV1 } from '../src/core/settings-backup-export';
import { validateOperonSettingsBackupGroupsV1 } from '../src/core/settings-backup-group-validation';
import { preflightOperonSettingsBackupRestoreV1 } from '../src/core/settings-backup-preflight';
import {
	DATE_DISPLAY_FORMAT_OPTIONS,
	formatUiDate,
	formatUiDatePart,
	getDateDisplayFormatDropdownOptions,
} from '../src/core/ui-date-format';
import { formatUiTaskDatetime } from '../src/core/ui-time-format';
import { resolveFilterGroupDateDisplay } from '../src/ui/filter-group-label';
import { formatDatePickerCandidateDisplay, formatDatePickerInputDisplay } from '../src/ui/field-pickers/date-picker-row';
import {
	buildCalendarReplacementDetails,
	summarizeTaskCalendarAssignment,
} from '../src/ui/calendar/calendar-modal-helpers';
import { OPERON_SETTINGS_SEARCH_REGISTRY } from '../src/ui/settings/settings-search-registry';
import {
	formatTableDetailedDatetimeValue,
	formatTableTaskDateSummaryValue,
} from '../src/ui/table/table-datetime-format';
import type { CalendarWritebackPlan } from '../src/types/calendar';
import type { IndexedTask } from '../src/types/fields';
import {
	CURRENT_SETTINGS_VERSION,
	DEFAULT_SETTINGS,
	normalizeDateDisplayFormat,
	migrateSettings,
} from '../src/types/settings';

const CREATED_AT = '2026-09-03T12:00:00.000Z';

test('date display formatter supports all fixed formats without Date parsing', () => {
	assert.equal(formatUiDate('2026-09-03', { dateDisplayFormat: 'YYYY-MM-DD' }), '2026-09-03');
	assert.equal(formatUiDate('2026-09-03', { dateDisplayFormat: 'DD/MM/YYYY' }), '03/09/2026');
	assert.equal(formatUiDate('2026-09-03', { dateDisplayFormat: 'MM/DD/YYYY' }), '09/03/2026');
	assert.equal(formatUiDate('2024-02-29', { dateDisplayFormat: 'DD/MM/YYYY' }), '29/02/2024');
	assert.equal(formatUiDate('2026-12-31', { dateDisplayFormat: 'MM/DD/YYYY' }), '12/31/2026');
	assert.equal(formatUiDate('2027-01-01', { dateDisplayFormat: 'DD/MM/YYYY' }), '01/01/2027');
});

test('invalid and non-canonical dates remain byte-for-byte unchanged', () => {
	for (const value of ['2023-02-29', '2026-13-01', '2026-04-31', '0000-01-01', '2026-9-3', ' 2026-09-03 ']) {
		assert.equal(formatUiDate(value, { dateDisplayFormat: 'DD/MM/YYYY' }), value);
	}
});

test('datetime formatting isolates the validated date prefix and is timezone-independent', () => {
	assert.equal(formatUiDatePart('2026-09-03T23:30:00+14:00', { dateDisplayFormat: 'DD/MM/YYYY' }), '03/09/2026');
	assert.equal(formatUiDatePart('2026-09-03 00:15', { dateDisplayFormat: 'MM/DD/YYYY' }), '09/03/2026');
	assert.equal(formatUiDatePart('2023-02-29T10:00', { dateDisplayFormat: 'DD/MM/YYYY' }), '2023-02-29T10:00');
	assert.equal(formatUiDatePart('Sep 3, 2026', { dateDisplayFormat: 'DD/MM/YYYY' }), 'Sep 3, 2026');
});

test('task datetime display combines the selected date format with the existing time format', () => {
	const app = { locale: 'en-US' } as never;
	assert.equal(
		formatUiTaskDatetime(app, { dateDisplayFormat: 'DD/MM/YYYY', timeFormat: '24h' }, '2026-09-03T14:05:00'),
		'03/09/2026 14:05',
	);
	assert.equal(
		formatUiTaskDatetime(app, { dateDisplayFormat: 'MM/DD/YYYY', timeFormat: '12h' }, '2026-09-03T14:05:00'),
		'09/03/2026 2:05 PM',
	);
	assert.equal(
		formatUiTaskDatetime(app, { dateDisplayFormat: 'DD/MM/YYYY', timeFormat: '12h' }, 'invalid'),
		'invalid',
	);
});

test('date and datetime picker suggestions format display dates without changing canonical candidates', () => {
	const candidate = {
		isoDate: '2026-09-04',
		primaryLabel: 'Today',
		source: 'quick',
		confidence: 1,
		kind: 'quick',
	} as const;
	assert.deepEqual(formatDatePickerCandidateDisplay(candidate, 'en', 'YYYY-MM-DD'), {
		label: 'Today',
		isoDate: '2026-09-04',
		weekday: 'Fri',
	});
	assert.deepEqual(formatDatePickerCandidateDisplay(candidate, 'en', 'DD/MM/YYYY'), {
		label: 'Today',
		isoDate: '04/09/2026',
		weekday: 'Fri',
	});
	assert.deepEqual(formatDatePickerCandidateDisplay(candidate, 'en', 'MM/DD/YYYY'), {
		label: 'Today',
		isoDate: '09/04/2026',
		weekday: 'Fri',
	});
	assert.equal(candidate.isoDate, '2026-09-04');
});

test('date and datetime picker inputs format selected dates while retaining canonical query state', () => {
	assert.equal(formatDatePickerInputDisplay('2026-09-04'), '2026-09-04');
	assert.equal(formatDatePickerInputDisplay('2026-09-04', 'DD/MM/YYYY'), '04/09/2026');
	assert.equal(formatDatePickerInputDisplay('2026-09-04', 'MM/DD/YYYY'), '09/04/2026');

	const datePickerSource = readFileSync('src/ui/field-pickers/date-picker.ts', 'utf8');
	const datetimePickerSource = readFileSync('src/ui/field-pickers/datetime-picker.ts', 'utf8');
	assert.ok(datePickerSource.includes('const queryValue = displayedCanonicalDate || input.value;'));
	assert.ok(datePickerSource.includes('input.value = formatDatePickerInputDisplay(options.value, options.dateDisplayFormat);'));
	assert.ok(datetimePickerSource.includes("return normalizeOperonDateKey(displayedCanonicalDate || input.value) ?? '';"));
	assert.ok(datetimePickerSource.includes('input.value = formatDatePickerInputDisplay(initial.datePart, options.dateDisplayFormat);'));
});

test('task and custom picker wiring passes the display preference while excluded pickers retain ISO defaults', () => {
	const datePickerSource = readFileSync('src/ui/field-pickers/date-picker.ts', 'utf8');
	const datetimePickerSource = readFileSync('src/ui/field-pickers/datetime-picker.ts', 'utf8');
	const customDateSource = readFileSync('src/ui/field-pickers/custom/custom-date-field-picker.ts', 'utf8');
	const customDatetimeSource = readFileSync('src/ui/field-pickers/custom/custom-datetime-field-picker.ts', 'utf8');
	const dispatchSource = readFileSync('src/ui/task-field-picker-dispatch.ts', 'utf8');
	const reminderSource = readFileSync('src/ui/field-pickers/reminder-picker.ts', 'utf8');
	const filePropertySource = readFileSync('src/ui/table/table-file-property-editor.ts', 'utf8');

	assert.ok(datePickerSource.includes('}, options.dateDisplayFormat);'));
	assert.ok(datetimePickerSource.includes('}, options.dateDisplayFormat);'));
	assert.ok(customDateSource.includes('dateDisplayFormat: options.dateDisplayFormat'));
	assert.ok(customDatetimeSource.includes('dateDisplayFormat: options.dateDisplayFormat'));
	assert.ok(dispatchSource.includes('dateDisplayFormat: options.settings.dateDisplayFormat'));
	assert.equal(reminderSource.includes('dateDisplayFormat'), false);
	assert.equal(filePropertySource.includes('dateDisplayFormat'), false);
});

test('Filter date groups separate their display label from the canonical Daily Note key', () => {
	assert.deepEqual(resolveFilterGroupDateDisplay('2026-09-03', { dateDisplayFormat: 'DD/MM/YYYY' }), {
		dateKey: '2026-09-03',
		displayLabel: '03/09/2026',
	});
	assert.deepEqual(resolveFilterGroupDateDisplay('No date', { dateDisplayFormat: 'MM/DD/YYYY' }), {
		dateKey: null,
		displayLabel: 'No date',
	});
});

test('Table task dates format at render time while custom and file-property identities remain isolated', () => {
	const settings = migrateSettings({
		...DEFAULT_SETTINGS,
		dateDisplayFormat: 'DD/MM/YYYY',
		timeFormat: '12h',
		keyMappings: [
			...DEFAULT_SETTINGS.keyMappings,
			{
				canonicalKey: 'customDate',
				visiblePropertyName: 'Custom date',
				type: 'date',
				sync: 'yes',
				enabled: true,
				isSystem: false,
				customOrder: 0,
			},
			{
				canonicalKey: 'customDatetime',
				visiblePropertyName: 'Custom datetime',
				type: 'datetime',
				sync: 'yes',
				enabled: true,
				isSystem: false,
				customOrder: 1,
			},
		],
	});
	assert.equal(formatTableDetailedDatetimeValue('dateDue', '2026-09-03', settings), '03/09/2026');
	assert.equal(formatTableDetailedDatetimeValue('datetimeStart', '2026-09-03T14:05:06', settings), '03/09/2026 2:05:06 PM');
	assert.equal(formatTableDetailedDatetimeValue('customDate', '2026-10-04', settings), '04/10/2026');
	assert.equal(formatTableDetailedDatetimeValue('customDatetime', '2026-10-04T08:09:10', settings), '04/10/2026 8:09:10 AM');
	assert.equal(formatTableDetailedDatetimeValue('fileProperty:published', '2026-09-03', settings), '2026-09-03');
	assert.equal(
		formatTableTaskDateSummaryValue('dateDue', '2026-09-03: 2, 2026-10-04: 1', 'TopValues', settings),
		'03/09/2026: 2, 04/10/2026: 1',
	);
	assert.equal(formatTableTaskDateSummaryValue('dateDue', '2026-09-03', 'Earliest', settings), '03/09/2026');
});

test('Calendar assignment and replacement text formats display values without changing writeback payloads', () => {
	const settings = { dateDisplayFormat: 'DD/MM/YYYY' } as const;
	const task = {
		operonId: 'calendar-display',
		description: 'Calendar display',
		checkbox: 'open',
		fieldValues: {
			dateScheduled: '2026-09-03',
			dateDue: '2026-09-05',
			datetimeStart: '2026-09-03T14:05:00',
			datetimeEnd: '2026-09-03T15:05:00',
		},
		tags: [],
		primary: { filePath: 'Calendar.md', lineNumber: 1, format: 'inline' },
		datetimeModified: '2026-09-03T12:00:00',
		tier: 'hot',
	} as IndexedTask;
	const display = { settings };
	const assignment = summarizeTaskCalendarAssignment(task, display).join(' ');
	assert.match(assignment, /03\/09\/2026T14:05:00/u);
	assert.match(assignment, /05\/09\/2026/u);
	assert.doesNotMatch(assignment, /2026-09-05/u);

	const writebackPlan = {
		payload: {
			dateScheduled: '2026-10-04',
			dateDue: '',
			datetimeStart: '2026-10-04T09:30:00',
		},
	} as CalendarWritebackPlan;
	const payloadBefore = JSON.stringify(writebackPlan.payload);
	const details = buildCalendarReplacementDetails(task, writebackPlan, display);
	assert.equal(details.find(row => row.label.includes('Scheduled'))?.before, '03/09/2026');
	assert.equal(details.find(row => row.label.includes('Scheduled'))?.after, '04/10/2026');
	assert.equal(details.find(row => row.label.includes('Starts'))?.after, '04/10/2026T09:30:00');
	assert.equal(JSON.stringify(writebackPlan.payload), payloadBefore);
});

test('planning surfaces format presentation text but retain canonical date identities', () => {
	const tableSource = readFileSync('src/ui/table/operon-table-view.ts', 'utf8');
	const embedSource = readFileSync('src/ui/embed-table-processor.ts', 'utf8');
	const calendarSource = readFileSync('src/ui/calendar/calendar-view.ts', 'utf8');
	const ganttSource = readFileSync('src/ui/table/table-gantt-renderer.ts', 'utf8');
	assert.ok(tableSource.includes('formatTableTaskDateSummaryValue('));
	assert.ok(tableSource.includes('input.settings.dateDisplayFormat'));
	assert.ok(embedSource.includes('formatTableTaskDateSummaryValue('));
	assert.ok(embedSource.includes('deps.getSettings().dateDisplayFormat'));
	assert.ok(calendarSource.includes('const displayValue = formatUiDate(fieldValue, settings);'));
	assert.ok(ganttSource.includes('content: markerDisplayDate'));
	assert.ok(ganttSource.includes('markerEl.dataset.ganttDate = marker.date;'));
	assert.ok(ganttSource.includes('formatTableGanttTooltipDate(target.date, options.locale)'));
});

test('Task Editor and Task Creator format labels without changing picker values', () => {
	const editorSource = readFileSync('src/ui/task-editor-content.ts', 'utf8');
	const creatorSource = readFileSync('src/ui/task-creator-modal.ts', 'utf8');
	assert.ok(editorSource.includes('formatUiDate(value, this.settings)'));
	assert.ok(editorSource.includes('formatUiTaskDatetime(app, settings, value)'));
	assert.ok(editorSource.includes("value: this.fieldValues[key]"));
	assert.ok(creatorSource.includes('getFieldButtonDisplayValue(key)'));
	assert.ok(creatorSource.includes('formatUiDate(rawValue, this.options.settings)'));
	assert.ok(creatorSource.includes('currentFieldValues: { ...this.draft.fieldValues }'));
});

test('Task Editor parent and child relation cards format date labels without changing date-tone inputs', () => {
	const editorSource = readFileSync('src/ui/task-editor-content.ts', 'utf8');
	assert.ok(editorSource.includes('TASK_EDITOR_DAY_PICKER_DATE_KEYS.has(key)'));
	assert.ok(editorSource.includes('label = formatUiDate(rawValue, this.settings);'));
	assert.ok(editorSource.includes('entry.iconTone = resolveTaskDateTone(key, rawValue, task.fieldValues);'));
	assert.ok(editorSource.includes('this.buildRelationContextChipEntries(parent)'));
	assert.ok(editorSource.includes('this.buildRelationContextChipEntries(child)'));
});

test('settings default and normalization preserve the additive no-migration contract', () => {
	assert.equal(CURRENT_SETTINGS_VERSION, 115);
	assert.equal(DEFAULT_SETTINGS.dateDisplayFormat, 'YYYY-MM-DD');
	assert.equal(migrateSettings({}).dateDisplayFormat, 'YYYY-MM-DD');
	assert.equal(migrateSettings({ timeFormat: '12h' }).dateDisplayFormat, 'YYYY-MM-DD');
	assert.equal(migrateSettings({ dateDisplayFormat: 'free-form' }).dateDisplayFormat, 'YYYY-MM-DD');
	assert.equal(migrateSettings({ dateDisplayFormat: 'DD/MM/YYYY' }).dateDisplayFormat, 'DD/MM/YYYY');
	assert.equal(normalizeDateDisplayFormat('MM/DD/YYYY'), 'MM/DD/YYYY');
	assert.equal(normalizeDateDisplayFormat(null), 'YYYY-MM-DD');
});

test('date display preference stays outside the Runtime V1 settings fingerprint', () => {
	const isoSettings = migrateSettings({ ...DEFAULT_SETTINGS, dateDisplayFormat: 'YYYY-MM-DD' });
	const localizedSettings = migrateSettings({ ...DEFAULT_SETTINGS, dateDisplayFormat: 'DD/MM/YYYY' });
	assert.equal(
		computeContextSettingsFingerprintV1(localizedSettings),
		computeContextSettingsFingerprintV1(isoSettings),
	);
});

test('General Settings and Settings Search share one fixed dropdown contract', () => {
	assert.deepEqual(DATE_DISPLAY_FORMAT_OPTIONS, [
		{ value: 'YYYY-MM-DD', label: 'YYYY-MM-DD — 2026-09-03' },
		{ value: 'DD/MM/YYYY', label: 'DD/MM/YYYY — 03/09/2026' },
		{ value: 'MM/DD/YYYY', label: 'MM/DD/YYYY — 09/03/2026' },
	]);
	assert.deepEqual(getDateDisplayFormatDropdownOptions(), {
		'YYYY-MM-DD': 'YYYY-MM-DD — 2026-09-03',
		'DD/MM/YYYY': 'DD/MM/YYYY — 03/09/2026',
		'MM/DD/YYYY': 'MM/DD/YYYY — 09/03/2026',
	});
	const entry = OPERON_SETTINGS_SEARCH_REGISTRY.find(candidate => candidate.key === 'dateDisplayFormat');
	assert.equal(entry?.id, 'settings.dateDisplayFormat');
	assert.equal(entry?.control, 'dropdown');
	assert.ok(entry?.aliases?.includes('date format'));

	const settingsTabSource = readFileSync('src/ui/settings-tab.ts', 'utf8');
	const timeIndex = settingsTabSource.indexOf("t('settings', 'timeFormat')", settingsTabSource.indexOf('private renderGeneralBasicsTab'));
	const dateIndex = settingsTabSource.indexOf("t('settings', 'dateDisplayFormat')", timeIndex);
	const demoIndex = settingsTabSource.indexOf("t('settings', 'demoWorkspace')", dateIndex);
	assert.ok(timeIndex >= 0 && dateIndex > timeIndex && demoIndex > dateIndex);
	assert.ok(settingsTabSource.includes("'timeFormat',\n\t'dateDisplayFormat',"));
	assert.ok(settingsTabSource.includes("if (key === 'dateDisplayFormat') {\n\t\t\tthis.applyPendingSettingsChange();\n\t\t}"));
	assert.ok(settingsTabSource.includes("dropdownOptions: [...DATE_DISPLAY_FORMAT_OPTIONS],\n\t\t\t\tonAfterChange: () => {\n\t\t\t\t\tthis.applyPendingSettingsChange();"));
});

test('settings backup exports and restores date display format through portable general settings', () => {
	assert.deepEqual(SETTINGS_BACKUP_COMPATIBILITY_BY_KEY.dateDisplayFormat, {
		support: 'portable',
		groups: ['general'],
	});
	assert.ok(SETTINGS_BACKUP_GROUPS.find(group => group.id === 'general')?.settingKeys.includes('dateDisplayFormat'));

	const source = migrateSettings({ ...DEFAULT_SETTINGS, dateDisplayFormat: 'DD/MM/YYYY' });
	const exported = exportOperonSettingsBackupJsonV1({
		settings: source,
		source: { pluginVersion: '3.6.2', obsidianVersion: '1.13.0', dataPackageSchemaVersion: 2 },
		createdAt: CREATED_AT,
	});
	assert.equal(exported.ok, true, exported.diagnostics.map(item => item.message).join('\n'));
	if (!exported.ok) return;
	const decoded = validateOperonSettingsBackupGroupsV1(exported.backup.body.groups);
	assert.equal(decoded.ok, true);
	assert.equal(decoded.payloads.general?.dateDisplayFormat, 'DD/MM/YYYY');

	const target = migrateSettings({ ...DEFAULT_SETTINGS, dateDisplayFormat: 'MM/DD/YYYY' });
	const restored = preflightOperonSettingsBackupRestoreV1({
		sourceJson: exported.json,
		targetSnapshot: {
			settings: target,
			dataPackageSchemaVersion: 2,
			settingsVersion: target.settingsVersion,
			canonicalWritesSuspended: false,
			canonicalWriteSuspensionReason: null,
		},
		selectedGroups: ['general'],
	});
	assert.equal(restored.ok, true);
	assert.equal(restored.restorePlan?.candidateSettings.dateDisplayFormat, 'DD/MM/YYYY');
});

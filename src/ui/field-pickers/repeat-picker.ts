import { createButton, createFloatingPanel } from './common';
import { normalizeOperonDateKey, type DayPickerWeekStart } from './day-picker';
import { showOperonDayPickerPopover } from './day-picker-popover';
import {
	calculateRepeatCountFromEnd,
	calculateRepeatEndFromCount,
	parseRepeatRule,
	RepeatFrequency,
	RepeatMode,
	RepeatRule,
	RepeatWeekday,
	serializeRepeatRule,
} from '../../core/repeat-rule';
import { formatRepeatRuleSummaryI18n } from '../../core/repeat-rule-i18n';
import { localToday } from '../../core/local-time';
import { t } from '../../core/i18n';
import { normalizeColor } from '../../core/task-color-source';
import {
	DEFAULT_INLINE_REPEAT_COMPLETION_MODE,
	InlineRepeatCompletionMode,
	normalizeInlineCompletionMode,
} from '../../storage/repeat-series-store';
import { wrapWithOperonHoverTooltip } from '../operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';

interface RepeatPickerSavePayload {
	repeat: string;
	datetimeRepeatEnd: string;
	repeatOccurrenceDate?: string;
	inlineCompletionMode: InlineRepeatCompletionMode;
}

export interface RepeatDayPickerPopoverOptions {
	weekStart: DayPickerWeekStart;
	showWeekNumbers: boolean;
}

interface RepeatPickerOptions {
	value?: string;
	repeatEnd?: string;
	repeatOccurrenceDate?: string;
	dateScheduled?: string;
	dateDue?: string;
	dateStarted?: string;
	datetimeStart?: string;
	datetimeEnd?: string;
	repeatSeriesId?: string;
	taskColor?: string;
	taskFormat?: 'inline' | 'yaml';
	inlineCompletionMode?: InlineRepeatCompletionMode;
	dayPickerPopover?: RepeatDayPickerPopoverOptions;
	onSave: (payload: RepeatPickerSavePayload) => void | Promise<void>;
	onClear?: () => void;
	onCancel?: () => void;
	onClose?: () => void;
}

type MonthlyMode = 'monthdays' | 'weekday';

interface RepeatDraft {
	mode: RepeatMode;
	freq: RepeatFrequency;
	interval: number;
	remainingCount: number;
	days: Set<RepeatWeekday>;
	monthdays: Set<number>;
	month: number;
	setpos: number;
	monthlyMode: MonthlyMode;
	hasEndDate: boolean;
	endDate: string;
	referenceDate: string;
	referenceDateTouched: boolean;
}

const WEEKDAY_OPTIONS: Array<{ key: RepeatWeekday; labelKey: string }> = [
	{ key: 'mo', labelKey: 'repeatWeekdayShortMo' },
	{ key: 'tu', labelKey: 'repeatWeekdayShortTu' },
	{ key: 'we', labelKey: 'repeatWeekdayShortWe' },
	{ key: 'th', labelKey: 'repeatWeekdayShortTh' },
	{ key: 'fr', labelKey: 'repeatWeekdayShortFr' },
	{ key: 'sa', labelKey: 'repeatWeekdayShortSa' },
	{ key: 'su', labelKey: 'repeatWeekdayShortSu' },
];

const POSITION_OPTIONS = [
	{ value: 1, labelKey: 'repeatPositionFirst' },
	{ value: 2, labelKey: 'repeatPositionSecond' },
	{ value: 3, labelKey: 'repeatPositionThird' },
	{ value: 4, labelKey: 'repeatPositionFourth' },
	{ value: -1, labelKey: 'repeatPositionLast' },
];

const MONTH_OPTIONS = [
	'repeatMonthJanuary',
	'repeatMonthFebruary',
	'repeatMonthMarch',
	'repeatMonthApril',
	'repeatMonthMay',
	'repeatMonthJune',
	'repeatMonthJuly',
	'repeatMonthAugust',
	'repeatMonthSeptember',
	'repeatMonthOctober',
	'repeatMonthNovember',
	'repeatMonthDecember',
];

const DEFAULT_REPEAT_DAY_PICKER_POPOVER: RepeatDayPickerPopoverOptions = {
	weekStart: 'monday',
	showWeekNumbers: true,
};

function extractDatePart(value: string | null | undefined): string {
	if (!value) return '';
	const trimmed = value.trim();
	const directDate = normalizeOperonDateKey(trimmed);
	if (directDate) return directDate;
	const datetimeDate = normalizeOperonDateKey(trimmed.slice(0, 10));
	if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed) && datetimeDate) return datetimeDate;
	return '';
}

function parseSeedDate(value: string): Date {
	const [year, month, day] = value.split('-').map(Number);
	return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function getReferenceDateSeed(options: RepeatPickerOptions, mode: RepeatMode): string {
	const explicitAnchor = extractDatePart(options.repeatOccurrenceDate)
		|| extractDatePart(options.dateScheduled);
	if (mode === 'done') {
		return explicitAnchor || localToday();
	}
	return explicitAnchor
		|| extractDatePart(options.dateDue)
		|| extractDatePart(options.dateStarted)
		|| extractDatePart(options.datetimeStart)
		|| extractDatePart(options.datetimeEnd)
		|| localToday();
}

function getWeekdayKey(seedDate: string): RepeatWeekday {
	const date = parseSeedDate(seedDate);
	return WEEKDAY_OPTIONS[(date.getDay() + 6) % 7]?.key ?? 'mo';
}

function normalizeCount(value: number): number {
	return Number.isInteger(value) && value > 0 ? value : 1;
}

function setButtonState(button: HTMLButtonElement, active: boolean): void {
	button.classList.toggle('is-active', active);
}

function resolvePayloadInlineCompletionMode(
	draft: RepeatDraft,
	taskFormat: 'inline' | 'yaml',
	mode: InlineRepeatCompletionMode,
): InlineRepeatCompletionMode {
	if (draft.mode !== 'done') return DEFAULT_INLINE_REPEAT_COMPLETION_MODE;
	if (taskFormat !== 'inline') return DEFAULT_INLINE_REPEAT_COMPLETION_MODE;
	return normalizeInlineCompletionMode(mode);
}

function shouldPersistReferenceDate(draft: RepeatDraft, options: RepeatPickerOptions): boolean {
	if (draft.mode !== 'done') return true;
	return !!extractDatePart(options.repeatOccurrenceDate) || draft.referenceDateTouched;
}

function buildSavePayload(
	draft: RepeatDraft,
	options: RepeatPickerOptions,
	taskFormat: 'inline' | 'yaml',
	inlineCompletionMode: InlineRepeatCompletionMode,
): RepeatPickerSavePayload {
	const payload: RepeatPickerSavePayload = {
		repeat: serializeRepeatRule(buildRuleFromDraft(draft)),
		datetimeRepeatEnd: draft.mode === 'count'
			? `${draft.endDate}T23:59:59`
			: draft.hasEndDate && draft.endDate
				? `${draft.endDate}T23:59:59`
				: '',
		inlineCompletionMode: resolvePayloadInlineCompletionMode(draft, taskFormat, inlineCompletionMode),
	};
	if (shouldPersistReferenceDate(draft, options)) {
		payload.repeatOccurrenceDate = draft.referenceDate;
	}
	return payload;
}

function resolvePickerAccent(panel: HTMLElement, taskColor: string | null | undefined): string {
	return normalizeColor(taskColor)
		|| normalizeColor(getComputedStyle(panel).getPropertyValue('--interactive-accent'))
		|| 'var(--interactive-accent)';
}

function createDefaultDraft(options: RepeatPickerOptions): RepeatDraft {
	const seedDate = getReferenceDateSeed(options, 'schedule');
	const seed = parseSeedDate(seedDate);
	return {
		mode: 'schedule',
		freq: 'day',
		interval: 1,
		remainingCount: 1,
		days: new Set<RepeatWeekday>([getWeekdayKey(seedDate)]),
		monthdays: new Set<number>([seed.getDate()]),
		month: seed.getMonth() + 1,
		setpos: 1,
		monthlyMode: 'monthdays',
		hasEndDate: !!extractDatePart(options.repeatEnd),
		endDate: extractDatePart(options.repeatEnd),
		referenceDate: seedDate,
		referenceDateTouched: false,
	};
}

function createDraftFromRule(rule: RepeatRule | null, options: RepeatPickerOptions): RepeatDraft {
	const draft = createDefaultDraft(options);
	if (!rule) return normalizeDraft(draft);

	draft.mode = rule.mode;
	draft.referenceDate = getReferenceDateSeed(options, draft.mode);
	draft.freq = rule.freq;
	draft.interval = rule.interval;
	draft.endDate = extractDatePart(options.repeatEnd);
	draft.hasEndDate = !!draft.endDate;
	draft.remainingCount = normalizeCount(rule.count ?? 1);
	if (rule.days?.length) {
		draft.days = new Set(rule.days);
	}
	if (rule.monthdays?.length) {
		draft.monthdays = new Set(rule.monthdays);
		draft.monthlyMode = 'monthdays';
	}
	if (rule.month) {
		draft.month = rule.month;
	}
	if (typeof rule.setpos === 'number') {
		draft.setpos = rule.setpos;
		draft.monthlyMode = 'weekday';
	}
	if (rule.freq === 'month' && rule.days?.length && typeof rule.setpos === 'number') {
		draft.monthlyMode = 'weekday';
	}

	return normalizeDraft(draft);
}

function buildRuleFromDraft(draft: RepeatDraft): RepeatRule {
	if (draft.mode === 'done') {
		return {
			mode: 'done',
			freq: draft.freq,
			interval: Math.max(1, draft.interval),
		};
	}

	const mode: RepeatMode = draft.mode === 'count' ? 'count' : 'schedule';
	if (draft.freq === 'day') {
		return {
			mode,
			freq: 'day',
			interval: Math.max(1, draft.interval),
			...(draft.mode === 'count' ? { count: normalizeCount(draft.remainingCount) } : {}),
		};
	}

	if (draft.freq === 'week') {
		return {
			mode,
			freq: 'week',
			interval: Math.max(1, draft.interval),
			days: [...(draft.days.size ? draft.days : [getWeekdayKey(draft.referenceDate)])],
			...(draft.mode === 'count' ? { count: normalizeCount(draft.remainingCount) } : {}),
		};
	}

	if (draft.freq === 'month' && draft.monthlyMode === 'weekday') {
		const weekday = [...draft.days][0] ?? getWeekdayKey(draft.referenceDate);
		return {
			mode,
			freq: 'month',
			interval: Math.max(1, draft.interval),
			days: [weekday],
			setpos: draft.setpos,
			...(draft.mode === 'count' ? { count: normalizeCount(draft.remainingCount) } : {}),
		};
	}

	if (draft.freq === 'month') {
		const seedDay = parseSeedDate(draft.referenceDate).getDate();
		const monthdays = [...(draft.monthdays.size ? draft.monthdays : [seedDay])].sort((a, b) => a - b);
		return {
			mode,
			freq: 'month',
			interval: Math.max(1, draft.interval),
			monthdays,
			...(draft.mode === 'count' ? { count: normalizeCount(draft.remainingCount) } : {}),
		};
	}

	const seedDay = parseSeedDate(draft.referenceDate).getDate();
	const monthdays = [...(draft.monthdays.size ? draft.monthdays : [seedDay])].sort((a, b) => a - b);
	return {
		mode,
		freq: 'year',
		interval: Math.max(1, draft.interval),
		month: draft.month,
		monthdays,
		...(draft.mode === 'count' ? { count: normalizeCount(draft.remainingCount) } : {}),
	};
}

function normalizeDraft(draft: RepeatDraft): RepeatDraft {
	draft.interval = normalizeCount(draft.interval);
	draft.remainingCount = normalizeCount(draft.remainingCount);
	if (draft.mode === 'count') {
		draft.hasEndDate = true;
		const derivedEnd = calculateRepeatEndFromCount(
			buildRuleFromDraft(draft),
			draft.referenceDate,
			draft.remainingCount,
		);
		draft.endDate = derivedEnd ?? draft.referenceDate;
		return draft;
	}

	if (!draft.hasEndDate) {
		draft.endDate = '';
		return draft;
	}

	const safeEnd = extractDatePart(draft.endDate) || draft.referenceDate;
	if (draft.mode === 'schedule') {
		draft.endDate = safeEnd < draft.referenceDate ? draft.referenceDate : safeEnd;
		return draft;
	}

	draft.endDate = safeEnd;
	return draft;
}

function getCountInfo(draft: RepeatDraft): string {
	if (draft.mode === 'done') return '';
	const rule = buildRuleFromDraft(draft);
	if (draft.mode === 'count') {
		return String(draft.remainingCount);
	}
	if (!draft.hasEndDate || !draft.endDate) return '';
	const count = calculateRepeatCountFromEnd(rule, draft.referenceDate, draft.endDate);
	return count ? String(count) : '';
}

function getReadonlyEndDate(draft: RepeatDraft): string {
	if (draft.mode === 'count') return draft.endDate;
	if (!draft.hasEndDate) return '';
	return draft.endDate;
}

export function showRepeatPicker(anchor: HTMLElement | DOMRect, options: RepeatPickerOptions): () => void {
	let completed = false;
	let activeDatePopoverClose: (() => void) | null = null;
	let activeDatePopoverAnchor: HTMLInputElement | null = null;
	const rawValue = options.value?.trim() ?? '';
	const parsedRule = parseRepeatRule(rawValue);
	const showInvalidState = !!rawValue && !parsedRule;
	let draft = createDraftFromRule(parsedRule, options);
	let inlineCompletionMode = normalizeInlineCompletionMode(options.inlineCompletionMode);
	const taskFormat = options.taskFormat ?? 'inline';
	const dayPickerPopover = options.dayPickerPopover ?? DEFAULT_REPEAT_DAY_PICKER_POPOVER;
	const closeActiveDatePopover = (): void => {
		const closePopover = activeDatePopoverClose;
		activeDatePopoverClose = null;
		activeDatePopoverAnchor = null;
		closePopover?.();
	};
	const setDraftMode = (mode: RepeatMode): void => {
		if (draft.mode === mode) return;
		draft.mode = mode;
		if (!draft.referenceDateTouched) {
			draft.referenceDate = getReferenceDateSeed(options, mode);
		}
	};

	const { panel, close } = createFloatingPanel(anchor, 'operon-floating-panel operon-repeat-picker-panel', () => {
		closeActiveDatePopover();
		if (!completed) options.onCancel?.();
		options.onClose?.();
	});

	const openDatePopover = (
		input: HTMLInputElement,
		value: string,
		canClear: boolean,
		onSelect: (value: string) => void,
		onClear?: () => void,
	): void => {
		if (activeDatePopoverClose && activeDatePopoverAnchor === input) return;
		closeActiveDatePopover();
		activeDatePopoverAnchor = input;
		activeDatePopoverClose = showOperonDayPickerPopover(input, {
			value,
			weekStart: dayPickerPopover.weekStart,
			showWeekNumbers: dayPickerPopover.showWeekNumbers,
			canClear,
			floatingHost: panel,
			onSelect,
			onClear,
			onClose: () => {
				activeDatePopoverClose = null;
				activeDatePopoverAnchor = null;
			},
		});
	};

	const commit = (payload: RepeatPickerSavePayload) => {
		completed = true;
		void options.onSave(payload);
		close();
	};

	if (showInvalidState) {
		panel.createDiv({ cls: 'operon-floating-title', text: t('taskEditor', 'repeat') });
		panel.createDiv({
			cls: 'operon-repeat-picker-warning',
			text: t('taskEditor', 'repeatUnsupportedWarning'),
		});
		panel.createDiv({
			cls: 'operon-repeat-picker-raw',
			text: rawValue,
		});
		const actions = panel.createDiv('operon-floating-actions');
		if (options.onClear) {
			const clear = createButton(t('taskEditor', 'repeatClear'), 'operon-floating-btn is-secondary', actions);
			clear.addEventListener('click', () => {
				completed = true;
				options.onClear?.();
				close();
			});
			actions.appendChild(clear);
		}
		const replace = createButton(t('taskEditor', 'repeatReplace'), 'operon-floating-btn', actions);
		replace.addEventListener('click', () => {
			panel.empty();
			renderBuilder();
		});
		actions.appendChild(replace);
		return close;
	}

	renderBuilder();
	return close;

	function renderBuilder(): void {
		draft = normalizeDraft(draft);
		closeActiveDatePopover();
		panel.empty();
		panel.classList.add('operon-repeat-picker-panel');
		panel.createDiv({ cls: 'operon-floating-title', text: t('taskEditor', 'repeat') });

		const pickerAccent = resolvePickerAccent(panel, options.taskColor);
		panel.style.setProperty('--operon-live-hover-border', pickerAccent);
		const hero = panel.createDiv('operon-repeat-picker-hero');
		hero.style.setProperty('--operon-repeat-picker-hero-border', pickerAccent);
		hero.style.borderColor = pickerAccent;
		hero.style.boxShadow = `0 0 0 1px ${pickerAccent}, 0 2px 8px rgba(0, 0, 0, 0.08)`;
		hero.createDiv({ cls: 'operon-repeat-picker-hero-label', text: t('taskEditor', 'repeatSummary') });
		const heroValue = hero.createDiv('operon-repeat-picker-hero-value');

		const modeSection = panel.createDiv('operon-repeat-picker-section');
		const modeWrap = modeSection.createDiv('operon-repeat-picker-segment operon-repeat-picker-mode-segment');
		const scheduleBtn = createButton(t('taskEditor', 'repeatModeSchedule'), 'operon-repeat-picker-segment-btn', modeWrap);
		const doneBtn = createButton(t('taskEditor', 'repeatModeDone'), 'operon-repeat-picker-segment-btn', modeWrap);
		const countBtn = createButton(t('taskEditor', 'repeatModeCount'), 'operon-repeat-picker-segment-btn', modeWrap);
		modeWrap.appendChild(scheduleBtn);
		modeWrap.appendChild(doneBtn);
		modeWrap.appendChild(countBtn);

		const cadenceSection = panel.createDiv('operon-repeat-picker-section');
		const scheduleRow = cadenceSection.createDiv('operon-repeat-picker-row');
		scheduleRow.classList.add('is-single');
		const scheduleWrap = scheduleRow.createDiv('operon-repeat-picker-field');
		scheduleWrap.createEl('label', { text: t('taskEditor', 'repeatReferenceDate'), cls: 'operon-floating-subtitle' });
		const scheduleInput = scheduleWrap.createEl('input', {
			cls: 'operon-floating-input operon-repeat-picker-date-input is-reference-date',
			attr: { type: 'text' },
		});
		scheduleInput.placeholder = t('filterSets', 'datePlaceholder');
		scheduleInput.inputMode = 'numeric';

		const countConfigRow = cadenceSection.createDiv('operon-repeat-picker-row');
		countConfigRow.classList.add('is-single');
		countConfigRow.style.display = draft.mode === 'count' ? '' : 'none';
		const countConfigWrap = countConfigRow.createDiv('operon-repeat-picker-field');
		countConfigWrap.createEl('label', { text: t('taskEditor', 'repeatTargetCount'), cls: 'operon-floating-subtitle' });
		const remainingCountInput = countConfigWrap.createEl('input', {
			cls: 'operon-floating-input',
			attr: { type: 'number', min: '1', step: '1' },
		});

		const freqRow = cadenceSection.createDiv('operon-repeat-picker-row');
		const freqWrap = freqRow.createDiv('operon-repeat-picker-field');
		freqWrap.createEl('label', { text: t('taskEditor', 'repeatFrequency'), cls: 'operon-floating-subtitle' });
		const freqSelect = freqWrap.createEl('select', { cls: 'operon-floating-input' });
		for (const value of ['day', 'week', 'month', 'year'] as RepeatFrequency[]) {
			freqSelect.createEl('option', {
				value,
				text: t('taskEditor', `repeatFreq${value.charAt(0).toUpperCase() + value.slice(1)}`),
			});
		}

		const intervalWrap = freqRow.createDiv('operon-repeat-picker-field');
		intervalWrap.createEl('label', { text: t('taskEditor', 'repeatInterval'), cls: 'operon-floating-subtitle' });
		const intervalInput = intervalWrap.createEl('input', {
			cls: 'operon-floating-input',
			attr: { type: 'number', min: '1', step: '1' },
		});

		const dynamic = cadenceSection.createDiv('operon-repeat-picker-dynamic');

		let noEndBtn: HTMLButtonElement | null = null;
		let endDateInput: HTMLInputElement | null = null;
		let endDateWrap: HTMLElement | null = null;
		if (draft.mode !== 'count') {
			const endSection = panel.createDiv('operon-repeat-picker-section');
			endSection.createDiv({ cls: 'operon-floating-subtitle', text: t('taskEditor', 'repeatEnd') });
			const endWrap = endSection.createDiv('operon-repeat-picker-end');
			noEndBtn = createButton(t('taskEditor', 'repeatNoEnd'), 'operon-repeat-picker-segment-btn', endWrap);
			const withEndBtn = createButton(t('taskEditor', 'repeatEndOnDate'), 'operon-repeat-picker-segment-btn', endWrap);
			endWrap.appendChild(noEndBtn);
			endWrap.appendChild(withEndBtn);

			const endFields = endSection.createDiv('operon-repeat-picker-row');
			endDateWrap = endFields.createDiv('operon-repeat-picker-field');
			endDateWrap.createEl('label', { text: t('taskEditor', 'repeatEndOnDate'), cls: 'operon-floating-subtitle' });
			endDateInput = endDateWrap.createEl('input', {
				cls: 'operon-floating-input operon-repeat-picker-date-input is-end-date',
				attr: { type: 'text' },
			});
			endDateInput.placeholder = t('filterSets', 'datePlaceholder');
			endDateInput.inputMode = 'numeric';

			noEndBtn.addEventListener('click', () => {
				draft.hasEndDate = false;
				draft.endDate = '';
				renderBuilder();
			});
			withEndBtn.addEventListener('click', () => {
				draft.hasEndDate = true;
				draft.endDate = draft.endDate || draft.referenceDate;
				renderBuilder();
			});
			withEndBtn.classList.toggle('is-active', draft.hasEndDate);
			noEndBtn.classList.toggle('is-active', !draft.hasEndDate);

			endDateInput.addEventListener('change', () => {
				draft.hasEndDate = true;
				draft.endDate = extractDatePart(endDateInput?.value) || draft.referenceDate;
				renderBuilder();
			});
			const openEndDatePopover = () => {
				if (!endDateInput) return;
				openDatePopover(endDateInput, draft.endDate || draft.referenceDate, !!draft.endDate, value => {
					draft.hasEndDate = true;
					draft.endDate = value;
					renderBuilder();
				}, () => {
					draft.hasEndDate = false;
					draft.endDate = '';
					renderBuilder();
				});
			};
			endDateInput.addEventListener('focus', openEndDatePopover);
			endDateInput.addEventListener('click', openEndDatePopover);
			endDateInput.value = draft.endDate;
			endDateInput.disabled = !draft.hasEndDate;
			endDateWrap.classList.toggle('is-disabled', !draft.hasEndDate);
			endFields.style.display = draft.hasEndDate ? '' : 'none';
		}

		const showInfoSection = draft.mode === 'count' || (draft.mode === 'schedule' && draft.hasEndDate);
		const infoSection = showInfoSection ? panel.createDiv('operon-repeat-picker-section') : null;
		const infoRow = infoSection?.createDiv('operon-repeat-picker-row') ?? null;
		const showInfoEndDate = draft.mode === 'count';
		const showInfoCount = draft.mode === 'schedule' && draft.hasEndDate;
		if (infoSection && (showInfoEndDate !== showInfoCount)) {
			infoRow?.classList.add('is-single');
		}

		const infoEndWrap = showInfoEndDate && infoRow
			? infoRow.createDiv('operon-repeat-picker-field')
			: null;
		let infoEndInput: HTMLInputElement | null = null;
		if (infoEndWrap) {
			infoEndWrap.createEl('label', { text: t('taskEditor', 'repeatEndOnDate'), cls: 'operon-floating-subtitle' });
			infoEndWrap.classList.add('is-disabled');
			infoEndInput = infoEndWrap.createEl('input', {
				cls: 'operon-floating-input operon-repeat-picker-date-input is-readonly-end-date',
				attr: { type: 'text', readonly: 'true' },
			});
		}

		const infoCountWrap = showInfoCount && infoRow
			? infoRow.createDiv('operon-repeat-picker-field')
			: null;
		let infoCountInput: HTMLInputElement | null = null;
		if (infoCountWrap) {
			infoCountWrap.createEl('label', { text: t('taskEditor', 'repeatCountInfo'), cls: 'operon-floating-subtitle' });
			infoCountWrap.classList.add('is-disabled');
			infoCountInput = infoCountWrap.createEl('input', {
				cls: 'operon-floating-input',
				attr: { type: 'text', readonly: 'true' },
			});
		}

		if (draft.mode === 'done') {
			const completionSection = panel.createDiv('operon-repeat-picker-section operon-repeat-picker-completed-copy-section');
			completionSection.createDiv({ cls: 'operon-floating-subtitle', text: t('taskEditor', 'repeatCompletedCopy') });
			const completionWrap = completionSection.createDiv('operon-repeat-picker-segment operon-repeat-picker-completed-copy');
			const keepBtn = createButton(t('taskEditor', 'repeatCompletedCopyKeep'), 'operon-repeat-picker-segment-btn', completionWrap);
			const replaceBtn = createButton(t('taskEditor', 'repeatCompletedCopyReplace'), 'operon-repeat-picker-segment-btn', completionWrap);
			const isInlineTask = taskFormat === 'inline';
			const selectedMode = isInlineTask
				? inlineCompletionMode
				: DEFAULT_INLINE_REPEAT_COMPLETION_MODE;
			setButtonState(keepBtn, selectedMode === 'keep-completed');
			setButtonState(replaceBtn, selectedMode === 'replace-completed');
			replaceBtn.setAttribute('aria-disabled', String(!isInlineTask));
			replaceBtn.classList.toggle('is-disabled', !isInlineTask);
			setAccessibleLabelWithoutTooltip(keepBtn, t('taskEditor', 'repeatCompletedCopyKeep'));
			setAccessibleLabelWithoutTooltip(replaceBtn, t('taskEditor', 'repeatCompletedCopyReplace'));
			const keepTooltipAnchor = wrapWithOperonHoverTooltip(keepBtn, {
				content: t('taskEditor', 'repeatCompletedCopyKeepTooltip'),
				taskColor: pickerAccent,
				preferredHorizontal: 'center',
				preferredVertical: 'above',
			});
			const replaceTooltipAnchor = wrapWithOperonHoverTooltip(replaceBtn, {
				content: isInlineTask
					? t('taskEditor', 'repeatCompletedCopyReplaceTooltip')
					: t('taskEditor', 'repeatCompletedCopyInlineOnlyTooltip'),
				taskColor: pickerAccent,
				preferredHorizontal: 'center',
				preferredVertical: 'above',
			});
			keepBtn.addEventListener('click', () => {
				inlineCompletionMode = 'keep-completed';
				renderBuilder();
			});
			replaceBtn.addEventListener('click', () => {
				if (!isInlineTask) return;
				inlineCompletionMode = 'replace-completed';
				renderBuilder();
			});
			completionWrap.appendChild(keepTooltipAnchor);
			completionWrap.appendChild(replaceTooltipAnchor);
		}

		const actions = panel.createDiv('operon-floating-actions');
		if (options.onClear) {
			const clear = createButton(t('taskEditor', 'repeatClear'), 'operon-floating-btn is-secondary', actions);
			clear.addEventListener('click', () => {
				completed = true;
				options.onClear?.();
				close();
			});
			actions.appendChild(clear);
		}

		const cancel = createButton(t('buttons', 'cancel'), 'operon-floating-btn is-secondary', actions);
		cancel.addEventListener('click', () => close());
		actions.appendChild(cancel);

		const apply = createButton(t('buttons', 'save'), 'operon-floating-btn', actions);
		apply.addEventListener('click', () => {
			const nextDraft = normalizeDraft(draft);
			commit(buildSavePayload(nextDraft, options, taskFormat, inlineCompletionMode));
		});
		actions.appendChild(apply);

		const renderWeekdayChips = (container: HTMLElement, singleSelect: boolean) => {
			const chipWrap = container.createDiv('operon-repeat-picker-chip-grid');
			for (const option of WEEKDAY_OPTIONS) {
				const button = createButton(t('taskEditor', option.labelKey), 'operon-repeat-picker-chip', chipWrap);
				setButtonState(button, draft.days.has(option.key));
				button.addEventListener('click', () => {
					if (singleSelect) {
						draft.days = new Set<RepeatWeekday>([option.key]);
					} else if (draft.days.has(option.key)) {
						draft.days.delete(option.key);
						if (draft.days.size === 0) draft.days.add(option.key);
					} else {
						draft.days.add(option.key);
					}
					renderBuilder();
				});
				chipWrap.appendChild(button);
			}
		};

		const renderMonthdayChips = (container: HTMLElement) => {
			const grid = container.createDiv('operon-repeat-picker-day-grid');
			for (let day = 1; day <= 31; day++) {
				const button = createButton(String(day), 'operon-repeat-picker-chip is-number', grid);
				setButtonState(button, draft.monthdays.has(day));
				button.addEventListener('click', () => {
					if (draft.monthdays.has(day)) {
						draft.monthdays.delete(day);
						if (draft.monthdays.size === 0) draft.monthdays.add(day);
					} else {
						draft.monthdays.add(day);
					}
					renderBuilder();
				});
				grid.appendChild(button);
			}
		};

		const renderMonthlyMode = (container: HTMLElement) => {
			const modeButtons = container.createDiv('operon-repeat-picker-segment');
			const dayBtn = createButton(t('taskEditor', 'repeatMonthOnDays'), 'operon-repeat-picker-segment-btn', modeButtons);
			const weekdayBtn = createButton(t('taskEditor', 'repeatMonthOnWeekday'), 'operon-repeat-picker-segment-btn', modeButtons);
			setButtonState(dayBtn, draft.monthlyMode === 'monthdays');
			setButtonState(weekdayBtn, draft.monthlyMode === 'weekday');
			dayBtn.addEventListener('click', () => {
				draft.monthlyMode = 'monthdays';
				renderBuilder();
			});
			weekdayBtn.addEventListener('click', () => {
				draft.monthlyMode = 'weekday';
				if (draft.days.size === 0) draft.days.add(getWeekdayKey(draft.referenceDate));
				renderBuilder();
			});
			modeButtons.appendChild(dayBtn);
			modeButtons.appendChild(weekdayBtn);

			if (draft.monthlyMode === 'monthdays') {
				renderMonthdayChips(container);
				return;
			}

			const row = container.createDiv('operon-repeat-picker-row');
			const posWrap = row.createDiv('operon-repeat-picker-field');
			posWrap.createEl('label', { text: t('taskEditor', 'repeatPosition'), cls: 'operon-floating-subtitle' });
			const posSelect = posWrap.createEl('select', { cls: 'operon-floating-input' });
			for (const option of POSITION_OPTIONS) {
				posSelect.createEl('option', { value: String(option.value), text: t('taskEditor', option.labelKey) });
			}
			posSelect.value = String(draft.setpos);
			posSelect.addEventListener('change', () => {
				draft.setpos = Number(posSelect.value);
			});

			const weekdayWrap = row.createDiv('operon-repeat-picker-field');
			weekdayWrap.createEl('label', { text: t('taskEditor', 'repeatWeekday'), cls: 'operon-floating-subtitle' });
			renderWeekdayChips(weekdayWrap, true);
		};

		const renderYearly = (container: HTMLElement) => {
			const row = container.createDiv('operon-repeat-picker-row');
			const monthWrap = row.createDiv('operon-repeat-picker-field');
			monthWrap.createEl('label', { text: t('taskEditor', 'repeatMonth'), cls: 'operon-floating-subtitle' });
			const monthSelect = monthWrap.createEl('select', { cls: 'operon-floating-input' });
			MONTH_OPTIONS.forEach((labelKey, index) => {
				monthSelect.createEl('option', { value: String(index + 1), text: t('taskEditor', labelKey) });
			});
			monthSelect.value = String(draft.month);
			monthSelect.addEventListener('change', () => {
				draft.month = Number(monthSelect.value);
			});

			const dayWrap = row.createDiv('operon-repeat-picker-field');
			dayWrap.createEl('label', { text: t('taskEditor', 'repeatDayOfMonth'), cls: 'operon-floating-subtitle' });
			const dayInput = dayWrap.createEl('input', {
				cls: 'operon-floating-input',
				attr: { type: 'number', min: '1', max: '31', step: '1' },
			});
			dayInput.value = String([...(draft.monthdays.size ? draft.monthdays : new Set([parseSeedDate(draft.referenceDate).getDate()]))][0]);
			dayInput.addEventListener('change', () => {
				const parsed = Number(dayInput.value);
				if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) return;
				draft.monthdays = new Set<number>([parsed]);
			});
		};

		const renderDynamic = () => {
			dynamic.empty();
			if (draft.mode === 'done') return;

			if (draft.freq === 'week') {
				dynamic.createDiv({ cls: 'operon-floating-subtitle', text: t('taskEditor', 'repeatWeekdays') });
				renderWeekdayChips(dynamic, false);
				return;
			}

			if (draft.freq === 'month') {
				dynamic.createDiv({ cls: 'operon-floating-subtitle', text: t('taskEditor', 'repeatMonthRule') });
				renderMonthlyMode(dynamic);
				return;
			}

			if (draft.freq === 'year') {
				renderYearly(dynamic);
			}
		};

		scheduleBtn.addEventListener('click', () => {
			setDraftMode('schedule');
			renderBuilder();
		});
		doneBtn.addEventListener('click', () => {
			setDraftMode('done');
			renderBuilder();
		});
		countBtn.addEventListener('click', () => {
			setDraftMode('count');
			draft.remainingCount = normalizeCount(draft.remainingCount);
			renderBuilder();
		});
		scheduleInput.addEventListener('change', () => {
			draft.referenceDate = extractDatePart(scheduleInput.value) || getReferenceDateSeed(options, draft.mode);
			draft.referenceDateTouched = true;
			renderBuilder();
		});
		const openReferenceDatePopover = (): void => {
			openDatePopover(scheduleInput, draft.referenceDate, false, value => {
				draft.referenceDate = value;
				draft.referenceDateTouched = true;
				renderBuilder();
			});
		};
		scheduleInput.addEventListener('focus', openReferenceDatePopover);
		scheduleInput.addEventListener('click', openReferenceDatePopover);
		freqSelect.addEventListener('change', () => {
			draft.freq = freqSelect.value as RepeatFrequency;
			if (draft.freq === 'week' && draft.days.size === 0) {
				draft.days.add(getWeekdayKey(draft.referenceDate));
			}
			renderBuilder();
		});
		intervalInput.addEventListener('change', () => {
			const value = Number(intervalInput.value);
			draft.interval = normalizeCount(value);
			renderBuilder();
		});
		remainingCountInput.addEventListener('change', () => {
			draft.remainingCount = normalizeCount(Number(remainingCountInput.value));
			renderBuilder();
		});

		setButtonState(scheduleBtn, draft.mode === 'schedule');
		setButtonState(doneBtn, draft.mode === 'done');
		setButtonState(countBtn, draft.mode === 'count');
		scheduleInput.value = draft.referenceDate;
		freqSelect.value = draft.freq;
		intervalInput.value = String(draft.interval);
		remainingCountInput.value = String(draft.remainingCount);
		countConfigRow.style.display = draft.mode === 'count' ? '' : 'none';
		if (infoEndInput) infoEndInput.value = getReadonlyEndDate(draft);
		if (infoCountInput) infoCountInput.value = getCountInfo(draft);
		const summaryText = formatRepeatRuleSummaryI18n(buildRuleFromDraft(draft));
		heroValue.textContent = summaryText;

		if (noEndBtn && endDateInput && endDateWrap) {
			setButtonState(noEndBtn, !draft.hasEndDate);
			endDateInput.value = draft.endDate;
			endDateInput.disabled = !draft.hasEndDate;
			endDateWrap.classList.toggle('is-disabled', !draft.hasEndDate);
			endDateWrap.parentElement?.classList.toggle('is-hidden', !draft.hasEndDate);
		}

		renderDynamic();
	}
}

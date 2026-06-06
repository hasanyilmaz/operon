import { Notice } from 'obsidian';
import { calculateNextRepeatDate, listRepeatOccurrencesInRange, parseRepeatRule } from '../../core/repeat-rule';
import { t } from '../../core/i18n';
import { createButton, createChip, createFloatingPanel } from './common';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';

interface RepeatSkipPickerSavePayload {
	skipDates: string[];
}

interface RepeatSkipPickerOptions {
	taskId: string;
	repeat: string;
	repeatSeriesId: string;
	repeatOccurrenceDate?: string;
	dateScheduled?: string;
	dateDue?: string;
	dateStarted?: string;
	datetimeStart?: string;
	datetimeEnd?: string;
	datetimeRepeatEnd?: string;
	taskColor?: string;
	existingSkipDates: string[];
	onSave: (payload: RepeatSkipPickerSavePayload) => Promise<void> | void;
	onCancel?: () => void;
	onClose?: () => void;
}

function extractDatePart(value: string | null | undefined): string {
	if (!value) return '';
	const trimmed = value.trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
	if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
	return '';
}

function parseDate(value: string): Date {
	const [year, month, day] = value.split('-').map(Number);
	return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function toDateString(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
}

function endOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth() + 1, 0, 12, 0, 0, 0);
}

function addMonths(date: Date, delta: number): Date {
	return new Date(date.getFullYear(), date.getMonth() + delta, 1, 12, 0, 0, 0);
}

function formatMonthTitle(date: Date): string {
	return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date);
}

function formatChipDate(value: string): string {
	return extractDatePart(value);
}

function getAnchorDate(options: RepeatSkipPickerOptions): string {
	return extractDatePart(options.repeatOccurrenceDate)
		|| extractDatePart(options.dateScheduled)
		|| extractDatePart(options.dateDue)
		|| extractDatePart(options.dateStarted)
		|| extractDatePart(options.datetimeStart)
		|| extractDatePart(options.datetimeEnd);
}

export function showRepeatSkipPicker(anchor: HTMLElement | DOMRect, options: RepeatSkipPickerOptions): () => void {
	let completed = false;
	const rule = parseRepeatRule(options.repeat);
	const anchorDate = getAnchorDate(options);
	const initialSkipDates = [...new Set(options.existingSkipDates.map(extractDatePart).filter(Boolean))].sort();
	const initialProjected = rule && anchorDate
		? calculateNextRepeatDate(rule, {
			anchorDate,
			repeatEnd: options.datetimeRepeatEnd,
			skipDates: initialSkipDates,
		})
		: '';
	let visibleMonth = startOfMonth(parseDate(initialProjected || anchorDate || new Date().toISOString().slice(0, 10)));
	const draftSkipDates = new Set(initialSkipDates);

	const { panel, close } = createFloatingPanel(anchor, 'operon-floating-panel operon-repeat-skip-picker-panel', () => {
		if (!completed) options.onCancel?.();
		options.onClose?.();
	});

	const commit = async () => {
		try {
			await options.onSave({
				skipDates: [...draftSkipDates].sort(),
			});
			completed = true;
			close();
		} catch (error) {
			console.error('Operon: failed to save repeat skip dates', error);
			new Notice(t('notifications', 'taskSaveFailed'));
		}
	};

	render();
	return close;

	function render(): void {
		panel.empty();
		panel.classList.add('operon-repeat-skip-picker-panel');
		const accent = options.taskColor?.trim()
			|| getComputedStyle(panel).getPropertyValue('--interactive-accent').trim()
			|| 'var(--interactive-accent)';
		panel.style.setProperty('--operon-repeat-skip-accent', accent);
		panel.createDiv({ cls: 'operon-floating-title', text: t('taskEditor', 'repeatSkipTitle') });

		if (!rule || !anchorDate || rule.mode === 'done') {
			panel.createDiv({
				cls: 'operon-repeat-skip-picker-empty',
				text: t('taskEditor', 'repeatSkipUnavailable'),
			});
			const actions = panel.createDiv('operon-floating-actions');
			const cancel = createButton(t('taskEditor', 'repeatSkipCancel'), 'operon-floating-btn is-secondary', actions);
			cancel.addEventListener('click', () => close());
			actions.appendChild(cancel);
			return;
		}

		const monthStart = startOfMonth(visibleMonth);
		const monthEnd = endOfMonth(visibleMonth);
		const rangeStart = toDateString(monthStart);
		const rangeEnd = toDateString(monthEnd);
		const futureCount = rule.mode === 'count' ? Math.max(0, (rule.count ?? 1) - 1) : undefined;
		const effectiveDates = listRepeatOccurrencesInRange(rule, {
			anchorDate,
			rangeStart,
			rangeEnd,
			repeatEnd: options.datetimeRepeatEnd,
			skipDates: draftSkipDates,
			maxCount: futureCount,
		});
		const effectiveSet = new Set(effectiveDates);
		const selectedInMonth = [...draftSkipDates]
			.filter(date => date > anchorDate && date >= rangeStart && date <= rangeEnd)
			.sort();
		const selectableSet = new Set([...effectiveDates, ...selectedInMonth]);

		const header = panel.createDiv('operon-repeat-skip-picker-header');
		const prev = createButton(t('taskEditor', 'repeatSkipMonthPrev'), 'operon-repeat-skip-picker-nav', header);
		prev.addEventListener('click', () => {
			visibleMonth = addMonths(visibleMonth, -1);
			render();
		});
		header.appendChild(prev);
		header.createDiv({ cls: 'operon-repeat-skip-picker-month', text: formatMonthTitle(visibleMonth) });
		const next = createButton(t('taskEditor', 'repeatSkipMonthNext'), 'operon-repeat-skip-picker-nav', header);
		next.addEventListener('click', () => {
			visibleMonth = addMonths(visibleMonth, 1);
			render();
		});
		header.appendChild(next);

		const grid = panel.createDiv('operon-repeat-skip-picker-grid');
		const firstWeekday = (monthStart.getDay() + 6) % 7;
		for (let filler = 0; filler < firstWeekday; filler++) {
			grid.createDiv('operon-repeat-skip-picker-day is-empty');
		}

		for (let day = 1; day <= monthEnd.getDate(); day++) {
			const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), day, 12, 0, 0, 0);
			const dateKey = toDateString(date);
			const isSkipped = draftSkipDates.has(dateKey);
			const isProjected = effectiveSet.has(dateKey);
			const isSelectable = selectableSet.has(dateKey) && dateKey > anchorDate;
			const button = createButton(String(day), 'operon-repeat-skip-picker-day', grid);
			bindOperonHoverTooltip(button, { content: dateKey, taskColor: options.taskColor ?? null });
			button.disabled = !isSelectable;
			button.classList.toggle('is-projected', isProjected && !isSkipped);
			button.classList.toggle('is-skipped', isSkipped);
			button.classList.toggle('is-inactive', !isSelectable);
			button.addEventListener('click', () => {
				if (!isSelectable) return;
				if (draftSkipDates.has(dateKey)) {
					draftSkipDates.delete(dateKey);
				} else {
					draftSkipDates.add(dateKey);
				}
				render();
			});
			grid.appendChild(button);
		}

		const selectedSection = panel.createDiv('operon-repeat-skip-picker-selected');
		selectedSection.createDiv({
			cls: 'operon-floating-subtitle',
			text: t('taskEditor', 'repeatSkipSelectedDates'),
		});
		const chips = selectedSection.createDiv('operon-repeat-skip-picker-chips');
		const selectedDates = [...draftSkipDates].filter(date => date > anchorDate).sort();
		if (!selectedDates.length) {
			chips.createSpan({
				cls: 'operon-repeat-skip-picker-empty',
				text: t('taskEditor', 'repeatSkipNone'),
			});
		} else {
			for (const date of selectedDates) {
				chips.appendChild(createChip(formatChipDate(date), 'operon-repeat-skip-picker-chip', chips));
			}
		}

		if (!effectiveDates.length && !selectedInMonth.length) {
			panel.createDiv({
				cls: 'operon-repeat-skip-picker-empty',
				text: t('taskEditor', 'repeatSkipNoProjectedDates'),
			});
		}

		const actions = panel.createDiv('operon-floating-actions');
		const reset = createButton(t('taskEditor', 'repeatSkipReset'), 'operon-floating-btn is-secondary operon-repeat-skip-picker-reset', actions);
		reset.addEventListener('click', () => {
			draftSkipDates.clear();
			render();
		});
		actions.appendChild(reset);

		const cancel = createButton(t('taskEditor', 'repeatSkipCancel'), 'operon-floating-btn is-secondary', actions);
		cancel.addEventListener('click', () => close());
		actions.appendChild(cancel);

		const save = createButton(t('taskEditor', 'repeatSkipSave'), 'operon-floating-btn', actions);
		save.addEventListener('click', () => { void commit(); });
		actions.appendChild(save);
	}
}

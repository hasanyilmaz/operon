import { App } from 'obsidian';
import { t } from '../../core/i18n';
import { getAppLocale } from '../../core/obsidian-app';
import { createButton, createFloatingPanel, focusFloatingInput, resolvePickerApp } from './common';
import { DayPickerWeekStart, normalizeOperonDateKey, OperonDayPickerController, renderOperonDayPicker } from './day-picker';
import { appendDatePickerCandidateRow } from './date-picker-row';
import {
	buildDatePickerCandidates,
	DateParseCandidate,
	DatePickerLang,
	getDatePickerLocaleStrings,
	mergeDatePickerVisibleCandidates,
	resolveDatePickerLanguage,
} from './date-nlp';

export interface ManualDatePickerOptions {
	weekStart: DayPickerWeekStart;
	showWeekNumbers: boolean;
}

interface DatePickerOptions {
	app?: App;
	fieldKey?: string;
	language?: DatePickerLang;
	value?: string;
	manualDatePicker?: ManualDatePickerOptions;
	retainInputFocus?: boolean;
	onSelect: (value: string) => void;
	onRemove?: () => void;
	canRemove?: boolean;
	onCancel?: () => void;
	onClose?: () => void;
}

export function showDatePicker(anchor: HTMLElement | DOMRect, options: DatePickerOptions): () => void {
	let completed = false;
	const app = resolvePickerApp(anchor, options.app);
	const language = resolveDatePickerLanguage(options.language);
	const strings = getDatePickerLocaleStrings(language);
	const context = {
		fieldKey: options.fieldKey ?? 'dateDue',
		language,
		referenceDate: new Date(),
	};
	const { panel, close } = createFloatingPanel(anchor, 'operon-floating-panel operon-date-picker-panel', () => {
		if (!completed) options.onCancel?.();
		options.onClose?.();
	}, {
		retainInputFocus: options.retainInputFocus,
		repositionOnPanelResize: options.manualDatePicker ? false : undefined,
	});

	panel.classList.add('operon-date-picker-panel');

	const input = panel.createEl('input');
	input.type = 'text';
	input.className = 'operon-floating-input operon-date-picker-query';
	input.placeholder = strings.searchPlaceholder;

	const results = panel.createDiv('operon-date-picker-results');

	const manualLabel = panel.createDiv('operon-floating-subtitle');
	manualLabel.textContent = strings.manualDate;

	let nativeInput: HTMLInputElement | null = null;
	let dayPicker: OperonDayPickerController | null = null;
	let manualDateValue = normalizeManualDateValue(options.value);
	let parsedCandidates: DateParseCandidate[] = [];
	let quickCandidates: DateParseCandidate[] = [];
	let visibleCandidates: DateParseCandidate[] = [];
	let activeIndex = 0;
	let useInitialQuickSuggestions = !!options.value?.trim();

	const commit = (value: string) => {
		if (!value) return;
		completed = true;
		options.onSelect(value);
		close();
	};

	const getActiveCandidate = (): DateParseCandidate | null => visibleCandidates[activeIndex] ?? null;

	const applyCurrentSelection = () => {
		if (options.manualDatePicker && manualDateValue) {
			commit(manualDateValue);
			return;
		}
		const active = getActiveCandidate();
		if (active) {
			commit(active.isoDate);
			return;
		}
		if (manualDateValue) {
			commit(manualDateValue);
			return;
		}
		if (options.onRemove && options.canRemove) {
			completed = true;
			options.onRemove();
			close();
		}
	};

	if (options.manualDatePicker) {
		panel.classList.add('has-day-picker');
		const dayPickerHost = panel.createDiv('operon-date-picker-day-picker-host');
		dayPicker = renderOperonDayPicker(dayPickerHost, {
			value: options.value,
			weekStart: options.manualDatePicker.weekStart,
			showWeekNumbers: options.manualDatePicker.showWeekNumbers,
			locale: getAppLocale(app),
			clearLabel: strings.clear,
			todayLabel: strings.today,
			previousYearLabel: t('calendar', 'previousYear'),
			nextYearLabel: t('calendar', 'nextYear'),
			previousMonthLabel: t('calendar', 'previousMonth'),
			nextMonthLabel: t('calendar', 'nextMonth'),
			canClear: options.canRemove,
			onSelect: value => commit(value),
			onClear: options.onRemove
				? () => {
					completed = true;
					options.onRemove?.();
					close();
				}
				: undefined,
		});
	} else {
		nativeInput = panel.createEl('input');
		nativeInput.type = 'date';
		nativeInput.className = 'operon-floating-input operon-date-picker-native';
		nativeInput.value = options.value ?? '';
	}

	if (!options.manualDatePicker) {
		const actions = panel.createDiv('operon-floating-actions');

		if (options.onRemove && options.canRemove) {
			const removeButton = createButton(t('buttons', 'remove'), 'operon-floating-btn is-secondary', actions);
			removeButton.addEventListener('click', () => {
				completed = true;
				options.onRemove?.();
				close();
			});
			actions.appendChild(removeButton);
		}

		const applyButton = createButton(strings.apply, 'operon-floating-btn', actions);
		applyButton.addEventListener('click', applyCurrentSelection);
		actions.appendChild(applyButton);
		panel.appendChild(actions);
	}

	const render = () => {
		results.replaceChildren();
		const hiddenCalendarDate = options.manualDatePicker ? manualDateValue : '';
		visibleCandidates = mergeDatePickerVisibleCandidates(parsedCandidates, quickCandidates, hiddenCalendarDate);

		if (visibleCandidates.length === 0) {
			if (hiddenCalendarDate) return;
			const empty = results.createDiv('operon-date-picker-empty');
			empty.textContent = strings.quickSuggestions;
			return;
		}

		activeIndex = Math.max(0, Math.min(activeIndex, visibleCandidates.length - 1));
		for (const [index, candidate] of visibleCandidates.entries()) {
			const button = results.createEl('button');
			button.type = 'button';
			button.className = 'operon-field-menu-item operon-date-picker-item';
			if (index === activeIndex) button.classList.add('is-active');
			appendDatePickerCandidateRow(button, candidate, language);

			button.addEventListener('mousemove', () => {
				if (activeIndex === index) return;
				activeIndex = index;
				render();
			});
			button.addEventListener('mousedown', event => {
				event.preventDefault();
				activeIndex = index;
				commit(candidate.isoDate);
			});
			results.appendChild(button);
		}
	};

	const refreshCandidates = () => {
		const built = buildDatePickerCandidates(app, input.value, context, {
			quickQuery: useInitialQuickSuggestions ? '' : input.value,
		});
		parsedCandidates = built.parsed;
		quickCandidates = built.quick;
		activeIndex = 0;
		useInitialQuickSuggestions = false;
		render();
	};

	input.addEventListener('input', () => {
		manualDateValue = normalizeManualDateValue(input.value);
		if (manualDateValue) {
			if (nativeInput) nativeInput.value = manualDateValue;
			dayPicker?.setFocusedDate(manualDateValue);
		}
		refreshCandidates();
	});

	input.addEventListener('keydown', event => {
		if (event.key === 'ArrowDown') {
			if (visibleCandidates.length === 0) return;
			event.preventDefault();
			activeIndex = Math.min(activeIndex + 1, visibleCandidates.length - 1);
			render();
			return;
		}
		if (event.key === 'ArrowUp') {
			if (visibleCandidates.length === 0) return;
			event.preventDefault();
			activeIndex = Math.max(activeIndex - 1, 0);
			render();
			return;
		}
		if (event.key === 'Enter') {
			if (options.manualDatePicker && manualDateValue) {
				event.preventDefault();
				commit(manualDateValue);
				return;
			}
			const active = getActiveCandidate();
			if (!active && !manualDateValue) return;
			event.preventDefault();
			commit(active?.isoDate ?? manualDateValue);
		}
	});

	nativeInput?.addEventListener('change', () => {
		if (!nativeInput?.value) return;
		manualDateValue = normalizeManualDateValue(nativeInput.value);
		input.value = nativeInput.value;
		refreshCandidates();
	});

	if (options.value) {
		input.value = options.value;
		manualDateValue = normalizeManualDateValue(options.value);
	}
	refreshCandidates();

	window.requestAnimationFrame(() => {
		focusFloatingInput(input);
		input.select();
	});

	return close;
}

function normalizeManualDateValue(value: string | null | undefined): string {
	return normalizeOperonDateKey(value) ?? '';
}

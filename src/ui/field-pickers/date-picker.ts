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

interface DatePickerClassNames {
	useBaseClasses?: boolean;
	panel?: string;
	query?: string;
	results?: string;
	dayPickerHost?: string;
	native?: string;
	item?: string;
	itemLabel?: string;
	itemDate?: string;
	itemWeekday?: string;
	empty?: string;
	actions?: string;
	removeButton?: string;
	applyButton?: string;
}

interface DatePickerOptions {
	app?: App;
	fieldKey?: string;
	language?: DatePickerLang;
	value?: string;
	manualDatePicker?: ManualDatePickerOptions;
	retainInputFocus?: boolean;
	classNames?: DatePickerClassNames;
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
	const useBaseClasses = options.classNames?.useBaseClasses !== false;
	const { panel, close } = createFloatingPanel(anchor, joinDatePickerClasses('operon-floating-panel', baseDatePickerClass('operon-date-picker-panel', useBaseClasses), options.classNames?.panel), () => {
		if (!completed) options.onCancel?.();
		options.onClose?.();
	}, {
		retainInputFocus: options.retainInputFocus,
		repositionOnPanelResize: options.manualDatePicker ? false : undefined,
	});

	if (useBaseClasses) panel.classList.add('operon-date-picker-panel');

	const input = panel.createEl('input');
	input.type = 'text';
	input.className = joinDatePickerClasses('operon-floating-input', baseDatePickerClass('operon-date-picker-query', useBaseClasses), options.classNames?.query);
	input.placeholder = strings.searchPlaceholder;

	const results = panel.createDiv(joinDatePickerClasses(baseDatePickerClass('operon-date-picker-results', useBaseClasses), options.classNames?.results));

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
		const dayPickerHost = panel.createDiv(joinDatePickerClasses(baseDatePickerClass('operon-date-picker-day-picker-host', useBaseClasses), options.classNames?.dayPickerHost));
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
		nativeInput.className = joinDatePickerClasses('operon-floating-input', baseDatePickerClass('operon-date-picker-native', useBaseClasses), options.classNames?.native);
		nativeInput.value = options.value ?? '';
	}

	if (!options.manualDatePicker) {
		const actions = panel.createDiv(joinDatePickerClasses('operon-floating-actions', options.classNames?.actions));

		if (options.onRemove && options.canRemove) {
			const removeButton = createButton(t('buttons', 'remove'), joinDatePickerClasses('operon-floating-btn is-secondary', options.classNames?.removeButton), actions);
			removeButton.addEventListener('click', () => {
				completed = true;
				options.onRemove?.();
				close();
			});
			actions.appendChild(removeButton);
		}

		const applyButton = createButton(strings.apply, joinDatePickerClasses('operon-floating-btn', options.classNames?.applyButton), actions);
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
			const empty = results.createDiv(joinDatePickerClasses(baseDatePickerClass('operon-date-picker-empty', useBaseClasses), options.classNames?.empty));
			empty.textContent = strings.quickSuggestions;
			return;
		}

		activeIndex = Math.max(0, Math.min(activeIndex, visibleCandidates.length - 1));
		for (const [index, candidate] of visibleCandidates.entries()) {
			const button = results.createEl('button');
			button.type = 'button';
			button.className = joinDatePickerClasses('operon-field-menu-item', baseDatePickerClass('operon-date-picker-item', useBaseClasses), options.classNames?.item);
			if (index === activeIndex) button.classList.add('is-active');
			appendDatePickerCandidateRow(button, candidate, language, {
				label: useBaseClasses ? undefined : options.classNames?.itemLabel,
				date: useBaseClasses ? undefined : options.classNames?.itemDate,
				weekday: useBaseClasses ? undefined : options.classNames?.itemWeekday,
			});

			button.addEventListener('mousemove', () => {
				if (activeIndex === index) return;
				const previousButton = results.children[activeIndex] as HTMLElement | undefined;
				activeIndex = index;
				previousButton?.classList.remove('is-active');
				button.classList.add('is-active');
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

function baseDatePickerClass(className: string, useBaseClasses: boolean): string {
	return useBaseClasses ? className : '';
}

function joinDatePickerClasses(...classes: Array<string | undefined>): string {
	return classes
		.flatMap(value => value?.split(/\s+/u) ?? [])
		.map(value => value.trim())
		.filter(Boolean)
		.join(' ');
}

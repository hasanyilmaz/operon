import { App } from 'obsidian';
import { t } from '../../core/i18n';
import { localToday } from '../../core/local-time';
import { getAppLocale } from '../../core/obsidian-app';
import { OperonSettings } from '../../types/settings';
import { createButton, createFloatingPanel, focusFloatingInput, resolvePickerApp, scrollChildIntoView } from './common';
import { appendDatePickerCandidateRow } from './date-picker-row';
import { normalizeOperonDateKey, OperonDayPickerController, renderOperonDayPicker } from './day-picker';
import {
	buildDatePickerCandidates,
	DateParseCandidate,
	DatePickerLang,
	getDatePickerLocaleStrings,
	mergeDatePickerVisibleCandidates,
	resolveDatePickerLanguage,
} from './date-nlp';
import {
	buildCanonicalDatetime,
	getNextQuarterHourSlotIndex,
	getQuarterHourSlots,
	getSlotIndexForCanonicalTime,
	getTimeDigitsFromCanonicalTime,
	getWrappedSlotIndex,
	matchQuarterHourSlots,
	parseStoredDatetimeValue,
	QuarterHourSlot,
	remapSlotIndexForMeridiem,
	resolveMeridiem,
	tryResolveSlotIndexFromDigits,
} from './datetime-time-grid';

export interface DatetimePickerClassNames {
	useBaseClasses?: boolean;
	panel?: string;
	topRow?: string;
	query?: string;
	topTime?: string;
	timeInput?: string;
	controlsRow?: string;
	dateSection?: string;
	dateLabel?: string;
	dayPickerHost?: string;
	meridiem?: string;
	meridiemButton?: string;
	dateResults?: string;
	dateItem?: string;
	dateItemLabel?: string;
	dateItemDate?: string;
	dateItemWeekday?: string;
	empty?: string;
	timeResults?: string;
	timeItem?: string;
	timeNotice?: string;
	actions?: string;
	clearButton?: string;
	todayButton?: string;
}

export interface DatetimePickerOptions {
	app?: App;
	settings: Pick<OperonSettings, 'timeFormat' | 'calendarWeekStart' | 'calendarSidebarShowWeekNumbers'>;
	fieldKey?: string;
	language?: DatePickerLang;
	value?: string;
	retainInputFocus?: boolean;
	classNames?: DatetimePickerClassNames;
	onSelect: (value: string) => DatetimePickerActionResult;
	onRemove?: () => DatetimePickerActionResult;
	canRemove?: boolean;
	onCancel?: () => void;
	onClose?: () => void;
}

export type DatetimePickerActionResult = void | {
	status: 'rejected';
	message: string;
};

export interface DatetimePickerContentOptions {
	app?: App;
	settings: Pick<OperonSettings, 'timeFormat' | 'calendarWeekStart' | 'calendarSidebarShowWeekNumbers'>;
	fieldKey?: string;
	language?: DatePickerLang;
	value?: string;
	classNames?: Omit<DatetimePickerClassNames, 'panel'>;
	onSelect: (value: string) => void;
	onRemove?: () => void;
	canRemove?: boolean;
}

export interface DatetimePickerContentController {
	requestFocus: () => void;
	destroy: () => void;
}

const EDITABLE_CARET_POSITIONS = [0, 1, 3, 4];

export function showDatetimePicker(anchor: HTMLElement | DOMRect, options: DatetimePickerOptions): () => void {
	let completed = false;
	let contentController: DatetimePickerContentController | null = null;
	let diagnostic: HTMLElement | null = null;
	const useBaseClasses = options.classNames?.useBaseClasses !== false;
	const { panel, close } = createFloatingPanel(
		anchor,
		joinDatetimePickerClasses(
			'operon-floating-panel',
			baseDatetimePickerClass('operon-datetime-picker-panel', useBaseClasses),
			options.classNames?.panel,
		),
		() => {
			contentController?.destroy();
			if (!completed) options.onCancel?.();
			options.onClose?.();
		},
		{
			retainInputFocus: options.retainInputFocus,
		},
	);

	contentController = renderDatetimePickerContent(panel, {
		app: options.app,
		settings: options.settings,
		fieldKey: options.fieldKey,
		language: options.language,
		value: options.value,
		classNames: options.classNames,
		onSelect: value => {
			completed = true;
			const result = options.onSelect(value);
			if (isDatetimePickerRejection(result)) {
				completed = false;
				setDatetimePickerDiagnostic(diagnostic, result.message);
				return;
			}
			close();
		},
		onRemove: options.onRemove
			? () => {
				completed = true;
				const result = options.onRemove?.();
				if (isDatetimePickerRejection(result)) {
					completed = false;
					setDatetimePickerDiagnostic(diagnostic, result.message);
					return;
				}
				close();
			}
			: undefined,
		canRemove: options.canRemove,
	});
	diagnostic = panel.createDiv('operon-datetime-picker-diagnostic');
	diagnostic.setAttribute('role', 'status');
	diagnostic.setAttribute('aria-live', 'polite');

	const focusContent = contentController.requestFocus;
	const ownerWindow = panel.ownerDocument.defaultView;
	if (ownerWindow) ownerWindow.requestAnimationFrame(focusContent);
	else window.requestAnimationFrame(focusContent);

	return close;
}

function isDatetimePickerRejection(result: DatetimePickerActionResult): result is Exclude<DatetimePickerActionResult, void> {
	return !!result && result.status === 'rejected';
}

function setDatetimePickerDiagnostic(element: HTMLElement | null, message: string): void {
	if (!element) return;
	element.textContent = message;
}

/** Renders into and owns the container children; selection and removal do not close an outer surface. */
export function renderDatetimePickerContent(
	container: HTMLElement,
	options: DatetimePickerContentOptions,
): DatetimePickerContentController {
	container.replaceChildren();
	const app = resolvePickerApp(container, options.app);
	const language = resolveDatePickerLanguage(options.language);
	const strings = getDatePickerLocaleStrings(language);
	const slots = getQuarterHourSlots();
	const initial = parseStoredDatetimeValue(options.value);
	const timeFormat = options.settings.timeFormat;
	const context = {
		fieldKey: options.fieldKey ?? 'datetimeStart',
		language,
		referenceDate: new Date(),
	};
	const useBaseClasses = options.classNames?.useBaseClasses !== false;
	const timeItemSelectorClass = useBaseClasses
		? 'operon-datetime-picker-time-item'
		: firstDatetimePickerClass(options.classNames?.timeItem) ?? 'operon-datetime-picker-time-item';
	const addedBasePanelClass = useBaseClasses && !container.classList.contains('operon-datetime-picker-panel');

	if (addedBasePanelClass) container.classList.add('operon-datetime-picker-panel');

	const topRow = container.createDiv(joinDatetimePickerClasses(baseDatetimePickerClass('operon-datetime-picker-top-row', useBaseClasses), options.classNames?.topRow));

	const input = topRow.createEl('input');
	input.type = 'text';
	input.className = joinDatetimePickerClasses('operon-floating-input', baseDatetimePickerClass('operon-date-picker-query operon-datetime-picker-query', useBaseClasses), options.classNames?.query);
	input.placeholder = strings.searchPlaceholder;

	const topTimeWrap = topRow.createDiv(joinDatetimePickerClasses(baseDatetimePickerClass('operon-datetime-picker-top-time', useBaseClasses), options.classNames?.topTime));

	const timeInput = topTimeWrap.createEl('input');
	timeInput.type = 'text';
	timeInput.className = joinDatetimePickerClasses('operon-floating-input', baseDatetimePickerClass('operon-datetime-picker-time-input', useBaseClasses), options.classNames?.timeInput);
	timeInput.placeholder = t('taskEditor', 'datetimeTimePlaceholder');

	const results = container.createDiv(joinDatetimePickerClasses(baseDatetimePickerClass('operon-date-picker-results', useBaseClasses), options.classNames?.dateResults));

	const controlsRow = container.createDiv(joinDatetimePickerClasses(baseDatetimePickerClass('operon-datetime-picker-controls-row', useBaseClasses), options.classNames?.controlsRow));

	const dateSection = controlsRow.createDiv(joinDatetimePickerClasses(baseDatetimePickerClass('operon-datetime-picker-control-section', useBaseClasses), options.classNames?.dateSection));

	const dateLabel = dateSection.createDiv(joinDatetimePickerClasses('operon-floating-subtitle', baseDatetimePickerClass('operon-datetime-picker-control-label', useBaseClasses), options.classNames?.dateLabel));
	dateLabel.textContent = strings.manualDate;

	const dayPickerHost = dateSection.createDiv(joinDatetimePickerClasses(baseDatetimePickerClass('operon-datetime-picker-day-picker-host', useBaseClasses), options.classNames?.dayPickerHost));

	let meridiemButtons: { am: HTMLButtonElement; pm: HTMLButtonElement } | null = null;
	if (timeFormat === '12h') {
		const meridiemToggle = topTimeWrap.createDiv(joinDatetimePickerClasses(baseDatetimePickerClass('operon-datetime-picker-meridiem', useBaseClasses), options.classNames?.meridiem));
		meridiemButtons = {
			am: createButton(t('taskEditor', 'datetimeAm'), joinDatetimePickerClasses(baseDatetimePickerClass('operon-datetime-picker-meridiem-btn', useBaseClasses), options.classNames?.meridiemButton), meridiemToggle),
			pm: createButton(t('taskEditor', 'datetimePm'), joinDatetimePickerClasses(baseDatetimePickerClass('operon-datetime-picker-meridiem-btn', useBaseClasses), options.classNames?.meridiemButton), meridiemToggle),
		};
		meridiemToggle.appendChild(meridiemButtons.am);
		meridiemToggle.appendChild(meridiemButtons.pm);
	}

	const timeResults = topTimeWrap.createDiv(joinDatetimePickerClasses(baseDatetimePickerClass('operon-datetime-picker-time-results', useBaseClasses), options.classNames?.timeResults));

	const timeNotice = topTimeWrap.createDiv(joinDatetimePickerClasses(baseDatetimePickerClass('operon-datetime-picker-time-notice', useBaseClasses), options.classNames?.timeNotice));

	const actions = container.createDiv(joinDatetimePickerClasses(baseDatetimePickerClass('operon-day-picker-footer operon-datetime-picker-actions', useBaseClasses), options.classNames?.actions));

	const clearButton = createButton(strings.clear, joinDatetimePickerClasses(baseDatetimePickerClass('operon-day-picker-footer-button', useBaseClasses), options.classNames?.clearButton, 'is-clear'), actions);
	clearButton.disabled = !options.onRemove || !options.canRemove;
	clearButton.addEventListener('click', () => {
		if (clearButton.disabled) return;
		options.onRemove?.();
	});
	actions.appendChild(clearButton);

	const todayButton = createButton(strings.today, joinDatetimePickerClasses(baseDatetimePickerClass('operon-day-picker-footer-button', useBaseClasses), options.classNames?.todayButton, 'is-today'), actions);
	todayButton.addEventListener('click', () => {
		dayPickerController?.setFocusedDate(localToday());
	});
	actions.appendChild(todayButton);
	container.appendChild(actions);

	let parsedCandidates: DateParseCandidate[] = [];
	let quickCandidates: DateParseCandidate[] = [];
	let visibleCandidates: DateParseCandidate[] = [];
	let activeDateIndex = 0;
	let selectedDate = initial.datePart;
	let currentMeridiem: 'am' | 'pm' = initial.timePart ? initial.meridiem : 'am';
	let timeBuffer = (initial.timePart
		? getTimeDigitsFromCanonicalTime(initial.timePart, timeFormat, currentMeridiem)
		: '').padEnd(4, '_').slice(0, 4);
	let activeTimeIndex: number | null = initial.slotIndex ?? getNextQuarterHourSlotIndex();
	let visibleTimeIndices: number[] = [];
	let hasTouchedTime = false;
	let timeInputFocused = false;
	let timeDropdownVisible = false;
	let preserveOffGridCommit = !!initial.timePart;
	let useInitialDateQuickSuggestions = !!initial.datePart;
	let dayPickerController: OperonDayPickerController | null = null;

	const commit = (value: string) => {
		if (!value) return;
		options.onSelect(value);
	};

	const getActiveDateCandidate = (): DateParseCandidate | null => visibleCandidates[activeDateIndex] ?? null;

	const formatTimeLabel = (slot: QuarterHourSlot): string => {
		const baseDate = new Date(2026, 0, 1, slot.hour24, slot.minute, 0, 0);
		return new Intl.DateTimeFormat(getAppLocale(app), {
			hour: 'numeric',
			minute: '2-digit',
			hour12: timeFormat === '12h',
		}).format(baseDate);
	};

	const getMatchingDigits = (bufferValue = timeBuffer, lastBufferIndex = bufferValue.length - 1): string => {
		let digits = '';
		for (let index = 0; index <= Math.min(lastBufferIndex, bufferValue.length - 1); index += 1) {
			const char = bufferValue[index];
			if (!/\d/.test(char)) break;
			digits += char;
		}
		return digits;
	};

	const formatTimeBufferValue = (): string => `${timeBuffer[0] ?? '_'}${timeBuffer[1] ?? '_'}:${timeBuffer[2] ?? '_'}${timeBuffer[3] ?? '_'}`;

	const getCommitValue = (): string => {
		if (!selectedDate) return '';
		const specialEndOfDay = getSpecialEndOfDayCommitValue();
		if (specialEndOfDay) {
			return specialEndOfDay;
		}
		if (!hasTouchedTime && initial.timePart) {
			return buildCanonicalDatetime(selectedDate, initial.timePart);
		}
		if (activeTimeIndex === null || visibleTimeIndices.length === 0) return '';
		return buildCanonicalDatetime(selectedDate, slots[activeTimeIndex].canonical);
	};

	const getSpecialEndOfDayCommitValue = (): string => {
		if (options.fieldKey !== 'datetimeEnd' || timeFormat !== '24h' || !selectedDate) return '';
		const digits = getMatchingDigits();
		if (digits !== '2400' && digits !== '0000') return '';
		return buildCanonicalDatetime(selectedDate, '24:00');
	};

	const scrollActiveTimeIntoView = () => {
		const active = timeResults.querySelector<HTMLElement>(`.${timeItemSelectorClass}.is-active`);
		scrollChildIntoView(timeResults, active);
	};

	function getTypedCanonicalDate(): string {
		return normalizeOperonDateKey(input.value) ?? '';
	}

	const syncTimeInputValue = () => {
		timeInput.value = formatTimeBufferValue();
	};

	const setTimeCaret = (requested: number) => {
		const position = EDITABLE_CARET_POSITIONS.includes(requested)
			? requested
			: EDITABLE_CARET_POSITIONS.find(pos => pos >= requested) ?? EDITABLE_CARET_POSITIONS[EDITABLE_CARET_POSITIONS.length - 1];
		window.setTimeout(() => timeInput.setSelectionRange(position, position), 0);
	};

	const getEditableIndexFromCaret = (caret: number): number => {
		if (caret <= 0) return 0;
		if (caret === 1) return 1;
		if (caret <= 3) return 2;
		return 3;
	};

	const renderTimeResults = () => {
		refreshMeridiemUi();
		timeResults.classList.toggle('is-open', timeDropdownVisible);
		timeNotice.classList.toggle('is-open', timeDropdownVisible && !!timeNotice.textContent);
		timeResults.replaceChildren();
		if (visibleTimeIndices.length === 0) {
			const empty = timeResults.createDiv(joinDatetimePickerClasses(baseDatetimePickerClass('operon-date-picker-empty', useBaseClasses), options.classNames?.empty));
			empty.textContent = t('taskEditor', 'datetimeNoMatchingTimes');
			const specialEndOfDay = getSpecialEndOfDayCommitValue();
			timeNotice.textContent = specialEndOfDay
				? '00:00 or 24:00 will be saved as next-day midnight for the end time.'
				: preserveOffGridCommit && !hasTouchedTime && initial.isOffGrid
					? t('taskEditor', 'datetimeOffGridTimeNotice')
					: '';
			return;
		}

		for (const index of visibleTimeIndices) {
			const slot = slots[index];
			const button = timeResults.createEl('button');
			button.type = 'button';
			button.className = joinDatetimePickerClasses('operon-field-menu-item', baseDatetimePickerClass('operon-datetime-picker-time-item', useBaseClasses), options.classNames?.timeItem);
			if (index === activeTimeIndex) button.classList.add('is-active');
			button.textContent = formatTimeLabel(slot);
			button.addEventListener('mousemove', () => {
				if (activeTimeIndex === index) return;
				const previousVisualIndex = activeTimeIndex === null ? -1 : visibleTimeIndices.indexOf(activeTimeIndex);
				const previousButton = previousVisualIndex >= 0
					? results.children[previousVisualIndex] as HTMLElement | undefined
					: undefined;
				activeTimeIndex = index;
				currentMeridiem = resolveMeridiem(slot.hour24);
				previousButton?.classList.remove('is-active');
				button.classList.add('is-active');
				refreshMeridiemUi();
			});
		button.addEventListener('mousedown', event => {
			event.preventDefault();
			activeTimeIndex = index;
			currentMeridiem = resolveMeridiem(slot.hour24);
			hasTouchedTime = true;
				preserveOffGridCommit = false;
				timeBuffer = getTimeDigitsFromCanonicalTime(slot.canonical, timeFormat, currentMeridiem).padEnd(4, '_').slice(0, 4);
				syncTimeInputValue();
				refreshTimeMatches();
				commit(getCommitValue());
			});
			timeResults.appendChild(button);
		}
		const specialEndOfDay = getSpecialEndOfDayCommitValue();
		timeNotice.textContent = specialEndOfDay
			? '00:00 or 24:00 will be saved as next-day midnight for the end time.'
			: preserveOffGridCommit && !hasTouchedTime && initial.isOffGrid
				? t('taskEditor', 'datetimeOffGridTimeNotice')
				: '';
		scrollActiveTimeIntoView();
	};

	const refreshDateCandidates = () => {
		const built = buildDatePickerCandidates(app, input.value, context, {
			quickQuery: useInitialDateQuickSuggestions ? '' : input.value,
		});
		parsedCandidates = built.parsed;
		quickCandidates = built.quick;
		activeDateIndex = 0;
		useInitialDateQuickSuggestions = false;
		renderDateResults();
	};

	const renderDateResults = () => {
		results.replaceChildren();
		const hiddenCalendarDate = getTypedCanonicalDate();
		visibleCandidates = mergeDatePickerVisibleCandidates(parsedCandidates, quickCandidates, hiddenCalendarDate);

		if (visibleCandidates.length === 0) {
			if (hiddenCalendarDate) return;
			const empty = results.createDiv(joinDatetimePickerClasses(baseDatetimePickerClass('operon-date-picker-empty', useBaseClasses), options.classNames?.empty));
			empty.textContent = strings.quickSuggestions;
			return;
		}

		activeDateIndex = Math.max(0, Math.min(activeDateIndex, visibleCandidates.length - 1));
		for (const [index, candidate] of visibleCandidates.entries()) {
			const button = results.createEl('button');
			button.type = 'button';
			button.className = joinDatetimePickerClasses('operon-field-menu-item', baseDatetimePickerClass('operon-date-picker-item', useBaseClasses), options.classNames?.dateItem);
			if (index === activeDateIndex) button.classList.add('is-active');
			appendDatePickerCandidateRow(button, candidate, language, {
				label: useBaseClasses ? undefined : options.classNames?.dateItemLabel,
				date: useBaseClasses ? undefined : options.classNames?.dateItemDate,
				weekday: useBaseClasses ? undefined : options.classNames?.dateItemWeekday,
			});

			button.addEventListener('mousemove', () => {
				if (activeDateIndex === index) return;
				const previousButton = results.children[activeDateIndex] as HTMLElement | undefined;
				activeDateIndex = index;
				previousButton?.classList.remove('is-active');
				button.classList.add('is-active');
			});
			button.addEventListener('mousedown', event => {
				event.preventDefault();
				activeDateIndex = index;
				applySelectedDate(candidate.isoDate);
			});
			results.appendChild(button);
		}
	};

	const refreshTimeMatches = () => {
		const match = matchQuarterHourSlots({
			digits: getMatchingDigits(),
			anchorIndex: activeTimeIndex ?? getNextQuarterHourSlotIndex(),
			timeFormat,
			meridiem: currentMeridiem,
		});
		activeTimeIndex = match.activeIndex;
		visibleTimeIndices = match.visibleIndices;
		renderTimeResults();
	};

	const focusTimeInput = () => {
		timeInputFocused = true;
		timeDropdownVisible = true;
		focusFloatingInput(timeInput);
		setTimeCaret(0);
		refreshTimeMatches();
	};

	const applySelectedDate = (dateValue: string) => {
		selectedDate = dateValue;
		input.value = dateValue;
		dayPickerController?.setSelectedDate(dateValue);
		dayPickerController?.setFocusedDate(dateValue);
		focusTimeInput();
	};

	const renderManualDayPicker = () => {
		dayPickerHost.replaceChildren();
		dayPickerController = renderOperonDayPicker(dayPickerHost, {
			value: selectedDate,
			weekStart: options.settings.calendarWeekStart,
			showWeekNumbers: options.settings.calendarSidebarShowWeekNumbers,
			locale: getAppLocale(app),
			clearLabel: strings.clear,
			todayLabel: strings.today,
			previousYearLabel: t('calendar', 'previousYear'),
			nextYearLabel: t('calendar', 'nextYear'),
			previousMonthLabel: t('calendar', 'previousMonth'),
			nextMonthLabel: t('calendar', 'nextMonth'),
			canClear: false,
			showClear: false,
			showToday: false,
			onSelect: dateValue => {
				applySelectedDate(dateValue);
			},
		});
	};

	const moveActiveTime = (delta: number) => {
		activeTimeIndex = getWrappedSlotIndex((activeTimeIndex ?? getNextQuarterHourSlotIndex()) + delta);
		currentMeridiem = resolveMeridiem(slots[activeTimeIndex].hour24);
		hasTouchedTime = true;
		preserveOffGridCommit = false;
		timeBuffer = getTimeDigitsFromCanonicalTime(slots[activeTimeIndex].canonical, timeFormat, currentMeridiem).padEnd(4, '_').slice(0, 4);
		syncTimeInputValue();
		refreshTimeMatches();
	};

	const updateTimeFromDigitInput = (nextBuffer: string, caretPosition: number) => {
		timeBuffer = nextBuffer
			.replace(/[^\d_]/g, '')
			.padEnd(4, '_')
			.slice(0, 4);
		hasTouchedTime = true;
		preserveOffGridCommit = false;
		syncTimeInputValue();
		const exactIndex = tryResolveSlotIndexFromDigits(getMatchingDigits(), timeFormat, currentMeridiem);
		if (exactIndex !== null) activeTimeIndex = exactIndex;
		refreshTimeMatches();
		setTimeCaret(caretPosition);
	};

	const acceptTimeDigit = (digit: string, editableIndex: number): void => {
		if (!/^\d$/.test(digit)) return;
		if (editableIndex > 0 && timeBuffer.slice(0, editableIndex).split('').some(char => !/\d/.test(char))) {
			return;
		}

		const digits = timeBuffer.split('');
		digits[editableIndex] = digit;

		const prefixDigits = getMatchingDigits(digits.join(''), editableIndex);
		const prefixMatch = prefixDigits
			? matchQuarterHourSlots({
				digits: prefixDigits,
				anchorIndex: activeTimeIndex ?? getNextQuarterHourSlotIndex(),
				timeFormat,
				meridiem: currentMeridiem,
			})
			: null;
		if (prefixDigits && (!prefixMatch || prefixMatch.visibleIndices.length === 0)) {
			return;
		}

		let nextBuffer = digits.join('');
		const fullDigits = getMatchingDigits(nextBuffer);
		if (fullDigits) {
			const fullMatch = matchQuarterHourSlots({
				digits: fullDigits,
				anchorIndex: activeTimeIndex ?? getNextQuarterHourSlotIndex(),
				timeFormat,
				meridiem: currentMeridiem,
			});
			if (fullMatch.visibleIndices.length === 0 && editableIndex < digits.length - 1) {
				for (let index = editableIndex + 1; index < digits.length; index += 1) {
					digits[index] = '_';
				}
				nextBuffer = digits.join('');
			}
		}

		const nextEditable = Math.min(3, editableIndex + 1);
		updateTimeFromDigitInput(nextBuffer, EDITABLE_CARET_POSITIONS[nextEditable]);
	};

	input.addEventListener('input', () => {
		const typedDate = getTypedCanonicalDate();
		if (typedDate) {
			dayPickerController?.setFocusedDate(typedDate);
		}
		refreshDateCandidates();
	});

	input.addEventListener('keydown', event => {
		if (event.key === 'ArrowDown') {
			if (visibleCandidates.length === 0) return;
			event.preventDefault();
			activeDateIndex = Math.min(activeDateIndex + 1, visibleCandidates.length - 1);
			renderDateResults();
			return;
		}
		if (event.key === 'ArrowUp') {
			if (visibleCandidates.length === 0) return;
			event.preventDefault();
			activeDateIndex = Math.max(activeDateIndex - 1, 0);
			renderDateResults();
			return;
		}
		if (event.key === 'Enter') {
			const typedDate = getTypedCanonicalDate();
			if (typedDate) {
				event.preventDefault();
				applySelectedDate(typedDate);
				return;
			}
			const active = getActiveDateCandidate();
			if (!active) return;
			event.preventDefault();
			applySelectedDate(active.isoDate);
		}
	});

	timeInput.addEventListener('focus', () => {
		timeInputFocused = true;
		timeDropdownVisible = true;
		refreshTimeMatches();
	});

	timeInput.addEventListener('blur', () => {
		timeInputFocused = false;
	});

	timeInput.addEventListener('mousedown', () => {
		if (!timeInputFocused) {
			window.setTimeout(() => {
				refreshTimeMatches();
			}, 0);
		}
	});

	timeInput.addEventListener('keydown', event => {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			moveActiveTime(1);
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			moveActiveTime(-1);
			return;
		}
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			const current = timeInput.selectionStart ?? 0;
			const editableIndex = getEditableIndexFromCaret(current);
			const nextEditable = event.key === 'ArrowLeft'
				? Math.max(0, editableIndex - 1)
				: Math.min(3, editableIndex + 1);
			setTimeCaret(EDITABLE_CARET_POSITIONS[nextEditable]);
			return;
		}
		if (event.key === 'Backspace' || event.key === 'Delete') {
			event.preventDefault();
			const current = timeInput.selectionStart ?? 0;
			const editableIndex = getEditableIndexFromCaret(current);
			const removeIndex = event.key === 'Backspace'
				? Math.max(0, editableIndex - (current === 0 ? 0 : 1))
				: editableIndex;
			const digits = timeBuffer.split('');
			digits[removeIndex] = '_';
			updateTimeFromDigitInput(digits.join(''), EDITABLE_CARET_POSITIONS[Math.max(0, removeIndex)]);
			return;
		}
		if (/^\d$/.test(event.key)) {
			event.preventDefault();
			const current = timeInput.selectionStart ?? 0;
			const editableIndex = getEditableIndexFromCaret(current);
			acceptTimeDigit(event.key, editableIndex);
			return;
		}
		if (event.key === 'Enter') {
			if (!selectedDate) return;
			const commitValue = getCommitValue();
			if (!commitValue) return;
			event.preventDefault();
			commit(commitValue);
		}
	});

	const setMeridiem = (next: 'am' | 'pm') => {
		if (currentMeridiem === next) return;
		currentMeridiem = next;
		if (activeTimeIndex !== null) {
			activeTimeIndex = remapSlotIndexForMeridiem(activeTimeIndex, next);
		}
		if (getMatchingDigits().length === 4) {
			const exactIndex = tryResolveSlotIndexFromDigits(getMatchingDigits(), timeFormat, currentMeridiem);
			if (exactIndex !== null) activeTimeIndex = exactIndex;
		}
		refreshTimeMatches();
	};

	meridiemButtons?.am.addEventListener('click', () => setMeridiem('am'));
	meridiemButtons?.pm.addEventListener('click', () => setMeridiem('pm'));

	const refreshMeridiemUi = () => {
		if (!meridiemButtons) return;
		meridiemButtons.am.classList.toggle('is-active', currentMeridiem === 'am');
		meridiemButtons.pm.classList.toggle('is-active', currentMeridiem === 'pm');
	};

	if (initial.datePart) {
		input.value = initial.datePart;
	}
	if (initial.timePart && initial.slotIndex === null) {
		activeTimeIndex = getSlotIndexForCanonicalTime(initial.timePart) ?? getNextQuarterHourSlotIndex();
	}
	if (!initial.timePart) {
		const defaultSlot = slots[activeTimeIndex];
		currentMeridiem = resolveMeridiem(defaultSlot.hour24);
		timeBuffer = '____';
	}

	renderManualDayPicker();
	refreshDateCandidates();
	syncTimeInputValue();
	refreshTimeMatches();

	return {
		requestFocus: () => {
			if (!input.isConnected) return;
			focusFloatingInput(input);
			if (typeof input.select === 'function') input.select();
		},
		destroy: () => {
			container.replaceChildren();
			if (addedBasePanelClass) container.classList.remove('operon-datetime-picker-panel');
		},
	};
}

function baseDatetimePickerClass(className: string, useBaseClasses: boolean): string {
	return useBaseClasses ? className : '';
}

function firstDatetimePickerClass(className: string | undefined): string | null {
	return className?.split(/\s+/u).map(value => value.trim()).find(Boolean) ?? null;
}

function joinDatetimePickerClasses(...classes: Array<string | undefined>): string {
	return classes
		.flatMap(value => value?.split(/\s+/u) ?? [])
		.map(value => value.trim())
		.filter(Boolean)
		.join(' ');
}

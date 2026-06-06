import { App } from 'obsidian';
import { t } from '../../core/i18n';
import { getAppLocale } from '../../core/obsidian-app';
import { OperonSettings } from '../../types/settings';
import { createButton, createFloatingPanel, focusFloatingInput, resolvePickerApp, scrollChildIntoView } from './common';
import { appendDatePickerCandidateRow } from './date-picker-row';
import {
	buildDatePickerCandidates,
	DateParseCandidate,
	DatePickerLang,
	getDatePickerLocaleStrings,
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

export interface DatetimePickerOptions {
	app?: App;
	settings: Pick<OperonSettings, 'timeFormat'>;
	fieldKey?: string;
	language?: DatePickerLang;
	value?: string;
	retainInputFocus?: boolean;
	onSelect: (value: string) => void;
	onRemove?: () => void;
	canRemove?: boolean;
	onCancel?: () => void;
	onClose?: () => void;
}

const EDITABLE_CARET_POSITIONS = [0, 1, 3, 4];

export function showDatetimePicker(anchor: HTMLElement | DOMRect, options: DatetimePickerOptions): () => void {
	let completed = false;
	const app = resolvePickerApp(anchor, options.app);
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
	const { panel, close } = createFloatingPanel(anchor, 'operon-floating-panel operon-datetime-picker-panel', () => {
		if (!completed) options.onCancel?.();
		options.onClose?.();
	}, {
		retainInputFocus: options.retainInputFocus,
	});

	panel.classList.add('operon-datetime-picker-panel');

	const topRow = panel.createDiv('operon-datetime-picker-top-row');

	const input = topRow.createEl('input');
	input.type = 'text';
	input.className = 'operon-floating-input operon-date-picker-query operon-datetime-picker-query';
	input.placeholder = strings.searchPlaceholder;

	const topTimeWrap = topRow.createDiv('operon-datetime-picker-top-time');

	const timeInput = topTimeWrap.createEl('input');
	timeInput.type = 'text';
	timeInput.className = 'operon-floating-input operon-datetime-picker-time-input';
	timeInput.placeholder = t('taskEditor', 'datetimeTimePlaceholder');

	const results = panel.createDiv('operon-date-picker-results');

	const controlsRow = panel.createDiv('operon-datetime-picker-controls-row');

	const dateSection = controlsRow.createDiv('operon-datetime-picker-control-section');

	const dateLabel = dateSection.createDiv('operon-floating-subtitle operon-datetime-picker-control-label');
	dateLabel.textContent = strings.manualDate;

	const nativeInput = dateSection.createEl('input');
	nativeInput.type = 'date';
	nativeInput.className = 'operon-floating-input operon-date-picker-native';
	nativeInput.value = initial.datePart;

	let meridiemButtons: { am: HTMLButtonElement; pm: HTMLButtonElement } | null = null;
	if (timeFormat === '12h') {
		const meridiemToggle = topTimeWrap.createDiv('operon-datetime-picker-meridiem');
		meridiemButtons = {
			am: createButton(t('taskEditor', 'datetimeAm'), 'operon-datetime-picker-meridiem-btn', meridiemToggle),
			pm: createButton(t('taskEditor', 'datetimePm'), 'operon-datetime-picker-meridiem-btn', meridiemToggle),
		};
		meridiemToggle.appendChild(meridiemButtons.am);
		meridiemToggle.appendChild(meridiemButtons.pm);
	}

	const timeResults = topTimeWrap.createDiv('operon-datetime-picker-time-results');

	const timeNotice = topTimeWrap.createDiv('operon-datetime-picker-time-notice');

	const actions = panel.createDiv('operon-floating-actions');

	if (options.onRemove && options.canRemove) {
		const removeButton = createButton(t('taskEditor', 'datetimeRemove'), 'operon-floating-btn is-secondary', actions);
		removeButton.addEventListener('click', () => {
			completed = true;
			options.onRemove?.();
			close();
		});
		actions.appendChild(removeButton);
	}

	const applyButton = createButton(strings.apply, 'operon-floating-btn', actions);
	actions.appendChild(applyButton);
	panel.appendChild(actions);

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

	const commit = (value: string) => {
		if (!value) return;
		completed = true;
		options.onSelect(value);
		close();
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

	const hasValidTimeSelection = (): boolean => {
		if (hasTouchedTime) {
			return activeTimeIndex !== null && visibleTimeIndices.length > 0;
		}
		if (initial.timePart && !selectedDate) return false;
		if (initial.timePart && !hasTouchedTime) return true;
		return activeTimeIndex !== null;
	};

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

	const refreshApplyState = () => {
		applyButton.disabled = !(selectedDate && hasValidTimeSelection());
	};

	const scrollActiveTimeIntoView = () => {
		const active = timeResults.querySelector<HTMLElement>('.operon-datetime-picker-time-item.is-active');
		scrollChildIntoView(timeResults, active);
	};

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
		timeResults.classList.toggle('is-open', timeDropdownVisible);
		timeNotice.classList.toggle('is-open', timeDropdownVisible && !!timeNotice.textContent);
		timeResults.replaceChildren();
		if (visibleTimeIndices.length === 0) {
			const empty = timeResults.createDiv('operon-date-picker-empty');
			empty.textContent = t('taskEditor', 'datetimeNoMatchingTimes');
			const specialEndOfDay = getSpecialEndOfDayCommitValue();
			timeNotice.textContent = specialEndOfDay
				? '00:00 or 24:00 will be saved as next-day midnight for the end time.'
				: preserveOffGridCommit && !hasTouchedTime && initial.isOffGrid
					? t('taskEditor', 'datetimeOffGridTimeNotice')
					: '';
			refreshApplyState();
			return;
		}

		for (const index of visibleTimeIndices) {
			const slot = slots[index];
			const button = timeResults.createEl('button');
			button.type = 'button';
			button.className = 'operon-field-menu-item operon-datetime-picker-time-item';
			if (index === activeTimeIndex) button.classList.add('is-active');
			button.textContent = formatTimeLabel(slot);
			button.addEventListener('mousemove', () => {
				if (activeTimeIndex === index) return;
				activeTimeIndex = index;
				renderTimeResults();
			});
			button.addEventListener('mousedown', event => {
				event.preventDefault();
				activeTimeIndex = index;
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
		refreshApplyState();
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
		visibleCandidates = [...parsedCandidates];
		for (const candidate of quickCandidates) {
			if (!visibleCandidates.some(existing => existing.isoDate === candidate.isoDate)) {
				visibleCandidates.push(candidate);
			}
		}

		if (visibleCandidates.length === 0) {
			const empty = results.createDiv('operon-date-picker-empty');
			empty.textContent = strings.quickSuggestions;
			return;
		}

		activeDateIndex = Math.max(0, Math.min(activeDateIndex, visibleCandidates.length - 1));
		for (const [index, candidate] of visibleCandidates.entries()) {
			const button = results.createEl('button');
			button.type = 'button';
			button.className = 'operon-field-menu-item operon-date-picker-item';
			if (index === activeDateIndex) button.classList.add('is-active');
			appendDatePickerCandidateRow(button, candidate, language);

			button.addEventListener('mousemove', () => {
				if (activeDateIndex === index) return;
				activeDateIndex = index;
				renderDateResults();
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
		nativeInput.value = dateValue;
		refreshApplyState();
		focusTimeInput();
	};

	const moveActiveTime = (delta: number) => {
		activeTimeIndex = getWrappedSlotIndex((activeTimeIndex ?? getNextQuarterHourSlotIndex()) + delta);
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
		if (/^\d{4}-\d{2}-\d{2}$/.test(input.value.trim())) {
			nativeInput.value = input.value.trim();
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
			const active = getActiveDateCandidate();
			if (!active && !nativeInput.value) return;
			event.preventDefault();
			applySelectedDate(active?.isoDate ?? nativeInput.value);
		}
	});

	nativeInput.addEventListener('change', () => {
		if (!nativeInput.value) return;
		applySelectedDate(nativeInput.value);
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
		refreshMeridiemUi();
		refreshTimeMatches();
	};

	meridiemButtons?.am.addEventListener('click', () => setMeridiem('am'));
	meridiemButtons?.pm.addEventListener('click', () => setMeridiem('pm'));

	const refreshMeridiemUi = () => {
		if (!meridiemButtons) return;
		meridiemButtons.am.classList.toggle('is-active', currentMeridiem === 'am');
		meridiemButtons.pm.classList.toggle('is-active', currentMeridiem === 'pm');
	};

	const oldRefreshTimeMatches = refreshTimeMatches;
	const wrappedRefreshTimeMatches = () => {
		refreshMeridiemUi();
		oldRefreshTimeMatches();
	};

	applyButton.addEventListener('click', () => {
		const commitValue = getCommitValue();
		if (commitValue) {
			commit(commitValue);
			return;
		}
		if (options.onRemove && options.canRemove) {
			completed = true;
			options.onRemove();
			close();
		}
	});

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

	refreshDateCandidates();
	syncTimeInputValue();
	wrappedRefreshTimeMatches();

	window.requestAnimationFrame(() => {
		focusFloatingInput(input);
		input.select();
	});

	return close;
}

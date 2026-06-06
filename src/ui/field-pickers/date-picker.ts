import { App } from 'obsidian';
import { t } from '../../core/i18n';
import { createButton, createFloatingPanel, focusFloatingInput, resolvePickerApp } from './common';
import { appendDatePickerCandidateRow } from './date-picker-row';
import {
	buildDatePickerCandidates,
	DateParseCandidate,
	DatePickerLang,
	getDatePickerLocaleStrings,
	resolveDatePickerLanguage,
} from './date-nlp';

interface DatePickerOptions {
	app?: App;
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
	});

	panel.classList.add('operon-date-picker-panel');

	const input = panel.createEl('input');
	input.type = 'text';
	input.className = 'operon-floating-input operon-date-picker-query';
	input.placeholder = strings.searchPlaceholder;

	const results = panel.createDiv('operon-date-picker-results');

	const manualLabel = panel.createDiv('operon-floating-subtitle');
	manualLabel.textContent = strings.manualDate;

	const nativeInput = panel.createEl('input');
	nativeInput.type = 'date';
	nativeInput.className = 'operon-floating-input operon-date-picker-native';
	nativeInput.value = options.value ?? '';

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
	actions.appendChild(applyButton);
	panel.appendChild(actions);

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

	const render = () => {
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
		if (/^\d{4}-\d{2}-\d{2}$/.test(input.value.trim())) {
			nativeInput.value = input.value.trim();
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
			const active = getActiveCandidate();
			if (!active && !nativeInput.value) return;
			event.preventDefault();
			commit(active?.isoDate ?? nativeInput.value);
		}
	});

	nativeInput.addEventListener('change', () => {
		if (!nativeInput.value) return;
		input.value = nativeInput.value;
		refreshCandidates();
	});

	applyButton.addEventListener('click', () => {
		const active = getActiveCandidate();
		if (active) {
			commit(active.isoDate);
			return;
		}
		if (nativeInput.value) {
			commit(nativeInput.value);
			return;
		}
		if (options.onRemove && options.canRemove) {
			completed = true;
			options.onRemove();
			close();
		}
	});

	if (options.value) {
		input.value = options.value;
	}
	refreshCandidates();

	window.requestAnimationFrame(() => {
		focusFloatingInput(input);
		input.select();
	});

	return close;
}

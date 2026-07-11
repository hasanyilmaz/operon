import { t } from '../../core/i18n';
import { bindPickerListItemActivation, createButton, createChip, createFloatingPanel, requestFloatingInputFocus } from './common';

export interface ListPickerOptions {
	title: string;
	value: string[];
	candidates: string[];
	placeholder: string;
	formatValue?: (value: string) => string;
	normalize?: (value: string) => string;
	closeOnSelect?: boolean;
	retainInputFocus?: boolean;
	onSave: (values: string[]) => void;
	onClose?: () => void;
}

export function showListPicker(anchor: HTMLElement | DOMRect, options: ListPickerOptions): () => void {
	let saved = false;
	const { panel, close } = createFloatingPanel(anchor, 'operon-floating-panel operon-list-picker-panel', () => {
		if (!saved) options.onClose?.();
	}, {
		retainInputFocus: options.retainInputFocus,
	});
	panel.dataset.title = options.title;

	const title = panel.createDiv('operon-floating-title');
	title.textContent = options.title;

	const selectedWrap = panel.createDiv('operon-list-picker-selected');

	const input = panel.createEl('input');
	input.type = 'text';
	input.className = 'operon-floating-input';
	input.placeholder = options.placeholder;

	const list = panel.createDiv('operon-list-picker-suggestions');

	let selectedValues = Array.from(new Set(options.value.map(v => normalizeValue(v, options.normalize)).filter(Boolean)));
	let matches: string[] = [];
	let activeIndex = 0;

	const persist = () => {
		saved = true;
		options.onSave(selectedValues);
	};

	const removeValue = (value: string) => {
		selectedValues = selectedValues.filter(existing => existing !== value);
		renderSelected();
		renderSuggestions(input.value);
		persist();
	};

	const addValue = (rawValue: string) => {
		const normalized = normalizeValue(rawValue, options.normalize);
		if (!normalized || selectedValues.includes(normalized)) return;
		selectedValues.push(normalized);
		selectedValues = Array.from(new Set(selectedValues));
		renderSelected();
		renderSuggestions(input.value);
		persist();
		input.value = '';
		if (options.closeOnSelect) {
			close();
		}
	};

	const renderSelected = () => {
		selectedWrap.replaceChildren();
		for (const value of selectedValues) {
			const chip = selectedWrap.createSpan('operon-list-picker-chip');
			chip.appendChild(createChip(formatValue(value, options.formatValue), 'operon-list-picker-chip-label', chip));

			const remove = createButton('×', 'operon-list-picker-chip-remove', chip);
			remove.addEventListener('click', () => removeValue(value));
			chip.appendChild(remove);
			selectedWrap.appendChild(chip);
		}
	};

	const renderSuggestions = (query: string) => {
		list.replaceChildren();
		const q = normalizeValue(query, options.normalize).toLowerCase();
		const available = options.candidates
			.map(candidate => normalizeValue(candidate, options.normalize))
			.filter(candidate => candidate && !selectedValues.includes(candidate));

		matches = q.length === 0
			? available
			: available.filter(candidate => candidate.toLowerCase().includes(q));
		activeIndex = matches.length === 0 ? 0 : Math.min(activeIndex, matches.length - 1);

		matches.slice(0, 12).forEach((match, index) => {
			const item = createButton(formatValue(match, options.formatValue), 'operon-list-picker-item', list);
			if (index === activeIndex) item.classList.add('is-active');
			item.addEventListener('mousemove', () => setActiveIndex(index));
			bindPickerListItemActivation(item, () => addValue(match));
			list.appendChild(item);
		});
	};

	const setActiveIndex = (nextIndex: number): void => {
		if (activeIndex === nextIndex) return;
		const previousItem = list.children[activeIndex] as HTMLElement | undefined;
		activeIndex = nextIndex;
		previousItem?.classList.remove('is-active');
		(list.children[activeIndex] as HTMLElement | undefined)?.classList.add('is-active');
	};

	input.addEventListener('input', () => renderSuggestions(input.value));
	input.addEventListener('keydown', (event) => {
		if (event.key === 'ArrowDown') {
			if (matches.length === 0) return;
			event.preventDefault();
			activeIndex = Math.min(activeIndex + 1, Math.max(0, Math.min(matches.length, 12) - 1));
			renderSuggestions(input.value);
			return;
		}
		if (event.key === 'ArrowUp') {
			if (matches.length === 0) return;
			event.preventDefault();
			activeIndex = Math.max(activeIndex - 1, 0);
			renderSuggestions(input.value);
			return;
		}
		if (event.key === 'Enter' || event.key === ';' || event.key === 'Tab' || event.key === ',') {
			const typed = input.value.trim();
			if (event.key === 'Enter' && matches[activeIndex]) {
				event.preventDefault();
				addValue(matches[activeIndex]);
				return;
			}
			if (typed) {
				event.preventDefault();
				addValue(typed);
			}
		}
	});

	const footer = panel.createDiv('operon-floating-actions');
	const doneButton = createButton(t('buttons', 'done'), 'operon-floating-btn', footer);
	doneButton.addEventListener('click', () => {
		persist();
		close();
	});
	footer.appendChild(doneButton);
	panel.appendChild(footer);

	renderSelected();
	renderSuggestions('');
	requestFloatingInputFocus(input);
	return close;
}

function normalizeValue(value: string, normalize?: (value: string) => string): string {
	const trimmed = value.trim();
	return normalize ? normalize(trimmed) : trimmed;
}

function formatValue(value: string, formatter?: (value: string) => string): string {
	return formatter ? formatter(value) : value;
}

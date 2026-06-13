import { t } from '../../core/i18n';
import type { FilterFieldType } from '../../types/settings';
import { createFloatingPanel, requestFloatingInputFocus, scrollChildIntoView } from './common';

export interface FilterConditionPickerOption {
	field: string;
	label: string;
	type: FilterFieldType;
}

interface FilterConditionPickerOptions {
	value: string;
	fields: readonly FilterConditionPickerOption[];
	onSelect: (option: FilterConditionPickerOption) => void;
	onClose?: () => void;
}

let filterConditionPickerInstanceId = 0;

export function showFilterConditionPicker(anchor: HTMLElement | DOMRect, options: FilterConditionPickerOptions): () => void {
	filterConditionPickerInstanceId += 1;
	const pickerId = `operon-filter-condition-picker-${filterConditionPickerInstanceId}`;
	const listId = `${pickerId}-list`;
	const optionIdPrefix = `${pickerId}-option`;
	const { panel, close } = createFloatingPanel(anchor, 'operon-floating-panel operon-filter-condition-picker-panel', () => {
		options.onClose?.();
	}, {
		retainInputFocus: true,
	});

	const input = panel.createEl('input');
	input.type = 'text';
	input.className = 'operon-floating-input operon-filter-condition-picker-search';
	input.placeholder = t('filterSets', 'conditionFieldSearchPlaceholder');
	input.setAttribute('role', 'combobox');
	input.setAttribute('aria-autocomplete', 'list');
	input.setAttribute('aria-controls', listId);
	input.setAttribute('aria-expanded', 'true');
	input.setAttribute('aria-label', t('filterSets', 'conditionFieldPickerLabel'));

	const list = panel.createDiv('operon-filter-condition-picker-list');
	list.id = listId;
	list.setAttribute('role', 'listbox');
	list.setAttribute('aria-label', t('filterSets', 'conditionFieldPickerLabel'));

	let matches: FilterConditionPickerOption[] = [];
	let activeIndex = 0;

	const selectOption = (option: FilterConditionPickerOption): void => {
		options.onSelect(option);
		close();
	};

	const updateActiveItem = (): void => {
		const items = Array.from(list.querySelectorAll<HTMLElement>('.operon-filter-condition-picker-item'));
		let activeItem: HTMLElement | null = null;
		for (const item of items) {
			const itemIndex = Number(item.dataset.optionIndex ?? '-1');
			const isActive = itemIndex === activeIndex;
			item.classList.toggle('is-active', isActive);
			item.setAttribute('aria-selected', isActive ? 'true' : 'false');
			if (isActive) activeItem = item;
		}
		if (activeItem) {
			input.setAttribute('aria-activedescendant', activeItem.id);
		} else {
			input.removeAttribute('aria-activedescendant');
		}
		scrollChildIntoView(list, activeItem);
	};

	const render = (): void => {
		list.replaceChildren();
		if (matches.length === 0) {
			const empty = list.createDiv('operon-filter-condition-picker-empty');
			empty.textContent = t('filterSets', 'conditionFieldNoMatches');
			input.removeAttribute('aria-activedescendant');
			return;
		}

		matches.forEach((match, index) => {
			const item = list.createEl('button');
			item.type = 'button';
			item.className = 'operon-filter-condition-picker-item';
			item.id = `${optionIdPrefix}-${index}`;
			item.setAttribute('role', 'option');
			item.dataset.optionIndex = String(index);
			item.toggleClass('is-selected', match.field === options.value);
			item.textContent = match.label || match.field;
			if (match.label && match.label !== match.field) {
				item.title = `${match.label} (${match.field})`;
			}
			item.addEventListener('mouseenter', () => {
				if (activeIndex === index) return;
				activeIndex = index;
				updateActiveItem();
			});
			item.addEventListener('mousedown', event => {
				event.preventDefault();
				selectOption(match);
			});
			list.appendChild(item);
		});
		updateActiveItem();
	};

	const updateMatches = (query: string): void => {
		const normalizedQuery = normalizeFilterConditionSearch(query);
		matches = normalizedQuery
			? options.fields.filter(option => getOptionSearchText(option).includes(normalizedQuery))
			: [...options.fields];
		const selectedIndex = matches.findIndex(match => match.field === options.value);
		activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
		render();
	};

	input.addEventListener('input', () => updateMatches(input.value));
	input.addEventListener('keydown', event => {
		if (event.key === 'Escape') {
			event.preventDefault();
			close();
			return;
		}
		if (matches.length === 0) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			activeIndex = Math.min(activeIndex + 1, matches.length - 1);
			updateActiveItem();
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			activeIndex = Math.max(activeIndex - 1, 0);
			updateActiveItem();
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			const match = matches[activeIndex];
			if (match) selectOption(match);
		}
	});

	updateMatches('');
	requestFloatingInputFocus(input);
	return close;
}

function normalizeFilterConditionSearch(value: string): string {
	return value.trim().toLowerCase();
}

function getOptionSearchText(option: FilterConditionPickerOption): string {
	return `${option.label} ${option.field}`.toLowerCase();
}

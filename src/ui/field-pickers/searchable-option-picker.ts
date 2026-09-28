import { prepareFuzzySearch, setIcon } from 'obsidian';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import {
	createFloatingPanel,
	type FloatingHostOptions,
	type FloatingPanelCloseReason,
	requestFloatingInputFocus,
	scrollChildIntoView,
} from './common';

export interface SearchableOptionPickerItem {
	value: string;
	label: string;
	description?: string;
	icon?: string | null;
	title?: string;
	group?: string | null;
	groupLabel?: string | null;
	groupOrder?: number;
}

export interface SearchableOptionPickerOptions<TOption extends SearchableOptionPickerItem> extends FloatingHostOptions {
	value: string | null | undefined;
	getValue?: () => string | null | undefined;
	options: readonly TOption[];
	placeholder: string;
	ariaLabel: string;
	noMatchesText: string;
	onSelect: (option: TOption) => void;
	onClose?: () => void;
	variantClassName?: string;
	getSearchText?: (option: TOption) => string;
	/** Opt-in: existing pickers retain substring matching and unlimited rendering. */
	fuzzySearch?: boolean;
	pageSize?: number;
	matchWidth?: number;
	closeOnWindowResize?: boolean;
	repositionOnWindowResize?: boolean;
	repositionOnPanelResize?: boolean;
	repositionOnScroll?: boolean;
	closeOnEscape?: boolean;
	shouldClose?: (reason: FloatingPanelCloseReason) => boolean;
}

let searchableOptionPickerInstanceId = 0;

export function showSearchableOptionPicker<TOption extends SearchableOptionPickerItem>(
	anchor: HTMLElement | DOMRect,
	options: SearchableOptionPickerOptions<TOption>,
): () => void {
	searchableOptionPickerInstanceId += 1;
	const pickerId = `operon-searchable-option-picker-${searchableOptionPickerInstanceId}`;
	const listId = `${pickerId}-list`;
	const optionIdPrefix = `${pickerId}-option`;
	const variantClassName = options.variantClassName?.trim();
	const variantPanelClass = variantClassName ? `${variantClassName}-panel` : '';
	const variantSearchClass = variantClassName ? `${variantClassName}-search` : '';
	const variantListClass = variantClassName ? `${variantClassName}-list` : '';
	const variantItemClass = variantClassName ? `${variantClassName}-item` : '';
	const variantGroupClass = variantClassName ? `${variantClassName}-group` : '';
	const variantEmptyClass = variantClassName ? `${variantClassName}-empty` : '';
	const { panel, close } = createFloatingPanel(
		anchor,
		[
			'operon-floating-panel',
			'operon-searchable-option-picker-panel',
			variantPanelClass,
		].filter(Boolean).join(' '),
		() => options.onClose?.(),
		{
			retainInputFocus: true,
			focusInputSelector: '.operon-searchable-option-picker-search',
			floatingHost: options.floatingHost,
			floatingScrollHost: options.floatingScrollHost,
			constrainToFloatingHost: options.constrainToFloatingHost,
			matchWidth: options.matchWidth,
			closeOnWindowResize: options.closeOnWindowResize,
			repositionOnWindowResize: options.repositionOnWindowResize,
			repositionOnPanelResize: options.repositionOnPanelResize,
			repositionOnScroll: options.repositionOnScroll,
			shouldClose: options.shouldClose,
		},
	);

	const input = panel.createEl('input');
	input.type = 'text';
	input.className = [
		'operon-floating-input',
		'operon-searchable-option-picker-search',
		variantSearchClass,
	].filter(Boolean).join(' ');
	input.placeholder = options.placeholder;
	input.setAttribute('role', 'combobox');
	input.setAttribute('aria-autocomplete', 'list');
	input.setAttribute('aria-controls', listId);
	input.setAttribute('aria-expanded', 'true');
	setAccessibleLabelWithoutTooltip(input, options.ariaLabel);

	const list = panel.createDiv([
		'operon-searchable-option-picker-list',
		variantListClass,
	].filter(Boolean).join(' '));
	list.id = listId;
	list.setAttribute('role', 'listbox');
	setAccessibleLabelWithoutTooltip(list, options.ariaLabel);

	let matches: TOption[] = [];
	let activeIndex = 0;
	const pageSize = Math.max(1, Math.floor(options.pageSize ?? Number.MAX_SAFE_INTEGER));
	let visibleCount = pageSize;
	const getCurrentValue = (): string | null | undefined => options.getValue?.() ?? options.value;

	const selectOption = (option: TOption): void => {
		options.onSelect(option);
		close();
	};

	const updateActiveItem = (scrollActive = true): void => {
		const items = Array.from(list.querySelectorAll<HTMLElement>('.operon-searchable-option-picker-item'));
		let activeItem: HTMLElement | null = null;
		for (const item of items) {
			const itemIndex = Number(item.dataset.optionIndex ?? '-1');
			const isActive = itemIndex === activeIndex;
			item.classList.toggle('is-active', isActive);
			if (isActive) activeItem = item;
		}
		if (activeItem) {
			input.setAttribute('aria-activedescendant', activeItem.id);
		} else {
			input.removeAttribute('aria-activedescendant');
		}
		if (scrollActive) scrollChildIntoView(list, activeItem);
	};

	const renderGroupHeading = (match: TOption): void => {
		const groupLabel = match.groupLabel?.trim() || match.group?.trim();
		if (!groupLabel) return;
		const heading = list.createDiv([
			'operon-searchable-option-picker-group',
			variantGroupClass,
		].filter(Boolean).join(' '));
		heading.setAttribute('role', 'presentation');
		heading.textContent = groupLabel;
	};

	const renderOption = (match: TOption, index: number): void => {
		const item = list.createEl('button');
		item.type = 'button';
		item.className = [
			'operon-searchable-option-picker-item',
			variantItemClass,
		].filter(Boolean).join(' ');
		item.id = `${optionIdPrefix}-${index}`;
		item.setAttribute('role', 'option');
		item.tabIndex = -1;
		if (options.pageSize) {
			item.setAttribute('aria-setsize', String(matches.length));
			item.setAttribute('aria-posinset', String(index + 1));
		}
		item.dataset.optionIndex = String(index);
		const isSelected = match.value === getCurrentValue();
		item.toggleClass('is-selected', isSelected);
		item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
		if (match.title) item.title = match.title;

		if (match.icon) {
			item.addClass('has-icon');
			const iconEl = item.createSpan('operon-searchable-option-picker-item-icon');
			setIcon(iconEl, match.icon);
		}
		if (match.description) {
			const content = item.createSpan('operon-searchable-option-picker-item-content');
			content.createSpan({ cls: 'operon-searchable-option-picker-item-label', text: match.label || match.value });
			content.createSpan({ cls: 'operon-searchable-option-picker-item-description', text: match.description });
		} else if (match.icon) {
			item.createSpan({ cls: 'operon-searchable-option-picker-item-label', text: match.label || match.value });
		} else {
			item.textContent = match.label || match.value;
		}

		item.addEventListener('mouseenter', () => {
			if (activeIndex === index) return;
			activeIndex = index;
			updateActiveItem();
		});
		item.addEventListener('mousedown', event => {
			event.preventDefault();
		});
		item.addEventListener('click', event => {
			event.preventDefault();
			selectOption(match);
		});
		list.appendChild(item);
	};

	const render = (scrollActive = true): void => {
		const scrollTop = list.scrollTop;
		list.replaceChildren();
		if (matches.length === 0) {
			const empty = list.createDiv([
				'operon-searchable-option-picker-empty',
				variantEmptyClass,
			].filter(Boolean).join(' '));
			empty.textContent = options.noMatchesText;
			input.removeAttribute('aria-activedescendant');
			return;
		}

		let lastGroup: string | null = null;
		matches.slice(0, visibleCount).forEach((match, index) => {
			const group = match.group?.trim() || null;
			if (group && group !== lastGroup) {
				renderGroupHeading(match);
			}
			lastGroup = group;
			renderOption(match, index);
		});
		updateActiveItem(scrollActive);
		if (!scrollActive) list.scrollTop = scrollTop;
	};

	const updateMatches = (query: string): void => {
		const normalizedQuery = normalizeSearchableOptionQuery(query);
		matches = filterSearchableOptions(options.options, normalizedQuery, option => getSearchableOptionSearchText(option, options), options.fuzzySearch);
		const selectedIndex = matches.findIndex(match => match.value === getCurrentValue());
		activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
		visibleCount = Math.max(pageSize, activeIndex + 1);
		list.scrollTop = 0;
		render();
	};

	list.addEventListener('scroll', () => {
		if (visibleCount < matches.length && list.scrollTop + list.clientHeight >= list.scrollHeight - 32) {
			visibleCount += pageSize;
			render(false);
		}
	});

	input.addEventListener('input', () => updateMatches(input.value));
	input.addEventListener('keydown', event => {
		if (event.key === 'Escape') {
			if (options.closeOnEscape === false) return;
			event.preventDefault();
			close();
			return;
		}
		if (matches.length === 0) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			activeIndex = Math.min(activeIndex + 1, matches.length - 1);
			if (activeIndex >= visibleCount) {
				visibleCount += pageSize;
				render();
			} else updateActiveItem();
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

function normalizeSearchableOptionQuery(value: string): string {
	return value.trim().toLowerCase();
}

function getSearchableOptionSearchText<TOption extends SearchableOptionPickerItem>(
	option: TOption,
	options: SearchableOptionPickerOptions<TOption>,
): string {
	return (options.getSearchText?.(option) ?? `${option.label} ${option.value}`).toLowerCase();
}

/** Stable ties retain the caller's destination priority. Searches always cover the full input. */
export function filterSearchableOptions<T>(items: readonly T[], query: string, text: (item: T) => string, fuzzy = false): T[] {
	if (!query) return [...items];
	if (!fuzzy) return items.filter(item => text(item).toLowerCase().includes(query.toLowerCase()));
	const search = prepareFuzzySearch(query);
	return items.map((item, index) => ({ item, index, match: search(text(item)) }))
		.filter(result => result.match !== null)
		.sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0) || a.index - b.index)
		.map(result => result.item);
}

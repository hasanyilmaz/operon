import type { App } from 'obsidian';
import { t } from '../../../core/i18n';
import { bindPickerListItemActivation, createButton, requestFloatingInputFocus, scrollChildIntoView } from '../common';
import { createCustomFieldPanel, type CustomFieldPickerBaseOptions } from './common';
import { setAccessibleLabelWithoutTooltip } from '../../accessibility-label';

const CUSTOM_LIST_PAGE_SIZE = 20;
const CUSTOM_LIST_LOAD_MORE_SCROLL_THRESHOLD_PX = 48;

export interface CustomListFieldPickerOptions extends CustomFieldPickerBaseOptions<'list'> {
	app: App;
	sourcePath?: string;
	value: string[];
	candidates: string[];
	onCommit: (canonicalKey: string, value: string) => void;
}

export function showCustomListFieldPicker(
	anchor: HTMLElement | DOMRect,
	options: CustomListFieldPickerOptions,
): () => void {
	let completed = false;
	const { panel, close } = createCustomFieldPanel(anchor, options, () => {
		if (!completed) options.onCancel?.();
		options.onClose?.();
	});

	const selectedWrap = panel.createDiv('operon-custom-list-picker-selected-wrap');

	const input = panel.createEl('input');
	input.type = 'text';
	input.className = 'operon-floating-input operon-custom-field-picker-input operon-custom-list-picker-input';
	input.placeholder = options.placeholder ?? options.label;

	const list = panel.createDiv('operon-custom-field-picker-suggestions operon-custom-list-picker-suggestions');

	const actions = panel.createDiv('operon-floating-actions operon-custom-list-picker-actions');
	const countLabel = actions.createDiv('operon-custom-list-picker-count');
	actions.appendChild(countLabel);
	const clearButton = createButton(t('buttons', 'clear'), 'operon-floating-btn is-secondary operon-custom-list-picker-clear', actions);
	clearButton.addEventListener('click', () => {
		selectedValues = [];
		persist();
		renderSelected();
		updateMatches(input.value);
		requestFloatingInputFocus(input);
	});
	actions.appendChild(clearButton);

	let selectedValues = Array.from(new Set(options.value.map(normalizeCustomListValue).filter(Boolean)));
	let matches: string[] = [];
	let activeIndex = 0;
	let loadedCount = 0;

	const persist = (): void => {
		completed = true;
		options.onCommit(options.canonicalKey, selectedValues.join('; '));
	};

	const getVisibleMatches = (): string[] => matches.slice(0, loadedCount);

	const loadMore = (): boolean => {
		if (loadedCount >= matches.length) return false;
		const nextLoadedCount = Math.min(matches.length, loadedCount + CUSTOM_LIST_PAGE_SIZE);
		if (nextLoadedCount === loadedCount) return false;
		loadedCount = nextLoadedCount;
		return true;
	};

	const ensureLoadedForIndex = (index: number): void => {
		if (index < loadedCount) return;
		loadedCount = Math.min(matches.length, Math.ceil((index + 1) / CUSTOM_LIST_PAGE_SIZE) * CUSTOM_LIST_PAGE_SIZE);
	};

	const loadMoreIfNearBottom = (): boolean => {
		if (loadedCount >= matches.length) return false;
		const remainingScroll = list.scrollHeight - list.scrollTop - list.clientHeight;
		if (remainingScroll > CUSTOM_LIST_LOAD_MORE_SCROLL_THRESHOLD_PX) return false;
		return loadMore();
	};

	const syncListViewport = (keepActiveVisible = true): void => {
		const items = Array.from(list.children) as HTMLElement[];
		if (items.length === 0) {
			list.style.removeProperty('max-height');
			return;
		}

		const visibleItems = items.slice(0, Math.min(5, items.length));
		const totalHeight = visibleItems.reduce((sum, item) => sum + item.offsetHeight, 0);
		const gap = visibleItems.length > 1 ? (visibleItems.length - 1) * 6 : 0;
		if (totalHeight > 0) list.style.maxHeight = `${totalHeight + gap}px`;

		const activeItem = items[activeIndex];
		if (keepActiveVisible) scrollChildIntoView(list, activeItem);
	};

	const renderSuggestions = (keepActiveVisible = true): void => {
		ensureLoadedForIndex(activeIndex);
		list.replaceChildren();
		countLabel.textContent = t('taskEditor', matches.length === 1 ? 'resultCountOne' : 'resultCountMany', { count: String(matches.length) });

		for (const [index, match] of getVisibleMatches().entries()) {
			const item = list.createEl('button');
			item.type = 'button';
			item.className = 'operon-custom-field-picker-option operon-custom-list-picker-option';
			if (index === activeIndex) item.classList.add('is-active');

			const label = item.createDiv('operon-custom-list-picker-option-label');
			label.textContent = formatCustomListDisplayValue(match);
			bindCustomListWikilinkPreview(options, item, match);

			item.addEventListener('mousemove', () => setActiveIndex(index));
			bindPickerListItemActivation(item, () => addValue(match));
			list.appendChild(item);
		}

		syncListViewport(keepActiveVisible);
	};

	const setActiveIndex = (nextIndex: number): void => {
		if (activeIndex === nextIndex) return;
		const previousItem = list.children[activeIndex] as HTMLElement | undefined;
		activeIndex = nextIndex;
		previousItem?.classList.remove('is-active');
		(list.children[activeIndex] as HTMLElement | undefined)?.classList.add('is-active');
	};

	const updateMatches = (query: string): void => {
		const q = normalizeCustomListValue(query).toLocaleLowerCase();
		const available = Array.from(new Set(
			options.candidates
				.map(normalizeCustomListValue)
				.filter(candidate => candidate && !selectedValues.includes(candidate)),
		));
		matches = q ? available.filter(candidate => buildCustomListSearchText(candidate).includes(q)) : available;
		activeIndex = 0;
		loadedCount = Math.min(CUSTOM_LIST_PAGE_SIZE, matches.length);
		renderSuggestions();
	};

	const renderSelected = (): void => {
		selectedWrap.replaceChildren();
		selectedWrap.classList.toggle('is-visible', selectedValues.length > 0);
		for (const value of selectedValues) {
			const labelText = formatCustomListDisplayValue(value);
			const chip = selectedWrap.createDiv('operon-custom-list-picker-chip');
			chip.createSpan({
				text: labelText,
				cls: 'operon-custom-list-picker-chip-label',
			});
			bindCustomListWikilinkPreview(options, chip, value);

			const remove = chip.createEl('button', {
				cls: 'operon-custom-list-picker-chip-remove',
				text: '×',
				attr: {
					type: 'button',
				},
			});
			setAccessibleLabelWithoutTooltip(remove, t('taskEditor', 'removeValue', { value: labelText }));
			remove.addEventListener('click', () => {
				selectedValues = selectedValues.filter(existing => existing !== value);
				renderSelected();
				updateMatches(input.value);
				persist();
			});
		}
	};

	function addValue(rawValue: string): void {
		const normalized = normalizeCustomListValue(rawValue);
		if (!normalized || selectedValues.includes(normalized)) return;
		selectedValues.push(normalized);
		selectedValues = Array.from(new Set(selectedValues));
		input.value = '';
		renderSelected();
		updateMatches('');
		persist();
	}

	input.addEventListener('input', () => updateMatches(input.value));
	list.addEventListener('scroll', () => {
		if (loadMoreIfNearBottom()) renderSuggestions(false);
	});
	list.addEventListener('wheel', event => {
		if (event.deltaY <= 0) return;
		if (!loadMoreIfNearBottom()) return;
		const previousScrollTop = list.scrollTop;
		event.preventDefault();
		renderSuggestions(false);
		window.requestAnimationFrame(() => {
			list.scrollTop = previousScrollTop + event.deltaY;
		});
	});
	input.addEventListener('keydown', event => {
		if (event.key === 'Backspace' && !input.value.trim() && selectedValues.length > 0) {
			event.preventDefault();
			selectedValues = selectedValues.slice(0, -1);
			persist();
			renderSelected();
			updateMatches('');
			return;
		}
		if (event.key === 'ArrowDown') {
			if (matches.length === 0) return;
			event.preventDefault();
			activeIndex = Math.min(activeIndex + 1, matches.length - 1);
			renderSuggestions();
			return;
		}
		if (event.key === 'ArrowUp') {
			if (matches.length === 0) return;
			event.preventDefault();
			activeIndex = Math.max(activeIndex - 1, 0);
			renderSuggestions();
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

	renderSelected();
	updateMatches('');
	requestFloatingInputFocus(input);
	return close;
}

function normalizeCustomListValue(value: string): string {
	return value.trim();
}

function formatCustomListDisplayValue(value: string): string {
	const trimmed = value.trim();
	return parseCustomListWikiLink(trimmed)?.displayValue ?? trimmed;
}

function buildCustomListSearchText(value: string): string {
	return `${formatCustomListDisplayValue(value)} ${value}`.toLocaleLowerCase();
}

interface CustomListWikiLinkValue {
	linktext: string;
	displayValue: string;
}

function parseCustomListWikiLink(value: string): CustomListWikiLinkValue | null {
	const trimmed = value.trim();
	const match = /^!?\[\[([^\]]+)\]\]$/u.exec(trimmed);
	if (!match) return null;
	const body = match[1]?.trim() ?? '';
	if (!body) return null;
	const pipeIndex = body.indexOf('|');
	if (pipeIndex < 0) {
		return {
			linktext: body,
			displayValue: formatCustomListWikiLinkTargetLabel(body) || trimmed,
		};
	}

	const linktext = body.slice(0, pipeIndex).trim();
	const alias = body.slice(pipeIndex + 1).trim();
	if (!linktext) return null;
	return {
		linktext,
		displayValue: alias || formatCustomListWikiLinkTargetLabel(linktext) || trimmed,
	};
}

function formatCustomListWikiLinkTargetLabel(linktext: string): string {
	const lastSegment = linktext.split('/').pop()?.trim() ?? linktext.trim();
	return lastSegment.replace(/\.md$/i, '');
}

function bindCustomListWikilinkPreview(
	options: Pick<CustomListFieldPickerOptions, 'app' | 'sourcePath'>,
	element: HTMLElement,
	rawValue: string,
): void {
	const parsed = parseCustomListWikiLink(rawValue);
	if (!parsed) return;
	element.setAttribute('data-href', parsed.linktext);
	element.addEventListener('mouseover', event => triggerCustomListWikilinkPreview(options, element, parsed.linktext, event));
	element.addEventListener('mousemove', event => triggerCustomListWikilinkPreview(options, element, parsed.linktext, event));
}

function triggerCustomListWikilinkPreview(
	options: Pick<CustomListFieldPickerOptions, 'app' | 'sourcePath'>,
	targetEl: HTMLElement,
	linktext: string,
	event: MouseEvent,
): void {
	if (!event.metaKey && !event.ctrlKey) return;
	(options.app.workspace as unknown as {
		trigger?: (name: string, payload: Record<string, unknown>) => void;
	}).trigger?.('hover-link', {
		event,
		source: 'operon-custom-list-picker',
		targetEl,
		linktext,
		sourcePath: options.sourcePath ?? '',
		hoverParent: resolveCustomListHoverParent(targetEl),
	});
}

function resolveCustomListHoverParent(element: HTMLElement): HTMLElement {
	return element.closest<HTMLElement>(
		'.workspace-leaf-content, .markdown-preview-view, .markdown-embed, .markdown-source-view, .modal',
	) ?? element.ownerDocument.body;
}

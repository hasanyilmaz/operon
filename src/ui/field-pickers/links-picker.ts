import { App, Notice } from 'obsidian';
import { t } from '../../core/i18n';
import { splitTaskListValue } from '../../core/task-field-patch';
import { IndexedTask } from '../../types/fields';
import { KeyMapping } from '../../types/settings';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { bindPickerListItemActivation, createButton, createFloatingPanel, requestFloatingInputFocus, scrollChildIntoView } from './common';
import { ExternalLinkValue, parseExternalLinkValue } from './links-utils';

const PAGE_SIZE = 20;
const LOAD_MORE_SCROLL_THRESHOLD_PX = 48;
const LIST_VIEWPORT_SAFETY_PX = 4;

interface LinksPickerOptions {
	app: App;
	settingsKeyMappings: KeyMapping[];
	allTasks: IndexedTask[];
	value: string[];
	closeOnSelect?: boolean;
	retainInputFocus?: boolean;
	onSave: (values: string[]) => void;
	onClose?: () => void;
}

export function showLinksPicker(anchor: HTMLElement | DOMRect, options: LinksPickerOptions): () => void {
	const { panel, close } = createFloatingPanel(anchor, 'operon-floating-panel operon-links-picker-panel', options.onClose, {
		retainInputFocus: options.retainInputFocus,
	});

	const selectedWrap = panel.createDiv('operon-subtasks-picker-selected-wrap operon-links-picker-selected-wrap');

	const input = panel.createEl('input');
	input.type = 'text';
	input.className = 'operon-floating-input';
	input.placeholder = t('taskEditor', 'searchLinks');

	const list = panel.createDiv('operon-parent-task-picker-list operon-links-picker-list');

	const linkRow = panel.createDiv('operon-parent-task-picker-path-row operon-links-picker-link-row');
	const linkLabel = linkRow.createSpan('operon-parent-task-picker-path-label');
	linkLabel.textContent = t('taskEditor', 'linkLabel');
	const linkValue = linkRow.createSpan('operon-parent-task-picker-path-value operon-links-picker-link-value');

	const actions = panel.createDiv('operon-floating-actions operon-parent-task-picker-actions');
	const countLabel = actions.createDiv('operon-icon-picker-count operon-parent-task-picker-count');
	actions.appendChild(countLabel);
	const clearButton = createButton(t('buttons', 'clear'), 'operon-floating-btn is-secondary', actions);
	clearButton.addEventListener('click', () => {
		selectedValues = [];
		persist();
		renderSelected();
		updateMatches(input.value);
		requestFloatingInputFocus(input);
	});
	actions.appendChild(clearButton);

	const allCandidates = collectMappedLinkCandidates(
		options.app,
		options.allTasks,
		options.settingsKeyMappings,
	);
	const candidatesByValue = new Map(allCandidates.map(candidate => [candidate.rawValue, candidate]));
	let selectedValues = Array.from(new Set(options.value.map(normalizeRawValue).filter(Boolean)));
	let matches = rankLinkCandidates(allCandidates.filter(candidate => !selectedValues.includes(candidate.rawValue)), '');
	let activeIndex = 0;
	let loadedCount = Math.min(PAGE_SIZE, matches.length);

	const persist = () => {
		options.onSave([...selectedValues]);
	};

	const renderSelected = () => {
		selectedWrap.replaceChildren();
		selectedWrap.classList.toggle('is-visible', selectedValues.length > 0);
		for (const rawValue of selectedValues) {
			const candidate = candidatesByValue.get(rawValue) ?? parseExternalLinkValue(rawValue);
			const labelText = candidate?.displayValue ?? rawValue;
			const chip = selectedWrap.createDiv('operon-parent-selected-chip operon-links-selected-chip');
			chip.createSpan({
				text: labelText,
				cls: 'operon-parent-selected-chip-label operon-links-selected-chip-label',
			});
			const removeButton = chip.createEl('button', {
				cls: 'operon-parent-selected-chip-remove',
				text: '×',
				attr: { type: 'button' },
			});
			setAccessibleLabelWithoutTooltip(removeButton, t('taskEditor', 'removeValue', { value: labelText }));
			removeButton.addEventListener('click', () => {
				selectedValues = selectedValues.filter(existing => existing !== rawValue);
				persist();
				renderSelected();
				updateMatches(input.value);
				requestFloatingInputFocus(input);
			});
		}
	};

	const getVisibleMatches = (): ExternalLinkValue[] => matches.slice(0, loadedCount);

	const loadMore = (): boolean => {
		if (loadedCount >= matches.length) return false;
		const nextLoadedCount = Math.min(matches.length, loadedCount + PAGE_SIZE);
		if (nextLoadedCount === loadedCount) return false;
		loadedCount = nextLoadedCount;
		return true;
	};

	const ensureLoadedForIndex = (index: number): void => {
		if (index < loadedCount) return;
		loadedCount = Math.min(matches.length, Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE);
	};

	const loadMoreIfNearBottom = (): boolean => {
		if (loadedCount >= matches.length) return false;
		const remainingScroll = list.scrollHeight - list.scrollTop - list.clientHeight;
		if (remainingScroll > LOAD_MORE_SCROLL_THRESHOLD_PX) return false;
		return loadMore();
	};

	const syncListViewport = (keepActiveVisible = true) => {
		const items = Array.from(list.children) as HTMLElement[];
		if (items.length === 0) {
			list.style.removeProperty('max-height');
			linkValue.textContent = '';
			return;
		}

		const visibleItems = items.slice(0, Math.min(5, items.length));
		const totalHeight = visibleItems.reduce((sum, item) => sum + item.getBoundingClientRect().height, 0);
		const gap = visibleItems.length > 1 ? (visibleItems.length - 1) * 6 : 0;
		list.style.maxHeight = `${Math.ceil(totalHeight + gap + LIST_VIEWPORT_SAFETY_PX)}px`;

		const activeItem = items[activeIndex];
		if (keepActiveVisible) scrollChildIntoView(list, activeItem);
		linkValue.textContent = matches[activeIndex]?.url ?? '';
	};

	const setActiveIndex = (nextIndex: number): void => {
		if (activeIndex === nextIndex) return;
		const previousItem = list.children[activeIndex] as HTMLElement | undefined;
		activeIndex = nextIndex;
		previousItem?.classList.remove('is-active');
		(list.children[activeIndex] as HTMLElement | undefined)?.classList.add('is-active');
		linkValue.textContent = matches[activeIndex]?.url ?? '';
	};

	const render = (keepActiveVisible = true) => {
		ensureLoadedForIndex(activeIndex);
		list.replaceChildren();
		countLabel.textContent = t('taskEditor', matches.length === 1 ? 'resultCountOne' : 'resultCountMany', { count: String(matches.length) });

		for (const [index, candidate] of getVisibleMatches().entries()) {
			const item = list.createEl('button');
			item.type = 'button';
			item.className = 'operon-list-picker-item operon-parent-task-picker-item operon-links-picker-item';
			if (index === activeIndex) item.classList.add('is-active');

			item.createDiv({
				text: candidate.displayValue,
				cls: 'operon-parent-task-picker-label operon-links-picker-label',
			});

			item.addEventListener('mousemove', () => {
				setActiveIndex(index);
			});
			bindPickerListItemActivation(item, () => selectValue(candidate.rawValue));

			list.appendChild(item);
		}

		syncListViewport(keepActiveVisible);
	};

	const updateMatches = (query: string) => {
		const available = allCandidates.filter(candidate => !selectedValues.includes(candidate.rawValue));
		matches = rankLinkCandidates(available, query);
		activeIndex = 0;
		loadedCount = Math.min(PAGE_SIZE, matches.length);
		render();
	};

	const selectValue = (rawValue: string) => {
		const normalized = normalizeRawValue(rawValue);
		const parsed = parseExternalLinkValue(normalized);
		if (!parsed || selectedValues.includes(normalized)) return;
		selectedValues = [...selectedValues, normalized];
			persist();
			renderSelected();
			input.value = '';
			updateMatches('');
			if (options.closeOnSelect) {
				close();
				return;
			}
			requestFloatingInputFocus(input);
		};

	const addTypedValue = () => {
		const typed = normalizeRawValue(input.value);
		if (!typed) return;
		if (!parseExternalLinkValue(typed)) {
			new Notice(t('taskEditor', 'webLinkRequired'));
			return;
		}
		selectValue(typed);
	};

	input.addEventListener('input', () => updateMatches(input.value));
	list.addEventListener('scroll', () => {
		if (loadMoreIfNearBottom()) render(false);
	});
	list.addEventListener('wheel', event => {
		if (event.deltaY <= 0) return;
		if (!loadMoreIfNearBottom()) return;
		const previousScrollTop = list.scrollTop;
		event.preventDefault();
		render(false);
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
		if (event.key === 'ArrowDown' && matches.length > 0) {
			event.preventDefault();
			activeIndex = Math.min(activeIndex + 1, matches.length - 1);
			render();
			return;
		}
		if (event.key === 'ArrowUp' && matches.length > 0) {
			event.preventDefault();
			activeIndex = Math.max(activeIndex - 1, 0);
			render();
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			if (matches[activeIndex]) {
				selectValue(matches[activeIndex].rawValue);
				return;
			}
			addTypedValue();
			return;
		}
		if (event.key === ';' || event.key === 'Tab') {
			if (!input.value.trim()) return;
			event.preventDefault();
			addTypedValue();
		}
	});

	renderSelected();
	updateMatches('');
	requestFloatingInputFocus(input);
	return close;
}

export function collectMappedLinkCandidates(
	app: App,
	allTasks: IndexedTask[],
	keyMappings: KeyMapping[],
): ExternalLinkValue[] {
	const values = new Map<string, ExternalLinkValue>();

	const rememberValue = (rawValue: string) => {
		const parsed = parseExternalLinkValue(rawValue);
		if (!parsed) return;
		values.set(parsed.rawValue, parsed);
	};

	for (const task of allTasks) {
		for (const value of splitTaskListValue(task.fieldValues['links'])) {
			rememberValue(value);
		}
	}

	const fieldNames = new Set<string>(['links']);
	for (const mapping of keyMappings) {
		if (mapping.canonicalKey !== 'links') continue;
		if (!mapping.visiblePropertyName) continue;
		fieldNames.add(mapping.visiblePropertyName);
	}

	const lowered = new Set(Array.from(fieldNames).map(name => name.toLocaleLowerCase()));
	for (const file of app.vault.getMarkdownFiles()) {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) continue;
		for (const [key, raw] of Object.entries(fm)) {
			if (!lowered.has(key.toLocaleLowerCase())) continue;
			if (Array.isArray(raw)) {
				for (const value of raw.map(item => normalizeRawValue(String(item)))) rememberValue(value);
			} else if (typeof raw === 'string') {
				for (const value of splitTaskListValue(raw)) rememberValue(value);
			}
		}
	}

	return Array.from(values.values())
		.sort((a, b) => a.displayValue.localeCompare(b.displayValue, undefined, { sensitivity: 'base' }));
}

export function rankLinkCandidates(candidates: ExternalLinkValue[], query: string): ExternalLinkValue[] {
	const lowered = query.trim().toLocaleLowerCase();
	if (!lowered) return candidates;

	return candidates
		.map(candidate => ({
			candidate,
			score: scoreCandidate(candidate, lowered),
		}))
		.filter(result => result.score > 0)
		.sort((left, right) => {
			if (right.score !== left.score) return right.score - left.score;
			return left.candidate.displayValue.localeCompare(right.candidate.displayValue, undefined, { sensitivity: 'base' });
		})
		.map(result => result.candidate);
}

function scoreCandidate(candidate: ExternalLinkValue, query: string): number {
	const display = candidate.displayValue.toLocaleLowerCase();
	const search = candidate.searchText;
	let score = 0;
	if (display === query) score += 1200;
	if (display.startsWith(query)) score += 850;
	if (display.includes(` ${query}`) || display.includes(`/${query}`)) score += 500;
	if (search.includes(query)) score += 250;

	const tokens = query.split(/\s+/u).filter(Boolean);
	for (const token of tokens) {
		if (token.length < 2) continue;
		if (search.includes(token)) score += 60;
	}

	return score;
}

function normalizeRawValue(value: string): string {
	return value.trim();
}

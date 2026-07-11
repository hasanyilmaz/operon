import { IndexedTask } from '../../types/fields';
import { t } from '../../core/i18n';
import { bindPickerListItemActivation, createButton, createFloatingPanel, requestFloatingInputFocus, scrollChildIntoView } from './common';
import {
	DependencyFieldKey,
	normalizeDependencyPair,
	splitTaskListValue,
} from '../../core/task-field-patch';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';

const PAGE_SIZE = 20;
const LOAD_MORE_SCROLL_THRESHOLD_PX = 48;

interface DependencyTaskPickerOptions {
	fieldKey: DependencyFieldKey;
	value: string;
	oppositeValue: string;
	allTasks: IndexedTask[];
	excludedIds?: string[];
	closeOnSelect?: boolean;
	onSave: (payload: Record<DependencyFieldKey, string>) => void;
	onClose?: () => void;
}

interface DependencyCandidate {
	operonId: string;
	label: string;
	filePath: string;
	checkboxRank: number;
}

export function showDependencyTaskPicker(anchor: HTMLElement | DOMRect, options: DependencyTaskPickerOptions): () => void {
	const { panel, close } = createFloatingPanel(anchor, 'operon-floating-panel operon-subtasks-picker-panel', options.onClose);

	const selectedWrap = panel.createDiv('operon-subtasks-picker-selected-wrap');

	const input = panel.createEl('input');
	input.type = 'text';
	input.className = 'operon-floating-input';
	input.placeholder = t('taskEditor', options.fieldKey === 'blocking' ? 'searchBlockingTasks' : 'searchBlockedByTasks');

	const list = panel.createDiv('operon-parent-task-picker-list');

	const pathRow = panel.createDiv('operon-parent-task-picker-path-row');

	const pathLabel = pathRow.createSpan('operon-parent-task-picker-path-label');
	pathLabel.textContent = t('taskEditor', 'pathLabel');

	const pathValue = pathRow.createSpan('operon-parent-task-picker-path-value');

	const actions = panel.createDiv('operon-floating-actions operon-parent-task-picker-actions');
	const countLabel = actions.createDiv('operon-icon-picker-count operon-parent-task-picker-count');
	actions.appendChild(countLabel);
	const clearButton = createButton(t('buttons', 'clear'), 'operon-floating-btn is-secondary', actions);
	clearButton.addEventListener('click', () => {
		selectedIds = [];
			options.onSave(normalizeDependencyPair(options.fieldKey, [], options.oppositeValue));
			renderSelected();
			updateMatches(input.value);
			requestFloatingInputFocus(input);
		});
	actions.appendChild(clearButton);

	const excludedIds = new Set([
		...(options.excludedIds ?? []).map(value => value.trim()).filter(Boolean),
		...splitTaskListValue(options.oppositeValue),
	]);
	const allCandidates = buildCandidates(options.allTasks)
		.filter(candidate => !excludedIds.has(candidate.operonId));
	const candidatesById = new Map(allCandidates.map(candidate => [candidate.operonId, candidate]));
	let selectedIds = Array.from(new Set(splitTaskListValue(options.value))).filter(id => candidatesById.has(id));
	let matches = rankCandidates(allCandidates.filter(candidate => !selectedIds.includes(candidate.operonId)), '');
	let activeIndex = 0;
	let loadedCount = Math.min(PAGE_SIZE, matches.length);

	const renderSelected = () => {
		selectedWrap.replaceChildren();
		selectedWrap.classList.toggle('is-visible', selectedIds.length > 0);
		for (const operonId of selectedIds) {
			const candidate = candidatesById.get(operonId);
			const labelText = candidate?.label || operonId;
			const chip = selectedWrap.createDiv('operon-parent-selected-chip');
			chip.createSpan({
				text: candidate?.label || operonId,
				cls: 'operon-parent-selected-chip-label',
			});
			const removeButton = chip.createEl('button', {
				cls: 'operon-parent-selected-chip-remove',
				text: '×',
				attr: { type: 'button' },
			});
			setAccessibleLabelWithoutTooltip(removeButton, t('taskEditor', 'removeValue', { value: labelText }));
			removeButton.addEventListener('click', () => {
				selectedIds = selectedIds.filter(existing => existing !== operonId);
					options.onSave(normalizeDependencyPair(options.fieldKey, selectedIds, options.oppositeValue));
					renderSelected();
					updateMatches(input.value);
					requestFloatingInputFocus(input);
				});
		}
	};

	const getVisibleMatches = (): DependencyCandidate[] => matches.slice(0, loadedCount);

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
			pathValue.textContent = '';
			return;
		}

		const visibleItems = items.slice(0, Math.min(5, items.length));
		const totalHeight = visibleItems.reduce((sum, item) => sum + item.offsetHeight, 0);
		const gap = visibleItems.length > 1 ? (visibleItems.length - 1) * 6 : 0;
			list.style.maxHeight = `${totalHeight + gap}px`;

			const activeItem = items[activeIndex];
			if (keepActiveVisible) scrollChildIntoView(list, activeItem);
			pathValue.textContent = matches[activeIndex]?.filePath ?? '';
		};

	const render = (keepActiveVisible = true) => {
		ensureLoadedForIndex(activeIndex);
		list.replaceChildren();
		countLabel.textContent = t('taskEditor', matches.length === 1 ? 'resultCountOne' : 'resultCountMany', { count: String(matches.length) });
		for (const [index, candidate] of getVisibleMatches().entries()) {
			const item = list.createEl('button');
			item.type = 'button';
			item.className = 'operon-list-picker-item operon-parent-task-picker-item';
			if (index === activeIndex) item.classList.add('is-active');

			const label = item.createDiv('operon-parent-task-picker-label');
			label.textContent = candidate.label;

			item.addEventListener('mousemove', () => setActiveIndex(index));
			bindPickerListItemActivation(item, () => selectId(candidate.operonId));

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
		pathValue.textContent = matches[activeIndex]?.filePath ?? '';
	};

	const updateMatches = (query: string) => {
		const available = allCandidates.filter(candidate => !selectedIds.includes(candidate.operonId));
		matches = rankCandidates(available, query);
		activeIndex = 0;
		loadedCount = Math.min(PAGE_SIZE, matches.length);
		render();
	};

	const selectId = (operonId: string) => {
		if (!operonId || excludedIds.has(operonId) || selectedIds.includes(operonId)) return;
		selectedIds = [...selectedIds, operonId];
		options.onSave(normalizeDependencyPair(options.fieldKey, selectedIds, options.oppositeValue));
		renderSelected();
		input.value = '';
		updateMatches('');
			if (options.closeOnSelect) {
				close();
				return;
			}
			requestFloatingInputFocus(input);
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
		if (event.key === 'Backspace' && !input.value.trim() && selectedIds.length > 0) {
			event.preventDefault();
			selectedIds = selectedIds.slice(0, -1);
			options.onSave(normalizeDependencyPair(options.fieldKey, selectedIds, options.oppositeValue));
			renderSelected();
			updateMatches('');
			return;
		}
		if (matches.length === 0) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			activeIndex = Math.min(activeIndex + 1, matches.length - 1);
			render();
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			activeIndex = Math.max(activeIndex - 1, 0);
			render();
			return;
		}
		if (event.key === 'Enter' && matches[activeIndex]) {
			event.preventDefault();
			selectId(matches[activeIndex].operonId);
		}
	});

	renderSelected();
	updateMatches('');
	requestFloatingInputFocus(input);
	return close;
}

function buildCandidates(tasks: IndexedTask[]): DependencyCandidate[] {
	const checkboxRank: Record<string, number> = {
		open: 0,
		done: 1,
		cancelled: 2,
	};

	return tasks
		.map(task => ({
			operonId: task.operonId,
			label: task.description.trim() || 'Untitled task',
			filePath: task.primary.filePath ?? '',
			checkboxRank: checkboxRank[task.checkbox] ?? 99,
		}))
		.sort((left, right) => {
			if (left.checkboxRank !== right.checkboxRank) return left.checkboxRank - right.checkboxRank;
			return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
		});
}

function rankCandidates(candidates: DependencyCandidate[], query: string): DependencyCandidate[] {
	const lowered = query.trim().toLowerCase();
	if (!lowered) return candidates;

	return candidates
		.map(candidate => ({
			candidate,
			score: scoreDependencyMatch(candidate, lowered),
		}))
		.filter(result => result.score > 0)
		.sort((left, right) => {
			if (right.score !== left.score) return right.score - left.score;
			if (left.candidate.checkboxRank !== right.candidate.checkboxRank) {
				return left.candidate.checkboxRank - right.candidate.checkboxRank;
			}
			return left.candidate.label.localeCompare(right.candidate.label, undefined, { sensitivity: 'base' });
		})
		.map(result => result.candidate);
}

function scoreDependencyMatch(candidate: DependencyCandidate, query: string): number {
	const id = candidate.operonId.toLowerCase();
	const desc = candidate.label.toLowerCase();
	const file = candidate.filePath.toLowerCase();
	if (!query) return 0;

	let score = 0;
	if (id === query) score += 1200;
	if (desc === query) score += 1000;
	if (id.startsWith(query)) score += 800;
	if (desc.startsWith(query)) score += 650;
	if (desc.includes(` ${query}`)) score += 500;
	if (desc.includes(query)) score += 300;
	if (id.includes(query)) score += 250;
	if (file.includes(query)) score += 120;

	const queryTokens = query.split(/\s+/).filter(Boolean);
	for (const token of queryTokens) {
		if (token.length < 2) continue;
		if (desc.includes(token)) score += 60;
		if (id.includes(token)) score += 40;
	}

	return score;
}

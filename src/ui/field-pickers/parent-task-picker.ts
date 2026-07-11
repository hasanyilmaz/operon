import { IndexedTask } from '../../types/fields';
import { t } from '../../core/i18n';
import { bindPickerListItemActivation, createButton, createFloatingPanel, requestFloatingInputFocus, scrollChildIntoView } from './common';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';

const PAGE_SIZE = 20;
const LOAD_MORE_SCROLL_THRESHOLD_PX = 48;

interface ParentTaskPickerOptions {
	value?: string;
	allTasks: IndexedTask[];
	retainInputFocus?: boolean;
	onSelect: (operonId: string) => void;
	onClear?: () => void;
	onClose?: () => void;
}

interface ParentTaskCandidate {
	operonId: string;
	label: string;
	filePath: string;
	checkbox: IndexedTask['checkbox'];
	checkboxRank: number;
}

export function showParentTaskPicker(anchor: HTMLElement | DOMRect, options: ParentTaskPickerOptions): () => void {
	let completed = false;
	const { panel, close } = createFloatingPanel(anchor, 'operon-floating-panel operon-parent-task-picker-panel', () => {
		if (!completed) options.onClose?.();
	}, {
		retainInputFocus: options.retainInputFocus,
	});

	const input = panel.createEl('input');
	input.type = 'text';
	input.className = 'operon-floating-input';
	input.placeholder = t('taskEditor', 'searchParentTask');

	const selectedWrap = panel.createDiv('operon-parent-chip-wrap operon-parent-task-picker-selected-wrap');

	const list = panel.createDiv('operon-parent-task-picker-list');

	const pathRow = panel.createDiv('operon-parent-task-picker-path-row');

	const pathLabel = pathRow.createSpan('operon-parent-task-picker-path-label');
	pathLabel.textContent = t('taskEditor', 'pathLabel');

	const pathValue = pathRow.createSpan('operon-parent-task-picker-path-value');

	const actions = panel.createDiv('operon-floating-actions operon-parent-task-picker-actions');
	const countLabel = actions.createDiv('operon-icon-picker-count operon-parent-task-picker-count');
	actions.appendChild(countLabel);
	if (options.onClear) {
		const clearButton = createButton(t('buttons', 'clear'), 'operon-floating-btn is-secondary', actions);
		clearButton.addEventListener('click', () => {
			completed = true;
			options.onClear?.();
			close();
		});
		actions.appendChild(clearButton);
	}

	const displayCandidates = buildCandidates(options.allTasks);
	const allCandidates = displayCandidates.filter(candidate => candidate.checkbox === 'open');
	const candidatesById = new Map(displayCandidates.map(candidate => [candidate.operonId, candidate]));
	let matches = allCandidates;
	let activeIndex = 0;
	let loadedCount = Math.min(PAGE_SIZE, matches.length);
	let selectedOperonId = options.value?.trim() ?? '';

	const selectParent = (operonId: string) => {
		completed = true;
		options.onSelect(operonId);
		close();
	};

	const renderSelectedChip = () => {
		selectedWrap.replaceChildren();
		if (!selectedOperonId) {
			selectedWrap.classList.remove('is-visible');
			return;
		}

		selectedWrap.classList.add('is-visible');
		const candidate = candidatesById.get(selectedOperonId);
		const chip = selectedWrap.createDiv('operon-parent-selected-chip');
		chip.createSpan({
			text: candidate?.label || selectedOperonId,
			cls: 'operon-parent-selected-chip-label',
		});
		const removeButton = chip.createEl('button', {
			cls: 'operon-parent-selected-chip-remove',
			text: '×',
			attr: { type: 'button' },
		});
		setAccessibleLabelWithoutTooltip(removeButton, t('taskEditor', 'clearParentTask'));
		removeButton.addEventListener('click', () => {
			selectedOperonId = '';
			options.onClear?.();
				input.value = '';
				updateMatches('');
				renderVisibility();
				requestFloatingInputFocus(input);
			});
	};

	const renderVisibility = () => {
		const hasSelection = !!selectedOperonId;
		input.hidden = hasSelection;
		list.hidden = hasSelection;
		pathRow.hidden = false;
		actions.hidden = hasSelection;
		pathValue.textContent = hasSelection
			? (candidatesById.get(selectedOperonId)?.filePath ?? '')
			: (matches[activeIndex]?.filePath ?? '');
		renderSelectedChip();
	};

	const getVisibleMatches = (): ParentTaskCandidate[] => matches.slice(0, loadedCount);

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

	const render = (keepActiveVisible = true) => {
		ensureLoadedForIndex(activeIndex);
		list.replaceChildren();
		countLabel.textContent = t('taskEditor', matches.length === 1 ? 'resultCountOne' : 'resultCountMany', { count: String(matches.length) });
		getVisibleMatches().forEach((candidate, index) => {
			const item = list.createEl('button');
			item.type = 'button';
			item.className = 'operon-list-picker-item operon-parent-task-picker-item';
			if (index === activeIndex) item.classList.add('is-active');

			const label = item.createDiv('operon-parent-task-picker-label');
			label.textContent = candidate.label;

			item.addEventListener('mousemove', () => setActiveIndex(index));
			bindPickerListItemActivation(item, () => selectParent(candidate.operonId));

			list.appendChild(item);
		});
		syncListViewport(keepActiveVisible);
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

	const setActiveIndex = (nextIndex: number): void => {
		if (activeIndex === nextIndex) return;
		const previousItem = list.children[activeIndex] as HTMLElement | undefined;
		activeIndex = nextIndex;
		previousItem?.classList.remove('is-active');
		(list.children[activeIndex] as HTMLElement | undefined)?.classList.add('is-active');
		pathValue.textContent = matches[activeIndex]?.filePath ?? '';
	};

	const updateMatches = (query: string) => {
		if (selectedOperonId) return;
		matches = rankCandidates(allCandidates, query);
		loadedCount = Math.min(PAGE_SIZE, matches.length);
		activeIndex = 0;
		render();
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
			selectParent(matches[activeIndex].operonId);
		}
	});

	updateMatches('');
	renderVisibility();
	if (!selectedOperonId) requestFloatingInputFocus(input);
	return close;
}

function buildCandidates(tasks: IndexedTask[]): ParentTaskCandidate[] {
	const checkboxRank: Record<string, number> = {
		open: 0,
		done: 1,
		cancelled: 2,
	};

	return tasks
		.map(task => {
			const description = task.description.trim() || 'Untitled task';
			return {
				operonId: task.operonId,
				label: description,
				filePath: task.primary.filePath ?? '',
				checkbox: task.checkbox,
				checkboxRank: checkboxRank[task.checkbox] ?? 99,
			};
		})
		.sort((left, right) => {
			if (left.checkboxRank !== right.checkboxRank) return left.checkboxRank - right.checkboxRank;
			return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
		});
}

function rankCandidates(candidates: ParentTaskCandidate[], query: string): ParentTaskCandidate[] {
	const lowered = query.trim().toLowerCase();
	if (!lowered) return candidates;

	return candidates
		.map(candidate => ({
			candidate,
			score: scoreParentMatch(candidate, lowered),
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

function scoreParentMatch(candidate: ParentTaskCandidate, query: string): number {
	const id = candidate.operonId.toLowerCase();
	const desc = candidate.label.toLowerCase();
	if (!query) return 0;

	let score = 0;
	if (id === query) score += 1200;
	if (desc === query) score += 1000;
	if (id.startsWith(query)) score += 800;
	if (desc.startsWith(query)) score += 650;
	if (desc.includes(` ${query}`)) score += 500;
	if (desc.includes(query)) score += 300;
	if (id.includes(query)) score += 250;

	const queryTokens = query.split(/\s+/).filter(Boolean);
	for (const token of queryTokens) {
		if (token.length < 2) continue;
		if (desc.includes(token)) score += 60;
		if (id.includes(token)) score += 40;
	}

	return score;
}

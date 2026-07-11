import { App } from 'obsidian';
import { t } from '../../core/i18n';
import { IndexedTask } from '../../types/fields';
import { KeyMapping } from '../../types/settings';
import { bindPickerListItemActivation, createButton, createFloatingPanel, requestFloatingInputFocus, scrollChildIntoView } from './common';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';

interface AssigneesPickerOptions {
	app: App;
	settingsKeyMappings: KeyMapping[];
	allTasks: IndexedTask[];
	value: string[];
	closeOnSelect?: boolean;
	retainInputFocus?: boolean;
	onSave: (values: string[]) => void;
	onClose?: () => void;
}

interface AssigneeCandidate {
	rawValue: string;
	displayValue: string;
	searchText: string;
}

export function showAssigneesPicker(anchor: HTMLElement | DOMRect, options: AssigneesPickerOptions): () => void {
	const { panel, close } = createFloatingPanel(anchor, 'operon-floating-panel operon-assignees-picker-panel', options.onClose, {
		retainInputFocus: options.retainInputFocus,
	});

	const selectedWrap = panel.createDiv('operon-subtasks-picker-selected-wrap');

	const input = panel.createEl('input');
	input.type = 'text';
	input.className = 'operon-floating-input';
	input.placeholder = t('taskEditor', 'searchAssignees');

	const list = panel.createDiv('operon-parent-task-picker-list');

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

	const allCandidates = collectMappedAssigneeCandidates(
		options.app,
		options.allTasks,
		options.settingsKeyMappings,
		'assignees',
	);
	const candidatesByValue = new Map(allCandidates.map(candidate => [candidate.rawValue, candidate]));
	let selectedValues = Array.from(new Set(options.value.map(normalizeRawValue).filter(Boolean)));
	let matches = rankCandidates(allCandidates.filter(candidate => !selectedValues.includes(candidate.rawValue)), '');
	let activeIndex = 0;

	const persist = () => {
		options.onSave([...selectedValues]);
	};

	const renderSelected = () => {
		selectedWrap.replaceChildren();
		selectedWrap.classList.toggle('is-visible', selectedValues.length > 0);
		for (const rawValue of selectedValues) {
			const candidate = candidatesByValue.get(rawValue);
			const labelText = candidate?.displayValue ?? rawValue;
			const chip = selectedWrap.createDiv('operon-parent-selected-chip');
			chip.createSpan({
				text: candidate?.displayValue ?? formatAssigneeDisplay(rawValue),
				cls: 'operon-parent-selected-chip-label',
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

	const syncListViewport = () => {
		const items = Array.from(list.children) as HTMLElement[];
		if (items.length === 0) {
			list.style.removeProperty('max-height');
			return;
		}

		const visibleItems = items.slice(0, Math.min(5, items.length));
		const totalHeight = visibleItems.reduce((sum, item) => sum + item.offsetHeight, 0);
		const gap = visibleItems.length > 1 ? (visibleItems.length - 1) * 6 : 0;
		list.style.maxHeight = `${totalHeight + gap}px`;

			const activeItem = items[activeIndex];
			scrollChildIntoView(list, activeItem);
		};

	const setActiveIndex = (nextIndex: number): void => {
		if (activeIndex === nextIndex) return;
		const previousItem = list.children[activeIndex] as HTMLElement | undefined;
		activeIndex = nextIndex;
		previousItem?.classList.remove('is-active');
		(list.children[activeIndex] as HTMLElement | undefined)?.classList.add('is-active');
	};

	const render = () => {
		list.replaceChildren();
		countLabel.textContent = t('taskEditor', matches.length === 1 ? 'resultCountOne' : 'resultCountMany', { count: String(matches.length) });

		for (const [index, candidate] of matches.entries()) {
			const item = list.createEl('button');
			item.type = 'button';
			item.className = 'operon-list-picker-item operon-parent-task-picker-item';
			if (index === activeIndex) item.classList.add('is-active');

			const label = item.createDiv('operon-parent-task-picker-label');
			label.textContent = candidate.displayValue;

			item.addEventListener('mousemove', () => {
				setActiveIndex(index);
			});
			bindPickerListItemActivation(item, () => selectValue(candidate.rawValue));

			list.appendChild(item);
		}

		syncListViewport();
	};

	const updateMatches = (query: string) => {
		const available = allCandidates.filter(candidate => !selectedValues.includes(candidate.rawValue));
		matches = rankCandidates(available, query);
		activeIndex = matches.length > 0 ? Math.min(activeIndex, matches.length - 1) : 0;
		render();
	};

	const selectValue = (rawValue: string) => {
		const normalized = normalizeRawValue(rawValue);
		if (!normalized || selectedValues.includes(normalized)) return;
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
		selectValue(typed);
	};

	input.addEventListener('input', () => updateMatches(input.value));
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
		if (event.key === ';' || event.key === ',' || event.key === 'Tab') {
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

function collectMappedAssigneeCandidates(
	app: App,
	allTasks: IndexedTask[],
	keyMappings: KeyMapping[],
	fieldKey: 'assignees' | 'contexts',
): AssigneeCandidate[] {
	const values = new Map<string, AssigneeCandidate>();

	const rememberValue = (rawValue: string) => {
		const normalizedRaw = normalizeRawValue(rawValue);
		if (!normalizedRaw) return;
		const displayValue = formatAssigneeDisplay(normalizedRaw);
		const key = displayValue.toLowerCase();
		const nextCandidate: AssigneeCandidate = {
			rawValue: normalizedRaw,
			displayValue,
			searchText: buildSearchText(normalizedRaw, displayValue),
		};
		const existing = values.get(key);
		if (!existing || preferCandidate(nextCandidate, existing)) {
			values.set(key, nextCandidate);
		}
	};

	for (const task of allTasks) {
		const raw = task.fieldValues[fieldKey];
		if (!raw) continue;
		for (const value of raw.split(';').map(normalizeRawValue).filter(Boolean)) {
			rememberValue(value);
		}
	}

	const fieldNames = new Set<string>([fieldKey]);
	for (const mapping of keyMappings) {
		if (mapping.canonicalKey !== fieldKey) continue;
		if (!mapping.visiblePropertyName) continue;
		fieldNames.add(mapping.visiblePropertyName);
	}

	const lowered = new Set(Array.from(fieldNames).map(name => name.toLowerCase()));
	for (const file of app.vault.getMarkdownFiles()) {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) continue;
		for (const [key, raw] of Object.entries(fm)) {
			if (!lowered.has(key.toLowerCase())) continue;
			if (Array.isArray(raw)) {
				for (const value of raw.map(item => normalizeRawValue(String(item))).filter(Boolean)) rememberValue(value);
			} else if (typeof raw === 'string') {
				for (const value of raw.split(';').map(normalizeRawValue).filter(Boolean)) rememberValue(value);
			}
		}
	}

	return Array.from(values.values())
		.sort((a, b) => a.displayValue.localeCompare(b.displayValue, undefined, { sensitivity: 'base' }));
}

function rankCandidates(candidates: AssigneeCandidate[], query: string): AssigneeCandidate[] {
	const lowered = query.trim().toLowerCase();
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

function scoreCandidate(candidate: AssigneeCandidate, query: string): number {
	const display = candidate.displayValue.toLowerCase();
	const search = candidate.searchText;
	let score = 0;
	if (display === query) score += 1200;
	if (display.startsWith(query)) score += 850;
	if (display.includes(` ${query}`)) score += 500;
	if (search.includes(query)) score += 250;

	const tokens = query.split(/\s+/).filter(Boolean);
	for (const token of tokens) {
		if (token.length < 2) continue;
		if (search.includes(token)) score += 60;
	}

	return score;
}

function preferCandidate(nextCandidate: AssigneeCandidate, existing: AssigneeCandidate): boolean {
	const nextIsWiki = isWikiLinkValue(nextCandidate.rawValue);
	const existingIsWiki = isWikiLinkValue(existing.rawValue);
	if (nextIsWiki !== existingIsWiki) return nextIsWiki;
	return nextCandidate.rawValue.length < existing.rawValue.length;
}

function buildSearchText(rawValue: string, displayValue: string): string {
	return `${displayValue} ${rawValue} ${stripWikiLinkSyntax(rawValue)}`.toLowerCase();
}

function normalizeRawValue(value: string): string {
	return value.trim();
}

export function formatAssigneeDisplay(value: string): string {
	const trimmed = normalizeRawValue(value);
	if (!trimmed) return '';
	if (!isWikiLinkValue(trimmed)) return trimmed;
	const match = trimmed.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
	if (!match) return stripWikiLinkSyntax(trimmed);
	const target = match[1]?.trim() ?? '';
	const alias = match[2]?.trim() ?? '';
	if (alias) return alias;
	const lastSegment = target.split('/').pop()?.trim() ?? target;
	return lastSegment.replace(/\.md$/i, '');
}

function stripWikiLinkSyntax(value: string): string {
	return value.replace(/^\[\[/, '').replace(/\]\]$/, '').trim();
}

function isWikiLinkValue(value: string): boolean {
	return /^\[\[[^\]]+\]\]$/.test(value.trim());
}

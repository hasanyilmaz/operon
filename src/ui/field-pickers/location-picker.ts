import { App, Component, MarkdownRenderer, Notice, setIcon } from 'obsidian';
import { buildLocationPickerBaseMarkdown, isMapsPluginEnabled } from '../../core/location-base-map';
import { formatShortLocationCoordinate, parseLocationCoordinate } from '../../core/location-coordinates';
import {
	getLocationPlaceIndex,
	LocationPlaceSource,
	resolveLocationPropertyName,
} from '../../core/location-source-resolver';
import { t } from '../../core/i18n';
import { OperonSettings } from '../../types/settings';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { createButton, createFloatingPanel, requestFloatingInputFocus, scrollChildIntoView } from './common';

type LocationPickerTab = 'places' | 'map' | 'manual';

interface LocationPickerOptions {
	app: App;
	settings: Pick<OperonSettings,
		| 'keyMappings'
		| 'locationMapsAlwaysLightMode'
		| 'locationPlaceIconPropertyName'
		| 'locationPlaceColorPropertyName'
		| 'locationPickerMapDefaultCenter'
		| 'locationPickerMapDefaultZoom'
	>;
	value?: string;
	onSelect: (value: string) => void;
	onClear?: () => void;
	onClose?: () => void;
}

export function showLocationPicker(anchor: HTMLElement | DOMRect, options: LocationPickerOptions): () => void {
	const mapsAvailable = isMapsPluginEnabled(options.app);
	const component = new Component();
	component.load();
	const { panel, close } = createFloatingPanel(
		anchor,
		'operon-floating-panel operon-location-picker-panel',
		() => {
			component.unload();
			options.onClose?.();
		},
	);

	const tabs = panel.createDiv('operon-location-picker-tabs');
	const body = panel.createDiv('operon-location-picker-body');
	const availableTabs: LocationPickerTab[] = mapsAvailable
		? ['places', 'map', 'manual']
		: ['places', 'manual'];
	let activeTab: LocationPickerTab = 'places';
	const tabButtons = new Map<LocationPickerTab, HTMLButtonElement>();

	const selectCoordinate = (rawValue: string): void => {
		const parsed = parseLocationCoordinate(rawValue);
		if (!parsed) {
			new Notice(t('location', 'invalidCoordinates'));
			return;
		}
		options.onSelect(parsed.canonical);
		close();
	};
	const clearCoordinate = options.onClear
		? (): void => {
			options.onClear?.();
			close();
		}
		: undefined;

	const renderTabButtons = (): void => {
		tabs.replaceChildren();
		tabButtons.clear();
		for (const tab of availableTabs) {
			const button = createButton(t('location', `tab_${tab}`), 'operon-location-picker-tab', tabs);
			button.classList.toggle('is-active', tab === activeTab);
			button.addEventListener('click', () => {
				activeTab = tab;
				render();
			});
			tabButtons.set(tab, button);
			tabs.appendChild(button);
		}
	};

	const render = (): void => {
		renderTabButtons();
		body.replaceChildren();
		if (activeTab === 'places') {
			renderPlacesTab(body, options, selectCoordinate, clearCoordinate);
		} else if (activeTab === 'map') {
			renderMapTab(body, options, component, selectCoordinate);
		} else {
			renderManualTab(body, options.value ?? '', selectCoordinate, clearCoordinate);
		}
		for (const [tab, button] of tabButtons) {
			button.classList.toggle('is-active', tab === activeTab);
		}
	};

	render();
	return close;
}

function renderPlacesTab(
	container: HTMLElement,
	options: LocationPickerOptions,
	selectCoordinate: (value: string) => void,
	onClear?: () => void,
): void {
	const sources = [...getLocationPlaceIndex(options.app, options.settings).getSources()];
	let matches = sources;
	let activeIndex = 0;

	const input = container.createEl('input');
	input.type = 'text';
	input.className = 'operon-floating-input operon-location-picker-search';
	input.placeholder = t('location', 'searchPlaces');

	const list = container.createDiv('operon-parent-task-picker-list operon-location-places-list');
	const detailRow = container.createDiv('operon-parent-task-picker-path-row operon-location-place-detail-row');
	const detailLabel = detailRow.createSpan('operon-parent-task-picker-path-label');
	detailLabel.textContent = `${t('taskEditor', 'fileBodyPanelFileLabel')}:`;
	const detailValue = detailRow.createSpan('operon-parent-task-picker-path-value operon-location-place-detail-value');
	const actions = container.createDiv('operon-floating-actions operon-parent-task-picker-actions');
	const countLabel = actions.createDiv('operon-icon-picker-count operon-parent-task-picker-count');
	if (onClear) {
		const clearButton = createButton(t('buttons', 'clear'), 'operon-floating-btn is-secondary', actions);
		clearButton.addEventListener('click', () => onClear());
		actions.appendChild(clearButton);
	}

	const renderList = (): void => {
		list.replaceChildren();
		countLabel.textContent = t('taskEditor', matches.length === 1 ? 'resultCountOne' : 'resultCountMany', {
			count: String(matches.length),
		});
		if (matches.length === 0) {
			detailValue.textContent = '';
			list.createDiv({
				cls: 'operon-location-picker-empty',
				text: t('location', sources.length === 0 ? 'noPlaces' : 'noMatchingPlaces'),
			});
			return;
		}
		const visibleMatches = matches.slice(0, 50);
		activeIndex = Math.min(activeIndex, visibleMatches.length - 1);
		detailValue.textContent = formatPlaceDetail(visibleMatches[activeIndex]);
		for (const [index, source] of visibleMatches.entries()) {
			const item = list.createEl('button');
			item.type = 'button';
			item.className = 'operon-list-picker-item operon-parent-task-picker-item operon-location-place-item';
			item.title = `${source.path} - ${source.coordinate.canonical}`;
			if (index === activeIndex) item.classList.add('is-active');
			item.createDiv({ cls: 'operon-parent-task-picker-label operon-location-place-label', text: source.basename });
			item.addEventListener('mousemove', () => {
				if (activeIndex !== index) {
					activeIndex = index;
					renderList();
				}
			});
			item.addEventListener('click', event => {
				event.preventDefault();
				selectCoordinate(source.coordinate.canonical);
			});
			item.addEventListener('mousedown', event => {
				event.preventDefault();
				selectCoordinate(source.coordinate.canonical);
			});
			list.appendChild(item);
		}
		scrollChildIntoView(list, list.children[activeIndex] as HTMLElement | undefined);
	};

	const updateMatches = (): void => {
		const query = input.value.trim().toLowerCase();
		matches = rankPlaceSources(sources, query);
		activeIndex = 0;
		renderList();
	};

	input.addEventListener('input', updateMatches);
	input.addEventListener('keydown', event => {
		if (event.key === 'ArrowDown' && matches.length > 0) {
			event.preventDefault();
			activeIndex = Math.min(activeIndex + 1, matches.length - 1);
			renderList();
			return;
		}
		if (event.key === 'ArrowUp' && matches.length > 0) {
			event.preventDefault();
			activeIndex = Math.max(activeIndex - 1, 0);
			renderList();
			return;
		}
		if (event.key === 'Enter' && matches[activeIndex]) {
			event.preventDefault();
			selectCoordinate(matches[activeIndex].coordinate.canonical);
		}
	});

	updateMatches();
	requestFloatingInputFocus(input);
}

function formatPlaceDetail(source: LocationPlaceSource | undefined): string {
	if (!source) return '';
	return `${source.path} - ${source.coordinate.canonical}`;
}

function renderMapTab(
	container: HTMLElement,
	options: LocationPickerOptions,
	component: Component,
	selectCoordinate: (value: string) => void,
): void {
	const mapContainer = container.createDiv('operon-location-picker-map');
	void MarkdownRenderer.render(
		options.app,
		buildLocationPickerBaseMarkdown({
			settings: options.settings,
			height: 300,
		}),
		mapContainer,
		options.app.workspace.getActiveFile()?.path ?? '',
		component,
	);

	const controls = container.createDiv('operon-location-picker-coordinate-controls');
	const propertyName = resolveLocationPropertyName(options.settings.keyMappings);
	controls.createDiv({
		cls: 'operon-location-picker-map-hint',
		text: t('location', 'mapHint', { property: propertyName }),
	});
	const inputRow = controls.createDiv('operon-location-picker-input-row');
	const input = inputRow.createEl('input');
	input.type = 'text';
	input.className = 'operon-floating-input operon-location-picker-coordinate-input';
	input.placeholder = t('location', 'coordinatePlaceholder');
	input.value = parseLocationCoordinate(options.value ?? '')?.canonical ?? '';

	const clipboardButton = inputRow.createEl('button', {
		cls: 'operon-location-picker-icon-button',
		attr: { type: 'button' },
	});
	setIcon(clipboardButton, 'clipboard');
	setAccessibleLabelWithoutTooltip(clipboardButton, t('location', 'useClipboard'));
	clipboardButton.addEventListener('click', () => {
		void readClipboardCoordinates(input, selectCoordinate);
	});

	const saveButton = createButton(t('buttons', 'save'), 'operon-floating-btn is-primary', inputRow);
	saveButton.addEventListener('click', () => selectCoordinate(input.value));
	inputRow.appendChild(saveButton);
	input.addEventListener('keydown', event => {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		selectCoordinate(input.value);
	});
	requestFloatingInputFocus(input);
}

function renderManualTab(
	container: HTMLElement,
	value: string,
	selectCoordinate: (value: string) => void,
	onClear?: () => void,
): void {
	const input = container.createEl('input');
	input.type = 'text';
	input.className = 'operon-floating-input operon-location-picker-coordinate-input';
	input.placeholder = t('location', 'coordinatePlaceholder');
	input.value = parseLocationCoordinate(value)?.canonical ?? value;
	const actions = container.createDiv('operon-floating-actions operon-location-manual-actions');
	const saveButton = createButton(t('buttons', 'save'), 'operon-floating-btn is-primary', actions);
	saveButton.addEventListener('click', () => selectCoordinate(input.value));
	actions.appendChild(saveButton);
	if (onClear) {
		const clearButton = createButton(t('buttons', 'clear'), 'operon-floating-btn is-secondary', actions);
		clearButton.addEventListener('click', () => onClear());
		actions.appendChild(clearButton);
	}
	input.addEventListener('keydown', event => {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		selectCoordinate(input.value);
	});
	requestFloatingInputFocus(input);
}

function rankPlaceSources(sources: LocationPlaceSource[], query: string): LocationPlaceSource[] {
	if (!query) return sources;
	const scored = sources
		.map(source => {
			const basename = source.basename.toLowerCase();
			const path = source.path.toLowerCase();
			const coordinate = formatShortLocationCoordinate(source.coordinate).toLowerCase();
			let score = -1;
			if (basename === query) score = 100;
			else if (basename.startsWith(query)) score = 80;
			else if (basename.includes(query)) score = 60;
			else if (path.includes(query)) score = 40;
			else if (coordinate.includes(query)) score = 20;
			return { source, score };
		})
		.filter(entry => entry.score >= 0);
	return scored
		.sort((left, right) => right.score - left.score
			|| left.source.basename.localeCompare(right.source.basename, undefined, { sensitivity: 'base' }))
		.map(entry => entry.source);
}

async function readClipboardCoordinates(
	input: HTMLInputElement,
	selectCoordinate: (value: string) => void,
): Promise<void> {
	try {
		const text = await navigator.clipboard.readText();
		const parsed = parseLocationCoordinate(text);
		if (!parsed) {
			new Notice(t('location', 'clipboardInvalid'));
			return;
		}
		input.value = parsed.canonical;
		selectCoordinate(parsed.canonical);
	} catch (error) {
		console.warn('Operon: failed to read coordinates from clipboard', error);
		new Notice(t('location', 'clipboardUnavailable'));
		requestFloatingInputFocus(input);
	}
}
